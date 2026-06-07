import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFlakyRunner } from "./helpers.ts";

// Own process (own DB + orchestrator singleton).
process.env.AGILE_DB_PATH = join(tmpdir(), `agile-giveup-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { __setClaudeRunner } = await import("../server/execution.js");
const { orchestrator } = await import("../server/orchestrator.js");

const storyRow = (id: string) =>
  db.prepare("SELECT status, mode FROM stories WHERE id = ?").get(id) as { status: string; mode: string };

async function waitFor(pred: () => boolean, timeoutMs = 20_000, stepMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

// A non-retryable failure (e.g. session/quota limit) must NOT loop forever: the
// orchestrator gives up immediately and pauses the story to manual.
test("orchestrator gives up on a non-retryable error instead of looping", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({
    enabled: true, workspace_root: wsRoot, poll_interval_ms: 150,
    wip_limit: 2, stall_timeout_ms: 0, max_retry_backoff_ms: 200, max_attempts: 3,
    require_design_review: false,
  }));

  const projectId = nanoid();
  const projectKey = `GU${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, projectKey, "GiveUp Project", repo);
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'fullstack')").run(nanoid(), "Dev Bot");
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'qa')").run(nanoid(), "QA Bot");

  const storyId = nanoid();
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode) " +
    "VALUES (?, ?, ?, 'story', 'Add a small feature', 'todo', 'auto')"
  ).run(storyId, projectId, `${projectKey}-1`);

  // Every implementation attempt fails with a quota-style error.
  __setClaudeRunner(makeFlakyRunner({ failImplFirst: Infinity, errorText: "You've hit your session limit · resets 4:30pm" }));

  try {
    orchestrator.start();

    // It should flip to manual (gave up) rather than spin forever.
    const gaveUp = await waitFor(() => storyRow(storyId).mode === "manual");
    assert.ok(gaveUp, `expected the story to be paused to manual, got mode=${storyRow(storyId).mode}`);

    // And it must not still be running / queued for retry.
    await new Promise((r) => setTimeout(r, 500));
    const snap = orchestrator.snapshot();
    assert.equal(snap.totals.runningCount, 0, "no run should be in flight");
    assert.equal(snap.totals.retryingCount, 0, "no retry should be queued");

    // Non-retryable → it gave up on the first failure, so only ~1 impl run happened.
    const runs = db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE story_id = ?").get(storyId) as { n: number };
    assert.ok(runs.n <= 2, `expected it to stop quickly, saw ${runs.n} runs`);
  } finally {
    await orchestrator.stop();
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});
