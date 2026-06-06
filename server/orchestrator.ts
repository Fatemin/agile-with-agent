import { db } from "./db.js";
import { log, logSystem } from "./logger.js";
import { getAgentRuntimeConfig } from "./runtimeConfig.js";
import { buildBranchName, createBranchNoCheckout } from "./git.js";
import { executeStory } from "./execution.js";
import { removeWorkspace } from "./workspace.js";

/**
 * Orchestrator — Symphony §7, §8.
 *
 * The single authority that mutates scheduling state. Runs a poll loop that:
 *   1. Reconciles running issues (kills runs that are no longer active or stalled).
 *   2. Validates config (skip dispatch if invalid).
 *   3. Fetches candidate issues (active state, not running, not claimed).
 *   4. Dispatches up to WIP-limit slots.
 *
 * State is in-memory only (Symphony §7.4): restart recovery is driven by
 * re-fetching the tracker (our DB) and the filesystem (workspaces).
 */

// ── Symphony §7.1 issue states (active/terminal) ─────────────────────────────
const ACTIVE_STATES = new Set(["todo", "in_progress"]);
const TERMINAL_STATES = new Set(["done", "cancelled"]);

interface RunningEntry {
  storyId: string;
  identifier: string;            // story key, for logs
  startedAt: number;             // epoch ms
  lastEventAt: number;           // epoch ms — updated when any agent event arrives
  attempt: number;               // 1-based
  tokenIn: number;
  tokenOut: number;
  turnCount: number;
  abortController: AbortController;
  promise: Promise<void>;        // resolves when worker exits
}

interface RetryEntry {
  storyId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  timer: NodeJS.Timeout;
  error: string | null;
}

interface Snapshot {
  running: Array<{
    storyId: string;
    identifier: string;
    startedAt: string;
    attempt: number;
    turnCount: number;
    tokenIn: number;
    tokenOut: number;
    lastEventAt: string;
    elapsedSec: number;
  }>;
  retrying: Array<{
    storyId: string;
    identifier: string;
    attempt: number;
    dueInSec: number;
    error: string | null;
  }>;
  totals: {
    runningCount: number;
    retryingCount: number;
    completedCount: number;
    tokenIn: number;
    tokenOut: number;
    secondsRunning: number;
  };
  wipLimit: number;
  pollIntervalMs: number;
}

class Orchestrator {
  private running = new Map<string, RunningEntry>();
  private claimed = new Set<string>();
  private retries = new Map<string, RetryEntry>();
  private completed = new Set<string>();
  private totalTokenIn = 0;
  private totalTokenOut = 0;
  private totalSecondsEnded = 0;

  private tickTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  start(): void {
    if (this.tickTimer) return;
    const cfg = getAgentRuntimeConfig();
    logSystem("orchestrator", `Orchestrator starting — poll=${cfg.poll_interval_ms}ms, wip=${cfg.wip_limit}, workspace_root=${cfg.workspace_root}`, "info");
    try { this.recoverFromRestart(); }
    catch (e) { logSystem("orchestrator", `Recovery failed: ${e instanceof Error ? e.message : String(e)}`, "error"); }
    this.scheduleTick(50); // immediate first tick
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
    for (const entry of this.retries.values()) clearTimeout(entry.timer);
    this.retries.clear();
    for (const entry of this.running.values()) entry.abortController.abort();
    await Promise.allSettled([...this.running.values()].map((e) => e.promise));
    this.running.clear();
    this.claimed.clear();
  }

  /** External nudge — used when state changes from a route handler. */
  kick(): void {
    this.scheduleTick(50);
  }

  // ── Tick loop ───────────────────────────────────────────────────────────────

  private scheduleTick(delayMs?: number): void {
    if (this.stopping) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    const config = getAgentRuntimeConfig();
    const delay = delayMs ?? config.poll_interval_ms;
    this.tickTimer = setTimeout(() => { this.tick().finally(() => this.scheduleTick()); }, delay);
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    try {
      this.reconcileRunning();
      const config = getAgentRuntimeConfig();
      if (!config.enabled) return;
      const candidates = this.fetchCandidates();
      const available = Math.max(config.wip_limit - this.running.size, 0);
      const toDispatch = candidates.slice(0, available);
      for (const c of toDispatch) this.dispatch(c);
    } catch (e) {
      console.error("Orchestrator tick error:", e instanceof Error ? e.message : String(e));
    }
  }

