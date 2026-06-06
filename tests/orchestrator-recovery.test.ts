import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup } from "./helpers.ts";

process.env.AGILE_DB_PATH = join(tmpdir(), `agile-recover-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { orchestrator } = await import("../server/orchestrator.js");

// recoverFromRestart() runs synchronously at startup. It (1) garbage-collects
// workspaces left behind by terminal stories, and (2) flags in-flight auto
// stories for re-pickup. This test covers (1) without the poll loop, so no
// start()/stop() is needed.

test("recoverFromRestart removes the workspace of a terminal story", () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({ enabled: true, workspace_root: wsRoot }));

  const projectId = nanoid();
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, "REC", "Recovery Project", repo);

  const storyKey = "REC-1";
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode) " +
    "VALUES (?, ?, ?, 'story', 'Done story', 'done', 'auto')"
  ).run(nanoid(), projectId, storyKey);

  // Simulate a leftover workspace from before the (re)start.
  const wsPath = join(wsRoot, storyKey);
  mkdirSync(wsPath, { recursive: true });
  assert.ok(existsSync(wsPath), "precondition: stale workspace exists");

  try {
    orchestrator.recoverFromRestart();
    assert.ok(!existsSync(wsPath), "terminal story's workspace should be cleaned up on recovery");
  } finally {
    cleanup(repo, wsRoot);
  }
});
