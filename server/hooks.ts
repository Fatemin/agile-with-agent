import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Workspace lifecycle hooks — Symphony §9.4.
 *
 * Each hook is a shell script that runs with the workspace directory as cwd.
 *   - after_create:  workspace dir was just created; failure aborts workspace creation
 *   - before_run:    runs before each agent attempt; failure aborts the attempt
 *   - after_run:     runs after each attempt (any outcome); failure logged & ignored
 *   - before_remove: runs before workspace deletion; failure logged & ignored
 */

export type HookKind = "after_create" | "before_run" | "after_run" | "before_remove";

export interface HookResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Run a hook script in the given workspace. Resolves even on failure. */
export async function runHook(opts: {
  kind: HookKind;
  script: string | null | undefined;
  workspacePath: string;
  timeoutMs?: number;
}): Promise<HookResult | null> {
  if (!opts.script || !opts.script.trim()) return null; // no hook configured
  if (!existsSync(opts.workspacePath)) {
    return { ok: false, stdout: "", stderr: "", exitCode: null, durationMs: 0, error: "workspace path does not exist" };
  }

  const shell = process.platform === "win32" ? "cmd.exe" : "bash";
  const shellArgs = process.platform === "win32" ? ["/c"] : ["-lc"];
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise<HookResult>((resolve) => {
    const proc = spawn(shell, [...shellArgs, opts.script!], {
      cwd: opts.workspacePath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 2000);
    }, timeoutMs);

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", (e) => {
      clearTimeout(killTimer);
      resolve({
        ok: false, stdout, stderr, exitCode: null,
        durationMs: Date.now() - started,
        error: e.message,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({
        ok: !timedOut && code === 0,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        exitCode: code,
        durationMs: Date.now() - started,
        timedOut: timedOut || undefined,
        error: timedOut ? `timed out after ${timeoutMs}ms` : (code !== 0 ? `exited with code ${code}` : undefined),
      });
    });
  });
}