  // ── Reconciliation (Symphony §8.5) ──────────────────────────────────────────

  private reconcileRunning(): void {
    const config = getAgentRuntimeConfig();
    for (const [id, entry] of this.running) {
      // Part A — stall detection
      if (config.stall_timeout_ms > 0) {
        const elapsed = Date.now() - entry.lastEventAt;
        if (elapsed > config.stall_timeout_ms) {
          log(id, "orchestrator", `Stall detected (${Math.round(elapsed/1000)}s without events) — terminating`, "system", "warn");
          entry.abortController.abort();
          continue;
        }
      }
      // Part B — tracker state refresh
      const story = db.prepare("SELECT status FROM stories WHERE id = ?").get(id) as { status: string } | undefined;
      if (!story) {
        log(id, "orchestrator", "Issue disappeared from tracker — terminating", "system", "warn");
        entry.abortController.abort();
        continue;
      }
      if (TERMINAL_STATES.has(story.status)) {
        log(id, "orchestrator", `Story is terminal (${story.status}) — terminating run`, "system", "info");
        entry.abortController.abort();
        continue;
      }
      if (!ACTIVE_STATES.has(story.status)) {
        log(id, "orchestrator", `Story moved to non-active state (${story.status}) — terminating`, "system", "info");
        entry.abortController.abort();
        continue;
      }
    }
  }

  // ── Candidate selection (Symphony §8.2) ─────────────────────────────────────

