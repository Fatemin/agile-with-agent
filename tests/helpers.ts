import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Type-only imports — erased at runtime, so importing this file does NOT
// trigger db.ts initialization (which must happen after AGILE_DB_PATH is set).
import type { runClaudeCode, RunResult } from "../server/claudeRunner.js";

export type RunnerFn = typeof runClaudeCode;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, cmd: string): string {
  return execSync(`git -C "${cwd}" ${cmd}`, { encoding: "utf8", env: GIT_ENV }).trim();
}

/** Create a throwaway git repo with one commit. Returns its absolute path. */
export function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agile-test-repo-"));
  git(dir, "init -q");
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "Test"');
  writeFileSync(join(dir, "README.md"), "# scratch repo for E2E\n");
  git(dir, "add -A");
  git(dir, 'commit -q -m "init"');
  return dir;
}

/** A fresh temp directory (e.g. for the workspace_root). */
export function makeTempDir(prefix = "agile-test-ws-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Best-effort recursive delete of any temp paths a test created. */
export function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Fake agent runner — stands in for the Claude Code CLI subprocess.
 *
 * It behaves like a real, well-behaved agent:
 *   - Impl tasks: writes a file into the worktree (opts.cwd) and commits it,
 *     proving the agent ran inside the isolated per-story workspace.
 *   - QA tasks (detected by the QA_RESULT instruction in the prompt): returns
 *     a PASS verdict so the chain advances to human_review.
 *
 * Everything else (events, token counts, summary) mirrors the real runner's
 * contract so execution.ts processes it identically.
 */
export function makeFakeRunner(opts?: { qaVerdict?: "PASS" | "FAIL"; failImpl?: boolean }): RunnerFn {
  const qaVerdict = opts?.qaVerdict ?? "PASS";

  const fake: RunnerFn = async function* (runOpts, resultRef) {
    const text = runOpts.prompt + (runOpts.systemPrompt ?? "");
    const isDesign = text.includes("Design Phase");
    const isQA = text.includes("QA_RESULT");
    yield { type: "progress", content: "fake agent initialized" };

    let resultText: string;
    if (isDesign) {
      // Design phase: produce a plan, do NOT touch files.
      resultText = "## Implementation Plan\n\n- Update the relevant module\n- Add a test\n\nApproach: minimal change, follow conventions.";
      yield { type: "text", content: resultText };
      resultRef.current = makeResult(true, resultText);
      return;
    }
    if (isQA) {
      resultText = qaVerdict === "PASS"
        ? "Verified all acceptance criteria.\nQA_RESULT: PASS"
        : "Found a defect.\nQA_RESULT: FAIL — fake verdict for test";
      yield { type: "text", content: resultText };
    } else if (opts?.failImpl) {
      resultRef.current = makeResult(false, "fake impl failure");
      yield { type: "error", content: "fake impl failure" };
      return;
    } else {
      // Write + commit a file inside the worktree to simulate real work.
      const fname = `agent-output-${randomUUID().slice(0, 8)}.md`;
      try {
        writeFileSync(join(runOpts.cwd, fname), `Work for: ${runOpts.prompt.slice(0, 80)}\n`);
        git(runOpts.cwd, "add -A");
        git(runOpts.cwd, `commit -q -m "fake agent change: ${fname}"`);
      } catch { /* worktree may be unwritable in a bug-repro scenario */ }
      resultText = `Implemented the task. Added ${fname}.`;
      yield { type: "tool_call", tool: "write_file", content: fname };
      yield { type: "text", content: resultText };
    }

    resultRef.current = makeResult(true, resultText);
  };
  return fake;
}

/**
 * Like makeFakeRunner, but the first `failImplFirst` implementation attempts
 * fail (returning an error result). Used to exercise the orchestrator's retry
 * path: the run fails, gets retried, and eventually succeeds. QA always passes.
 */
export function makeFlakyRunner(opts: { failImplFirst: number; errorText?: string }): RunnerFn {
  let implCalls = 0;
  const succeed = makeFakeRunner({ qaVerdict: "PASS" });
  const flaky: RunnerFn = async function* (runOpts, resultRef) {
    const isQA = (runOpts.prompt + (runOpts.systemPrompt ?? "")).includes("QA_RESULT");
    if (!isQA) {
      implCalls += 1;
      if (implCalls <= opts.failImplFirst) {
        const msg = opts.errorText ?? `flaky impl failure (attempt ${implCalls})`;
        resultRef.current = makeResult(false, msg);
        yield { type: "error", content: msg };
        return;
      }
    }
    yield* succeed(runOpts, resultRef);
  };
  return flaky;
}

function makeResult(ok: boolean, text: string): RunResult {
  return {
    ok,
    result: text,
    tokensIn: 100, tokensOut: 50, turns: 2,
    model: "fake-model", costUsd: 0, durationMs: 5,
    error: ok ? undefined : text,
  };
}
