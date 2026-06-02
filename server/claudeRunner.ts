import { spawn } from "node:child_process";
import readline from "node:readline";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import type { PermissionMode } from "./runtimeConfig.js";

export type ExecutionEventType = "progress" | "text" | "tool_call" | "tool_result" | "done" | "error";

export interface ExecutionEvent {
  type: ExecutionEventType;
  content?: string;
  tool?: string;
  input?: unknown;
}

export interface RunOptions {
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  permissionMode?: PermissionMode;
  model?: string;
  cliPath?: string;
  timeoutMs?: number;
  /** When aborted, the child process is killed and the generator returns an error. */
  signal?: AbortSignal;
}

export interface RunResult {
  ok: boolean;
  result: string;
  tokensIn: number;
  tokensOut: number;
  turns: number;
  model: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  model?: string;
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      content?: string | Array<{ type: string; text?: string }>;
    }>;
  };
}

/**
 * Spawn `claude` (Claude Code CLI) headlessly, stream parsed events back to
 * the caller, and place the final aggregated result into `resultRef.current`.
 *
 * The prompt is fed via stdin in stream-json format so its contents never
 * pass through shell parsing (no need to escape quotes / %VAR% / `).
 */
export async function* runClaudeCode(
  opts: RunOptions,
  resultRef: { current: RunResult | null },
): AsyncGenerator<ExecutionEvent> {
  const cliPath = opts.cliPath ?? (process.platform === "win32" ? "claude.cmd" : "claude");
  const args: string[] = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--input-format", "stream-json",
    "--permission-mode", opts.permissionMode ?? "acceptEdits",
  ];
  if (opts.model)        args.push("--model", opts.model);
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);

  let proc;
  try {
    proc = spawn(cliPath, args, {
      cwd: opts.cwd,
      shell: process.platform === "win32", // resolve npm .cmd shim on Windows
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    resultRef.current = {
      ok: false, result: "", tokensIn: 0, tokensOut: 0, turns: 0,
      model: opts.model ?? "unknown", costUsd: 0, durationMs: 0,
      error: `Failed to spawn '${cliPath}': ${msg}`,
    };
    yield { type: "error", content: resultRef.current.error! };
    return;
  }

  // Feed prompt via stdin (stream-json input)
  try {
    proc.stdin.write(JSON.stringify({
      type: "user",
      message: { role: "user", content: opts.prompt },
    }) + "\n");
    proc.stdin.end();
  } catch {
    // proc may have already failed; we'll surface via the result path below
  }

  let resultEvent: ClaudeEvent | null = null;
  let assistantText = "";
  let stderrBuf = "";
  let spawnError: string | null = null;
  let abortedExternally = false;

  proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString(); });
  proc.on("error", (e) => { spawnError = e.message; });

  // Optional timeout — kill the process if it runs too long
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const killTimer = setTimeout(() => {
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  }, timeoutMs);

  // External abort (orchestrator reconciliation / shutdown)
  const onAbort = () => {
    abortedExternally = true;
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    // Give it a moment, then SIGKILL if still alive
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 3000);
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  const rl = readline.createInterface({ input: proc.stdout });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: ClaudeEvent;
      try { event = JSON.parse(trimmed) as ClaudeEvent; } catch { continue; }

      if (event.type === "system" && event.subtype === "init") {
        yield { type: "progress", content: `Agent initialized (${event.model ?? opts.model ?? "?"})` };
      } else if (event.type === "assistant" && event.message?.content) {
        for (const item of event.message.content) {
          if (item.type === "text" && item.text) {
            assistantText += item.text;
            yield { type: "text", content: item.text };
          } else if (item.type === "tool_use") {
            const inputStr = JSON.stringify(item.input ?? {}).slice(0, 250);
            yield { type: "tool_call", tool: item.name, content: inputStr, input: item.input };
          }
        }
      } else if (event.type === "user" && event.message?.content) {
        for (const item of event.message.content) {
          if (item.type === "tool_result") {
            const c = item.content;
            const text = typeof c === "string"
              ? c
              : Array.isArray(c)
                ? c.map((x) => x.text ?? "").join("")
                : JSON.stringify(c);
            yield { type: "tool_result", content: text.slice(0, 500) };
          }
        }
      } else if (event.type === "result") {
        resultEvent = event;
      }
    }
  } finally {
    clearTimeout(killTimer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }

  // Wait for the process to fully close so we can read exit info
  const exitCode: number = await new Promise((resolve) => {
    if (proc.exitCode != null) { resolve(proc.exitCode); return; }
    proc.on("close", (code) => resolve(code ?? 0));
  });

  if (abortedExternally) {
    resultRef.current = {
      ok: false,
      result: assistantText,
      tokensIn: resultEvent?.usage?.input_tokens ?? 0,
      tokensOut: resultEvent?.usage?.output_tokens ?? 0,
      turns: resultEvent?.num_turns ?? 0,
      model: opts.model ?? "unknown",
      costUsd: resultEvent?.total_cost_usd ?? 0,
      durationMs: resultEvent?.duration_ms ?? 0,
      error: "aborted",
    };
  } else if (resultEvent) {
    resultRef.current = {
      ok: !resultEvent.is_error,
      result: resultEvent.result ?? assistantText,
      tokensIn: resultEvent.usage?.input_tokens ?? 0,
      tokensOut: resultEvent.usage?.output_tokens ?? 0,
      turns: resultEvent.num_turns ?? 0,
      model: resultEvent.model ?? opts.model ?? "unknown",
      costUsd: resultEvent.total_cost_usd ?? 0,
      durationMs: resultEvent.duration_ms ?? 0,
      error: resultEvent.is_error ? (resultEvent.result ?? "Agent reported error") : undefined,
    };
  } else {
    const errBits = [
      spawnError ? `spawn error: ${spawnError}` : null,
      exitCode !== 0 ? `exit code ${exitCode}` : null,
      stderrBuf ? `stderr: ${stderrBuf.slice(0, 800)}` : null,
    ].filter(Boolean).join(" — ");
    resultRef.current = {
      ok: false,
      result: assistantText,
      tokensIn: 0, tokensOut: 0, turns: 0,
      model: opts.model ?? "unknown",
      costUsd: 0, durationMs: 0,
      error: `claude-code exited without a result event (${errBits || "no diagnostic output"})`,
    };
  }
}

export function recordAgentRun(opts: {
  storyId: string;
  taskId?: string | null;
  agentId: string;
  runType: string;
  promptText: string;
  result: RunResult;
}): void {
  db.prepare(`
    INSERT INTO agent_runs (id, story_id, task_id, agent_id, run_type, model, provider,
                            tokens_in, tokens_out, turns, prompt_text, output_text)
    VALUES (?, ?, ?, ?, ?, ?, 'claude-code', ?, ?, ?, ?, ?)
  `).run(
    nanoid(), opts.storyId, opts.taskId ?? null, opts.agentId,
    opts.runType, opts.result.model,
    opts.result.tokensIn, opts.result.tokensOut, opts.result.turns,
    opts.promptText, opts.result.result,
  );
}