  private fetchCandidates(): Array<{ id: string; key: string; title: string; priority: string; project_id: string; status: string; branch_name: string | null }> {
    const claimedIds = [...this.claimed];
    const placeholders = claimedIds.map(() => "?").join(",") || "''";
    return db.prepare(`
      SELECT s.id, s.key, s.title, s.priority, s.project_id, s.status, s.branch_name
      FROM stories s
      WHERE s.status IN ('todo', 'in_progress')
        AND s.mode = 'auto'
        AND s.id NOT IN (${placeholders})
      ORDER BY
        CASE s.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC,
        s.created_at ASC
      LIMIT 50
    `).all(...claimedIds) as Array<{ id: string; key: string; title: string; priority: string; project_id: string; status: string; branch_name: string | null }>;
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  private dispatch(candidate: { id: string; key: string; title: string; project_id: string; status: string; branch_name: string | null }): void {
    if (this.claimed.has(candidate.id) || this.running.has(candidate.id)) return;

    this.claimed.add(candidate.id);

    // Ensure branch exists before flipping status — worker needs it for workspace
    if (!candidate.branch_name) {
      const project = db.prepare("SELECT local_path FROM projects WHERE id = ?").get(candidate.project_id) as
        { local_path: string | null } | undefined;
      if (project?.local_path) {
        const branchName = buildBranchName(candidate.key, candidate.title);
        // Non-checkout: the per-story worktree will check this branch out, and
        // git forbids the same branch in two worktrees at once.
        const result = createBranchNoCheckout(project.local_path, branchName);
        if (result.ok && result.branch) {
          db.prepare("UPDATE stories SET branch_name = ? WHERE id = ?").run(result.branch, candidate.id);
          candidate.branch_name = result.branch;
          log(candidate.id, "git", `Branch created: \`${result.branch}\``, "system");
        } else {
          log(candidate.id, "git_error", `Branch creation failed: ${result.error}`, "system", "error");
        }
      }
    }

    // Flip todo → in_progress so reconciliation and UI reflect that we picked it up
    if (candidate.status === "todo") {
      db.prepare("UPDATE stories SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(candidate.id);
      log(candidate.id, "status_change", "Status changed to **In Progress** (orchestrator dispatched)", "system");
    }

    log(candidate.id, "orchestrator", `Dispatched (slot ${this.running.size + 1}/${getAgentRuntimeConfig().wip_limit})`, "system", "info");
    this.runWorker(candidate.id, candidate.key, 1);
  }

  /** Manually request a story be dispatched ASAP (e.g. from a route). */
  requestDispatch(storyId: string): void {
    if (this.claimed.has(storyId) || this.running.has(storyId)) return;
    this.kick();
  }

  // ── Worker (one run attempt) ────────────────────────────────────────────────

  private runWorker(storyId: string, identifier: string, attempt: number): void {
    const abort = new AbortController();
    const entry: RunningEntry = {
      storyId, identifier,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      attempt,
      tokenIn: 0, tokenOut: 0,
      turnCount: 0,
      abortController: abort,
      promise: Promise.resolve(),
    };
    this.running.set(storyId, entry);

    entry.promise = (async () => {
      let hadError = false;
      let errorMsg: string | null = null;
      try {
        for await (const event of executeStory(storyId, { signal: abort.signal })) {
          entry.lastEventAt = Date.now();
          if (event.type === "tool_call") entry.turnCount += 1;
          if (event.type === "error") { hadError = true; errorMsg = event.content ?? "unknown error"; }
          if (event.type === "done" || event.type === "error") break;
          if (abort.signal.aborted) { hadError = true; errorMsg = "aborted"; break; }
        }
      } catch (e) {
        hadError = true;
        errorMsg = e instanceof Error ? e.message : String(e);
        log(storyId, "orchestrator", `Worker exception: ${errorMsg}`, "system", "error");
      }

      // Record runtime + book-keeping (Symphony §7.3 worker-exit handling)
      const runtimeSec = Math.floor((Date.now() - entry.startedAt) / 1000);
      this.totalSecondsEnded += runtimeSec;
      this.totalTokenIn += entry.tokenIn;
      this.totalTokenOut += entry.tokenOut;
      this.running.delete(storyId);

      // Decide what to do next
      if (abort.signal.aborted) {
        // Aborted by reconciliation — release claim, do NOT retry
        this.claimed.delete(storyId);
        log(storyId, "orchestrator", "Run released after abort", "system", "info");
        return;
      }

      // Check current tracker (DB) state to decide continuation vs retry vs release
      const fresh = db.prepare("SELECT status FROM stories WHERE id = ?").get(storyId) as { status: string } | undefined;
      if (!fresh || TERMINAL_STATES.has(fresh.status)) {
        this.completed.add(storyId);
        this.claimed.delete(storyId);
        return;
      }
      if (!ACTIVE_STATES.has(fresh.status)) {
        this.claimed.delete(storyId);
        return;
      }

      // Still active — schedule continuation or retry
      if (hadError) {
        const config = getAgentRuntimeConfig();
        const delay = Math.min(10_000 * 2 ** (attempt - 1), config.max_retry_backoff_ms);
        log(storyId, "orchestrator",
          `Run failed (attempt ${attempt}): ${errorMsg ?? "unknown"} — retrying in ${Math.round(delay/1000)}s`,
          "system", "warn"
        );
        this.scheduleRetry(storyId, identifier, attempt + 1, delay, errorMsg);
      } else {
        // Clean exit + still active → schedule short continuation retry (Symphony §7.1 nuance)
        this.scheduleRetry(storyId, identifier, attempt + 1, 1_000, null);
      }
    })();
  }

  // ── Retry queue (Symphony §8.4) ─────────────────────────────────────────────

  private scheduleRetry(storyId: string, identifier: string, attempt: number, delayMs: number, error: string | null): void {
    // Cancel any prior retry for the same story
    const existing = this.retries.get(storyId);
    if (existing) clearTimeout(existing.timer);

    const dueAtMs = Date.now() + delayMs;
    const timer = setTimeout(() => this.handleRetryFired(storyId), delayMs);
    this.retries.set(storyId, { storyId, identifier, attempt, dueAtMs, timer, error });
  }

  private handleRetryFired(storyId: string): void {
    const entry = this.retries.get(storyId);
    if (!entry) return;
    this.retries.delete(storyId);
    if (this.stopping) { this.claimed.delete(storyId); return; }

    // Check the story is still candidate-eligible
    const story = db.prepare("SELECT id, key, title, status, project_id, branch_name FROM stories WHERE id = ?").get(storyId) as
      { id: string; key: string; title: string; status: string; project_id: string; branch_name: string | null } | undefined;

    if (!story || !ACTIVE_STATES.has(story.status)) {
      // No longer eligible — release claim
      this.claimed.delete(storyId);
      return;
    }

    // Check slots
    const config = getAgentRuntimeConfig();
    if (this.running.size >= config.wip_limit) {
      // No slots — requeue with the same backoff window
      log(storyId, "orchestrator", "No available WIP slots — requeueing", "system", "info");
      this.scheduleRetry(storyId, entry.identifier, entry.attempt, 5_000, "no available orchestrator slots");
      return;
    }

    log(storyId, "orchestrator", `Retry fired (attempt ${entry.attempt})`, "system", "info");
    this.runWorker(storyId, entry.identifier, entry.attempt);
  }

  // ── Restart recovery (Symphony §7.4, §8.6) ──────────────────────────────────

  /**
   * Called at startup. Reconcile DB state with reality:
   *   1. Any story in 'in_progress' has no live worker (we just started) →
   *      either re-dispatch it on next tick, or mark stalled if abandoned.
   *   2. Best-effort: clean up workspaces for terminal stories.
   */
  recoverFromRestart(): void {
    // 1. Mark in-flight stories as needing re-pickup. We don't reset their state;
    //    the next tick will see them as candidates (status=in_progress) and re-dispatch.
    const stale = db.prepare(
      "SELECT id, key FROM stories WHERE status = 'in_progress' AND mode = 'auto'"
    ).all() as Array<{ id: string; key: string }>;
    for (const s of stale) {
      log(s.id, "orchestrator", "Restart recovery — orchestrator will re-pick this story on next tick", "system", "info");
    }

    // 2. Cleanup workspaces for terminal stories.
    // (Best-effort; before_remove hooks are skipped during restart recovery for simplicity —
    // they only fire when a story explicitly transitions to terminal during runtime.)
    const terminal = db.prepare(
      `SELECT s.id, s.key, p.local_path FROM stories s
       JOIN projects p ON s.project_id = p.id
       WHERE s.status IN ('done', 'cancelled') AND p.local_path IS NOT NULL`
    ).all() as Array<{ id: string; key: string; local_path: string }>;
    const config = getAgentRuntimeConfig();
    let cleaned = 0;
    for (const t of terminal) {
      const r = removeWorkspace({ workspaceRoot: config.workspace_root, storyKey: t.key, repoPath: t.local_path });
      if (r.ok) cleaned++;
    }
    if (cleaned > 0) logSystem("orchestrator", `Recovery: cleaned ${cleaned} terminal workspace(s)`, "info");
    if (stale.length > 0) logSystem("orchestrator", `Recovery: ${stale.length} in-flight stories will be re-dispatched`, "info");
  }

  // ── Snapshot (Symphony §13.3) ───────────────────────────────────────────────

  snapshot(): Snapshot {
    const now = Date.now();
    const config = getAgentRuntimeConfig();
    let activeRuntime = 0;
    const running = [...this.running.values()].map((e) => {
      const elapsedSec = Math.floor((now - e.startedAt) / 1000);
      activeRuntime += elapsedSec;
      return {
        storyId: e.storyId,
        identifier: e.identifier,
        startedAt: new Date(e.startedAt).toISOString(),
        attempt: e.attempt,
        turnCount: e.turnCount,
        tokenIn: e.tokenIn,
        tokenOut: e.tokenOut,
        lastEventAt: new Date(e.lastEventAt).toISOString(),
        elapsedSec,
      };
    });
    const retrying = [...this.retries.values()].map((r) => ({
      storyId: r.storyId,
      identifier: r.identifier,
      attempt: r.attempt,
      dueInSec: Math.max(0, Math.round((r.dueAtMs - now) / 1000)),
      error: r.error,
    }));
    return {
      running,
      retrying,
      totals: {
        runningCount: this.running.size,
        retryingCount: this.retries.size,
        completedCount: this.completed.size,
        tokenIn: this.totalTokenIn,
        tokenOut: this.totalTokenOut,
        secondsRunning: this.totalSecondsEnded + activeRuntime,
      },
      wipLimit: config.wip_limit,
      pollIntervalMs: config.poll_interval_ms,
    };
  }
}

export const orchestrator = new Orchestrator();
