import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFakeRunner } from "./helpers.ts";

// note: makeFlakyRunner + orchestrator retry/recovery live in their own files
// (orchestrator-retry / orchestrator-recovery) because the orchestrator is a
// singleton that cannot be restarted after stop() within one process.

// MUST run before any server module is imported: db.ts reads AGILE_DB_PATH at
// import time. Static imports above don't touch the DB; the server modules are
// pulled in dynamically below, after this assignment.
process.env.AGILE_DB_PATH = join(tmpdir(), `agile-test-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { __setClaudeRunner, executeStory, executePipeline, executeTechLeadPlan } =
  await import("../server/execution.js");
const { ensureWorkspace } = await import("../server/workspace.js");
const { createBranch, createBranchNoCheckout, buildBranchName } = await import("../server/git.js");

// ── seeding helpers ──────────────────────────────────────────────────────────

function setWorkspaceRoot(root: string): void {
  const cfg = JSON.stringify({ enabled: true, workspace_root: root });
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(cfg);
}

function seedStory(repoPath: string, branchName: string): { storyId: string; storyKey: string } {
  const projectId = nanoid();
  const projectKey = `E2E${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, projectKey, "E2E Project", repoPath);

  // One implementer + one QA agent, both idle.
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'fullstack')").run(nanoid(), "Dev Bot");
  db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'qa')").run(nanoid(), "QA Bot");

  const storyId = nanoid();
  const storyKey = `${projectKey}-1`;
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode, branch_name) " +
    "VALUES (?, ?, ?, 'story', 'Add a small feature', 'in_progress', 'manual', ?)"
  ).run(storyId, projectId, storyKey, branchName);

  return { storyId, storyKey };
}

