import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function buildBranchName(storyKey: string, storyTitle: string): string {
  return `feature/${storyKey.toLowerCase()}-${slugify(storyTitle)}`;
}

export interface GitResult {
  ok: boolean;
  branch?: string;
  error?: string;
}

export function createBranch(localPath: string, branchName: string): GitResult {
  if (!localPath || !existsSync(localPath)) {
    return { ok: false, error: `Directory not found: ${localPath}` };
  }

  const git = (cmd: string) =>
    execSync(`git -C "${localPath}" ${cmd}`, { encoding: "utf8", timeout: 10_000 }).trim();

  try {
    // Verify it's a git repo
    git("rev-parse --git-dir");
  } catch {
    return { ok: false, error: `${localPath} is not a git repository` };
  }

  try {
    // Check if branch already exists
    const existing = git(`branch --list "${branchName}"`).trim();
    if (existing) {
      // Branch exists — just switch to it
      git(`checkout "${branchName}"`);
      return { ok: true, branch: branchName };
    }

    // Create and switch to new branch
    git(`checkout -b "${branchName}"`);
    return { ok: true, branch: branchName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a branch at the current HEAD **without** checking it out, then leave
 * the main working tree untouched. This is required for the per-story worktree
 * model: git refuses `worktree add <branch>` if that branch is already checked
 * out in another worktree (which is exactly what `createBranch`'s `checkout -b`
 * would cause in the main repo). Idempotent — reuses the branch if it exists.
 */
export function createBranchNoCheckout(localPath: string, branchName: string): GitResult {
  if (!localPath || !existsSync(localPath)) {
    return { ok: false, error: `Directory not found: ${localPath}` };
  }

  const git = (cmd: string) =>
    execSync(`git -C "${localPath}" ${cmd}`, { encoding: "utf8", timeout: 10_000 }).trim();

  try {
    git("rev-parse --git-dir");
  } catch {
    return { ok: false, error: `${localPath} is not a git repository` };
  }

  try {
    const existing = git(`branch --list "${branchName}"`).trim();
    if (existing) return { ok: true, branch: branchName }; // reuse; don't switch
    git(`branch "${branchName}"`); // create at HEAD, do NOT check it out
    return { ok: true, branch: branchName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function buildSprintBranchName(sprintName: string): string {
  return `sprint/${slugify(sprintName)}`;
}

