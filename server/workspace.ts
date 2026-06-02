import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/**
 * Workspace management — Symphony §9.
 *
 * Each story gets its own isolated filesystem workspace under `workspace_root`,
 * implemented as a git worktree rooted at the story's branch. This guarantees:
 *   - Agent cwd is per-story, never the main project directory.
 *   - Multiple stories can run in parallel without stepping on each other.
 *   - Workspaces are reused across runs for the same story.
 */

export interface WorkspaceResult {
  ok: boolean;
  path?: string;
  created_now?: boolean;
  error?: string;
}

/** Section 9.5 Invariant 3: workspace key sanitization. */
export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Default workspace root (overridable via runtime config). */
export function defaultWorkspaceRoot(): string {
  return join(tmpdir(), "agile_workspaces");
}

/** Section 9.5 Invariant 2: ensure path stays inside workspace root. */
function isInsideRoot(workspacePath: string, workspaceRoot: string): boolean {
  const abs = resolve(workspacePath);
  const rootAbs = resolve(workspaceRoot);
  return abs === rootAbs || abs.startsWith(rootAbs + sep);
}

function git(cwd: string, cmd: string, timeoutMs = 15_000): string {
  return execSync(`git -C "${cwd}" ${cmd}`, { encoding: "utf8", timeout: timeoutMs }).trim();
}

function gitInDir(dir: string, args: string[], timeoutMs = 15_000): string {
  // For commands that don't accept -C cleanly (e.g. clone). Use full quoting.
  return execSync(`git ${args.map((a) => `"${a}"`).join(" ")}`, {
    encoding: "utf8", timeout: timeoutMs, cwd: dir,
  }).trim();
}

/**
 * Create-or-reuse a per-story workspace as a git worktree of `branchName`
 * checked out from `repoPath`.
 *
 * Returns `created_now=true` only when the directory was created during this
 * call (for hook gating per §9.2).
 */
export function ensureWorkspace(opts: {
  workspaceRoot: string;
  storyKey: string;
  repoPath: string;
  branchName: string | null;
}): WorkspaceResult {
  const { workspaceRoot, storyKey, repoPath } = opts;
  const branchName = opts.branchName;

  if (!existsSync(repoPath)) {
    return { ok: false, error: `Project repo not found: ${repoPath}` };
  }

  // Ensure root exists
  try {
    if (!existsSync(workspaceRoot)) mkdirSync(workspaceRoot, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Cannot create workspace root: ${e instanceof Error ? e.message : String(e)}` };
  }

  const key = sanitizeWorkspaceKey(storyKey);
  const wsPath = join(workspaceRoot, key);

  if (!isInsideRoot(wsPath, workspaceRoot)) {
    return { ok: false, error: `Workspace path escapes root: ${wsPath}` };
  }

  if (existsSync(wsPath)) {
    return { ok: true, path: wsPath, created_now: false };
  }

  // Verify repo is a git repo
  try { git(repoPath, "rev-parse --git-dir"); } catch {
    return { ok: false, error: `${repoPath} is not a git repository` };
  }

  // Pick a branch to check out. If none provided, fall back to repo's HEAD.
  let targetBranch = branchName;
  if (!targetBranch) {
    try {
      targetBranch = git(repoPath, "branch --show-current") || "HEAD";
    } catch {
      targetBranch = "HEAD";
    }
  }

  try {
    // If the branch doesn't exist locally yet, create it pointed at HEAD.
    // (Caller usually creates the branch first; this is a safety net.)
    const exists = git(repoPath, `branch --list "${targetBranch}"`);
    if (!exists && targetBranch !== "HEAD") {
      try { git(repoPath, `branch "${targetBranch}"`); } catch { /* may already exist as remote tracking */ }
    }

    // `git worktree add` creates the directory.
    git(repoPath, `worktree add "${wsPath}" "${targetBranch}"`, 60_000);
    return { ok: true, path: wsPath, created_now: true };
  } catch (e) {
    return { ok: false, error: `git worktree add failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Remove a workspace. Safe to call even if it doesn't exist.
 * Uses `git worktree remove --force` when possible, then falls back to rm.
 */
export function removeWorkspace(opts: {
  workspaceRoot: string;
  storyKey: string;
  repoPath: string;
}): WorkspaceResult {
  const { workspaceRoot, storyKey, repoPath } = opts;
  const key = sanitizeWorkspaceKey(storyKey);
  const wsPath = join(workspaceRoot, key);

  if (!isInsideRoot(wsPath, workspaceRoot)) {
    return { ok: false, error: `Refusing to remove path outside workspace root: ${wsPath}` };
  }
  if (!existsSync(wsPath)) return { ok: true, path: wsPath, created_now: false };

  // Best-effort: tell git to release the worktree first
  if (existsSync(repoPath)) {
    try { git(repoPath, `worktree remove --force "${wsPath}"`, 30_000); }
    catch { /* fall through to rm */ }
  }
  try {
    if (existsSync(wsPath)) rmSync(wsPath, { recursive: true, force: true });
    return { ok: true, path: wsPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** List all worktree directories under the root (best-effort, for restart cleanup). */
export function listWorkspaceKeys(workspaceRoot: string): string[] {
  if (!existsSync(workspaceRoot)) return [];
  try {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(workspaceRoot).filter((name) => {
      try { return statSync(join(workspaceRoot, name)).isDirectory(); }
      catch { return false; }
    });
  } catch { return []; }
}
