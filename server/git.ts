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

export function buildSprintBranchName(sprintName: string): string {
  return `sprint/${slugify(sprintName)}`;
}

export function createBranchFrom(localPath: string, branchName: string, fromBranch: string): GitResult {
  if (!localPath || !existsSync(localPath)) {
    return { ok: false, error: `Directory not found: ${localPath}` };
  }
  const git = (cmd: string) =>
    execSync(`git -C "${localPath}" ${cmd}`, { encoding: "utf8", timeout: 10_000 }).trim();
  try { git("rev-parse --git-dir"); } catch {
    return { ok: false, error: `${localPath} is not a git repository` };
  }
  try {
    const existing = git(`branch --list "${branchName}"`).trim();
    if (existing) {
      git(`checkout "${branchName}"`);
      return { ok: true, branch: branchName };
    }
    // Ensure the base branch exists locally (may need to fetch)
    const baseBranches = git(`branch --list "${fromBranch}"`).trim();
    if (!baseBranches) {
      // Try remote
      try { git(`fetch origin "${fromBranch}:${fromBranch}"`); } catch { /* best-effort */ }
    }
    git(`checkout -b "${branchName}" "${fromBranch}"`);
    return { ok: true, branch: branchName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function mergeBranch(localPath: string, fromBranch: string, intoBranch: string): GitResult {
  if (!localPath || !existsSync(localPath)) {
    return { ok: false, error: `Directory not found: ${localPath}` };
  }
  const git = (cmd: string) =>
    execSync(`git -C "${localPath}" ${cmd}`, { encoding: "utf8", timeout: 30_000 }).trim();
  try { git("rev-parse --git-dir"); } catch {
    return { ok: false, error: `${localPath} is not a git repository` };
  }
  try {
    git(`checkout "${intoBranch}"`);
    git(`merge --no-ff "${fromBranch}" -m "Merge ${fromBranch} into ${intoBranch}"`);
    return { ok: true, branch: intoBranch };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function getCurrentBranch(localPath: string): string | null {
  if (!localPath || !existsSync(localPath)) return null;
  try {
    return execSync(`git -C "${localPath}" branch --show-current`, {
      encoding: "utf8", timeout: 5_000,
    }).trim() || null;
  } catch {
    return null;
  }
}
