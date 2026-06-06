import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFakeRunner } from "./helpers.ts";

// Isolated DB for this test process (node --test runs each file in its own child process).
process.env.AGILE_DB_PATH = join(tmpdir(), `agile-orch-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { __setClaudeRunner } = await import("../server/execution.js");
const { orchestrator } = await import("../server/orchestrator.js");

function configure(workspaceRoot: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({
    enabled: true,
    workspace_root: workspaceRoot,
    poll_interval_ms: 150,     // tick fast so the test is quick
    wip_limit: 2,
    stall_timeout_ms: 0,       // disable stall detection for the test
    timeout_minutes: 1,
  }));
}

function seedAutoStory(repoPath: string): { storyId: string; storyKey: string } {
  const projectId = nanoid();
  const projectKey = `ORCH${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, projectKey, "Orchestrator Project", repoPath);
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'fullstack')").run(nanoid(), "Dev Bot");
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'qa')").run(nanoid(), "QA Bot");

  const storyId = nanoid();
  const storyKey = `${projectKey}-1`;
  // Brand-new auto story: todo, no branch — exactly what a user creates.
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode) " +
    "VALUES (?, ?, ?, 'story', 'Add a small feature', 'todo', 'auto')"
  ).run(storyId, projectId, storyKey);
  return { storyId, storyKey };
}

const statusOf = (id: string) =>
  (db.prepare("SELECT status FROM stories WHERE id = ?").get(id) as { status: string }).status;

async function waitFor(pred: () => boolean, timeoutMs = 20_000, stepMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

test("orchestrator drives an auto story: todo → (poll/dispatch) → human_review → done", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  configure(wsRoot);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "PASS" }));
  const { storyId, storyKey } = seedAutoStory(repo);

  try {
    // Real scheduler: poll loop picks up the todo/auto story on its own.
    orchestrator.start();

    const reached = await waitFor(() => statusOf(storyId) === "human_review");
    assert.ok(reached, `expected human_review, got "${statusOf(storyId)}"`);

    const story = db.prepare("SELECT status, qa_result, branch_name FROM stories WHERE id = ?").get(storyId) as
      { status: string; qa_result: string | null; branch_name: string | null };
    assert.equal(story.qa_result, "pass");
    assert.ok(story.branch_name, "orchestrator should have assigned a branch");
    assert.ok(existsSync(join(wsRoot, storyKey)), "per-story worktree should exist");
    assert.equal(orchestrator.snapshot().totals.runningCount, 0, "worker should have exited after human_review");

    // Human acknowledges → Done (terminal). Orchestrator must not re-pick it up.
    db.prepare("UPDATE stories SET status = 'done' WHERE id = ?").run(storyId);
    orchestrator.kick();
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(statusOf(storyId), "done");
    assert.equal(orchestrator.snapshot().totals.runningCount, 0, "terminal story must not be running");
  } finally {
    await orchestrator.stop();
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});
