import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFlakyRunner } from "./helpers.ts";

// Own process (own DB + own orchestrator singleton): the orchestrator can't be
// restarted after stop(), so each start()-based scenario lives in its own file.
process.env.AGILE_DB_PATH = join(tmpdir(), `agile-retry-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { __setClaudeRunner } = await import("../server/execution.js");
const { orchestrator } = await import("../server/orchestrator.js");

const statusOf = (id: string) =>
  (db.prepare("SELECT status FROM stories WHERE id = ?").get(id) as { status: string }).status;

async function waitFor(pred: () => boolean, timeoutMs = 25_000, stepMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

test("orchestrator retries a transient failure and the story still reaches human_review", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({
    enabled: true,
    workspace_root: wsRoot,
    poll_interval_ms: 150,
    wip_limit: 2,
    stall_timeout_ms: 0,
    max_retry_backoff_ms: 300, // keep the retry backoff tiny so the test is quick
    timeout_minutes: 1,
    require_design_review: false,
  }));

  const projectId = nanoid();
  const projectKey = `RTY${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, projectKey, "Retry Project", repo);
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'fullstack')").run(nanoid(), "Dev Bot");
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'qa')").run(nanoid(), "QA Bot");

  const storyId = nanoid();
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode) " +
    "VALUES (?, ?, ?, 'story', 'Add a small feature', 'todo', 'auto')"
  ).run(storyId, projectId, `${projectKey}-1`);

  // First implementation attempt fails; the orchestrator should retry and succeed.
  __setClaudeRunner(makeFlakyRunner({ failImplFirst: 1 }));

  try {
    orchestrator.start();

    const reached = await waitFor(() => statusOf(storyId) === "human_review");
    assert.ok(reached, `expected human_review after retry, got "${statusOf(storyId)}"`);

    // The retry path actually fired (orchestrator logged a failed attempt + retry).
    const retried = db.prepare(
      "SELECT COUNT(*) AS n FROM story_activities WHERE story_id = ? AND content LIKE '%retry%'"
    ).get(storyId) as { n: number };
    assert.ok(retried.n >= 1, "expected an orchestrator retry log entry");

    const story = db.prepare("SELECT qa_result FROM stories WHERE id = ?").get(storyId) as { qa_result: string | null };
    assert.equal(story.qa_result, "pass");
  } finally {
    await orchestrator.stop();
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});