/** Seed a project + story with a custom title and a chosen set of agent roles. */
function seedStoryCustom(
  repoPath: string,
  opts: { title: string; branchName?: string; roles?: string[] },
): { storyId: string; storyKey: string } {
  const projectId = nanoid();
  const projectKey = `E2E${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
    .run(projectId, projectKey, "E2E Project", repoPath);
  for (const role of opts.roles ?? ["fullstack", "qa"]) {
    db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, ?)").run(nanoid(), `${role} Bot`, role);
  }
  const storyId = nanoid();
  const storyKey = `${projectKey}-1`;
  db.prepare(
    "INSERT INTO stories (id, project_id, key, type, title, status, mode, branch_name) " +
    "VALUES (?, ?, ?, 'story', ?, 'in_progress', 'manual', ?)"
  ).run(storyId, projectId, storyKey, opts.title, opts.branchName ?? null);
  return { storyId, storyKey };
}

// ── A-layer E2E: the full business chain, offline ────────────────────────────

test("happy path: plan → worktree → impl → QA → human_review", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "PASS" }));

  try {
    const { storyId, storyKey } = seedStory(repo, "feature/happy-1");

    const events: Array<{ type: string }> = [];
    for await (const e of executeStory(storyId)) events.push(e);

    const story = db.prepare("SELECT status, qa_result FROM stories WHERE id = ?").get(storyId) as
      { status: string; qa_result: string | null };
    const tasks = db.prepare("SELECT role, status FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
      Array<{ role: string; status: string }>;
    const runs = db.prepare("SELECT run_type FROM agent_runs WHERE story_id = ?").all(storyId) as
      Array<{ run_type: string }>;

    // Tech Lead planned tasks, ending with a QA gate.
    assert.ok(tasks.length >= 2, "expected at least one impl task + a QA task");
    assert.ok(tasks.some((t) => t.role === "qa"), "expected a QA task");
    assert.ok(
      tasks.filter((t) => t.role !== "qa").every((t) => t.status === "done"),
      "all implementation tasks should be done",
    );

    // The agent ran in an isolated per-story worktree under workspace_root.
    assert.ok(existsSync(join(wsRoot, storyKey)), "per-story worktree should exist");

    // QA passed → story handed off to human review.
    assert.equal(story.status, "human_review");
    assert.equal(story.qa_result, "pass");

    // Agent runs were recorded for cost/observability.
    assert.ok(runs.length >= 1, "expected recorded agent runs");
    assert.ok(events.some((e) => e.type === "done"), "stream should end with a done event");
  } finally {
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});

// ── Regression: branch creation must be compatible with the worktree model ───
// Background (fixed): the story branch used to be created with `git checkout -b`
// in the main repo, which made the subsequent `git worktree add <branch>` fail
// because git forbids the same branch in two worktrees. The fix is
// createBranchNoCheckout (`git branch`), used by orchestrator.dispatch and the
// manual PATCH path. These two tests pin both halves of that fact.

test("regression: createBranchNoCheckout lets the worktree claim the branch", () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  try {
    const key = "FIX-1";
    const branch = buildBranchName(key, "demo story");

    const cb = createBranchNoCheckout(repo, branch); // what dispatch now does
    assert.equal(cb.ok, true);

    const ws = ensureWorkspace({ workspaceRoot: wsRoot, storyKey: key, repoPath: repo, branchName: branch });
    assert.equal(ws.ok, true, "worktree add should succeed — branch is not checked out in the main repo");
    assert.ok(existsSync(join(wsRoot, key)), "worktree directory should exist");
  } finally {
    cleanup(repo, wsRoot);
  }
});

test("guard: the old checkout -b approach still conflicts (why the fix is needed)", () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  try {
    const key = "OLD-1";
    const branch = buildBranchName(key, "demo story");

    const cb = createBranch(repo, branch); // the old, checkout-based approach
    assert.equal(cb.ok, true);

    const ws = ensureWorkspace({ workspaceRoot: wsRoot, storyKey: key, repoPath: repo, branchName: branch });
    assert.equal(ws.ok, false, "branch is checked out in the main repo, so worktree add must fail");
    assert.match(ws.error ?? "", /already (checked out|used by worktree)|worktree add failed/i);
  } finally {
    cleanup(repo, wsRoot);
  }
});

// ── Planner shape (A3 fixed) ─────────────────────────────────────────────────
// inferTasks now splits a story that touches BOTH the UI and the server into a
// backend task + a frontend task (+ QA), and keeps a single-domain story at one
// impl task (+ QA).

test("planner: a cross-stack story splits into backend → frontend → QA", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  try {
    const { storyId } = seedStoryCustom(repo, {
      title: "Add API endpoint and UI component for search",
      roles: ["backend", "frontend", "qa"],
    });

    for await (const _ of executeTechLeadPlan(storyId)) { /* plan only */ }

    const tasks = db.prepare("SELECT seq, role FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
      Array<{ seq: number; role: string }>;

    assert.deepEqual(tasks.map((t) => t.role), ["backend", "frontend", "qa"],
      "cross-stack story → backend, then frontend, then QA");
    // The frontend task should depend on the backend task (sequential chain).
    const feDeps = db.prepare("SELECT depends_on FROM story_tasks WHERE story_id = ? AND role = 'frontend'").get(storyId) as
      { depends_on: string };
    assert.deepEqual(JSON.parse(feDeps.depends_on), [1], "frontend depends on the backend task");
  } finally {
    cleanup(repo, wsRoot);
  }
});

test("planner: a single-domain (frontend-only) story yields 1 impl task + 1 QA gate", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  try {
    const { storyId } = seedStoryCustom(repo, {
      title: "Restyle the settings page layout and components",
      roles: ["frontend", "qa"],
    });

    for await (const _ of executeTechLeadPlan(storyId)) { /* plan only */ }

    const tasks = db.prepare("SELECT role FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
      Array<{ role: string }>;

    assert.deepEqual(tasks.map((t) => t.role), ["frontend", "qa"], "single-domain story → one impl + QA");
  } finally {
    cleanup(repo, wsRoot);
  }
});

// ── Multi-task pipeline engine ───────────────────────────────────────────────
// Even though the planner emits a single impl task today, executePipeline must
// run an arbitrary ordered set of tasks. Seed a 2-impl + QA pipeline directly
// and verify sequential execution, per-task completion, and the QA hand-off.

test("pipeline: runs a seeded backend → frontend → QA pipeline in order → human_review", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "PASS" }));
  try {
    const { storyId, storyKey } = seedStoryCustom(repo, {
      title: "Build search feature",
      branchName: "feature/pipeline-1",
      roles: ["backend", "frontend", "qa"],
    });
    db.prepare("UPDATE stories SET pipeline_mode = 1 WHERE id = ?").run(storyId);

    const mkTask = (seq: number, role: string, title: string, dependsOn: number[]) =>
      db.prepare(
        "INSERT INTO story_tasks (id, story_id, seq, title, role, depends_on, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'todo')"
      ).run(nanoid(), storyId, seq, title, role, JSON.stringify(dependsOn));
    mkTask(1, "backend", "Backend: search API", []);
    mkTask(2, "frontend", "Frontend: search UI", [1]);
    mkTask(3, "qa", "QA verification", [2]);

    for await (const _ of executePipeline(storyId)) { /* drain */ }

    const tasks = db.prepare("SELECT seq, role, status FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
      Array<{ seq: number; role: string; status: string }>;
    const story = db.prepare("SELECT status, qa_result FROM stories WHERE id = ?").get(storyId) as
      { status: string; qa_result: string | null };

    assert.deepEqual(tasks.map((t) => t.status), ["done", "done", "done"], "every task should complete");
    assert.ok(existsSync(join(wsRoot, storyKey)), "all tasks share one per-story worktree");
    assert.equal(story.qa_result, "pass");
    assert.equal(story.status, "human_review");
  } finally {
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});

// ── QA gate (A2) ──────────────────────────────────────────────────────────────

test("QA FAIL is recorded as qa_result='fail'", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "FAIL" }));
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Add a small feature", branchName: "feature/qa-fail-1" });
    for await (const _ of executeStory(storyId)) { /* drain */ }
    const story = db.prepare("SELECT qa_result FROM stories WHERE id = ?").get(storyId) as { qa_result: string | null };
    assert.equal(story.qa_result, "fail");
  } finally {
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});

// A2 (fixed): QA is now a hard gate. On FAIL, executeQA yields an `error`, the
// pipeline halts, and the story stays in_progress (NOT human_review). The QA
// task itself is marked failed.
test("QA FAIL blocks hand-off: story stays in_progress, QA task failed", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "FAIL" }));
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Add a small feature", branchName: "feature/qa-fail-2" });
    for await (const _ of executeStory(storyId)) { /* drain */ }

    const story = db.prepare("SELECT status, qa_result FROM stories WHERE id = ?").get(storyId) as
      { status: string; qa_result: string | null };
    const qaTask = db.prepare("SELECT status FROM story_tasks WHERE story_id = ? AND role = 'qa'").get(storyId) as
      { status: string } | undefined;

    assert.notEqual(story.status, "human_review", "a failed QA must not hand the story to human review");
    assert.equal(story.status, "in_progress", "story stays in_progress for rework after a failed QA");
    assert.equal(story.qa_result, "fail");
    assert.equal(qaTask?.status, "failed", "the QA task should be marked failed");
  } finally {
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});
