import { db } from "./db.js";

/**
 * Story snapshot — per-story "working memory" (CONTEXT.md §5.1).
 *
 * The compact, bounded state that ContextBuilder injects instead of
 * concatenating every prior task's full impl_summary. This keeps a task
 * prompt ≈ constant size no matter how many tasks precede it.
 *
 * Persisted (story_snapshot.state_json): completed[] (one line each),
 * artifacts[], decisions[] (ids — populated in Phase 2). Everything else
 * (in_progress, blocked) is derived live from story_tasks at render time,
 * so there is exactly one write site per task (recordTaskComplete) plus the
 * goal set at plan time.
 */

export interface SnapshotCompleted {
  seq: number;
  title: string;
  result: string; // one-line summary of what the task did
}

export interface SnapshotState {
  completed: SnapshotCompleted[];
  artifacts: string[];
  decisions: number[]; // active decision ids (Phase 2)
}

const MAX_COMPLETED_SHOWN = 12;
const MAX_RESULT_LEN = 160;
const MAX_TITLE_LEN = 120;
const MAX_ARTIFACTS = 20;
const MAX_GOAL_LEN = 400;

/** First non-empty line, stripped of markdown noise and truncated. */
function firstLine(s: string | null | undefined, max = MAX_RESULT_LEN): string {
  if (!s) return "";
  const line = s.split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? "";
  const clean = line.replace(/[*_`#>]/g, "").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

function readState(storyId: string): { goal: string | null; state: SnapshotState } {
  const row = db.prepare("SELECT goal, state_json FROM story_snapshot WHERE story_id = ?").get(storyId) as
    { goal: string | null; state_json: string } | undefined;
  const state: SnapshotState = { completed: [], artifacts: [], decisions: [] };
  if (row?.state_json) {
    try {
      const parsed = JSON.parse(row.state_json) as Partial<SnapshotState>;
      if (Array.isArray(parsed.completed)) state.completed = parsed.completed;
      if (Array.isArray(parsed.artifacts)) state.artifacts = parsed.artifacts;
      if (Array.isArray(parsed.decisions)) state.decisions = parsed.decisions;
    } catch { /* keep default */ }
  }
  return { goal: row?.goal ?? null, state };
}

function writeState(storyId: string, goal: string | null, state: SnapshotState): void {
  db.prepare(`
    INSERT INTO story_snapshot (story_id, goal, state_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(story_id) DO UPDATE SET
      goal = excluded.goal,
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(storyId, goal, JSON.stringify(state));
}

/** Set the one-line goal (called once at plan time). */
export function setStoryGoal(storyId: string, goal: string): void {
  const { state } = readState(storyId);
  writeState(storyId, goal.trim().slice(0, MAX_GOAL_LEN) || null, state);
}

/** Record a finished task into working memory (the single per-task write site). */
export function recordTaskComplete(
  storyId: string,
  entry: { seq: number; title: string; result: string; artifacts?: string[] },
): void {
  const { goal, state } = readState(storyId);
  const result = firstLine(entry.result) || "done";
  const completed = state.completed.filter((c) => c.seq !== entry.seq);
  completed.push({ seq: entry.seq, title: entry.title.slice(0, MAX_TITLE_LEN), result });
  completed.sort((a, b) => a.seq - b.seq);
  const artifacts = entry.artifacts?.length
    ? Array.from(new Set([...state.artifacts, ...entry.artifacts])).slice(0, MAX_ARTIFACTS)
    : state.artifacts;
  writeState(storyId, goal, { completed, artifacts, decisions: state.decisions });
}

/**
 * Render the compact snapshot block for a task prompt, or null if empty.
 * Bounded by construction: completed is capped (with an overflow note),
 * each result/title is truncated, artifacts are capped.
 */
export function renderSnapshotBlock(storyId: string): string | null {
  const { goal, state } = readState(storyId);

  // Lazy backfill for stories created before snapshots existed (CONTEXT.md §12.5):
  // derive completed from done tasks when nothing has been recorded yet.
  let completed = state.completed;
  if (completed.length === 0) {
    const done = db.prepare(
      "SELECT seq, title, impl_summary FROM story_tasks WHERE story_id = ? AND status = 'done' ORDER BY seq ASC",
    ).all(storyId) as Array<{ seq: number; title: string; impl_summary: string | null }>;
    completed = done.map((d) => ({ seq: d.seq, title: d.title, result: firstLine(d.impl_summary) || "done" }));
  }

  // Derived live from the task table — never persisted.
  const inProgress = db.prepare(
    "SELECT seq, title FROM story_tasks WHERE story_id = ? AND status = 'in_progress' ORDER BY seq ASC LIMIT 1",
  ).get(storyId) as { seq: number; title: string } | undefined;
  const blocked = db.prepare(
    "SELECT seq, title FROM story_tasks WHERE story_id = ? AND status IN ('blocked','failed') ORDER BY seq ASC",
  ).all(storyId) as Array<{ seq: number; title: string }>;

  if (!goal && completed.length === 0 && !inProgress && blocked.length === 0 && state.artifacts.length === 0) {
    return null;
  }

  const lines: string[] = ["## Story Snapshot\n"];
  if (goal) lines.push(`**Goal:** ${goal}`);

  if (completed.length > 0) {
    const shown = completed.slice(-MAX_COMPLETED_SHOWN);
    const overflow = completed.length - shown.length;
    const items = shown.map((c) => `- #${c.seq} ${c.title} — ${c.result}`);
    if (overflow > 0) items.unshift(`- _(+${overflow} earlier task${overflow > 1 ? "s" : ""} done)_`);
    lines.push(`**Done:**\n${items.join("\n")}`);
  } else {
    lines.push("**Done:** _(nothing yet)_");
  }

  if (inProgress) lines.push(`**Now:** #${inProgress.seq} ${inProgress.title}`);
  if (blocked.length > 0) lines.push(`**Blocked:** ${blocked.map((b) => `#${b.seq} ${b.title}`).join(", ")}`);
  if (state.artifacts.length > 0) lines.push(`**Key files:** ${state.artifacts.slice(0, MAX_ARTIFACTS).join(", ")}`);

  return lines.join("\n\n");
}
