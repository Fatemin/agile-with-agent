import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFakeRunner, type RunnerFn } from "./helpers.ts";

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
const { detectStoryLanguage, buildDesignPrompt } = await import("../server/designGuide.js");
const { buildTaskPromptBlocks } = await import("../server/contextBuilder.js");
const { recordTaskComplete } = await import("../server/snapshot.js");
const { parseDecisionMarkers, recordDecisions, renderDecisionsBlock } = await import("../server/decisions.js");
const { parseTaskPlan } = await import("../server/planner.js");
const { parseArtifactMarkers, inferKind, registerArtifacts, renderArtifactManifest } = await import("../server/artifacts.js");

// ── seeding helpers ──────────────────────────────────────────────────────────

function setWorkspaceRoot(root: string, requireDesignReview = false): void {
  const cfg = JSON.stringify({ enabled: true, workspace_root: root, require_design_review: requireDesignReview });
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

// ── Design guide (skill) ──────────────────────────────────────────────────────

test("design guide: detects story language and tells the agent to match it", () => {
  assert.equal(detectStoryLanguage("As a user, I want a setting"), "English");
  assert.equal(detectStoryLanguage("新建 story 时默认是 auto"), "Chinese");
  // Mixed text with any CJK → Chinese (matches the story's dominant language).
  assert.equal(detectStoryLanguage("As a USER, I want 新建story时默认是auto"), "Chinese");

  const cn = buildDesignPrompt({ storyText: "新建story默认auto" });
  assert.ok(cn.startsWith("## Design Phase"), "keeps the design-run marker");
  assert.match(cn, /Chinese/);
  assert.match(cn, /Affected files|Acceptance criteria check/); // structured sections present
  assert.match(buildDesignPrompt({ storyText: "Add a setting" }), /English/);
});

// ── Design-review gate ────────────────────────────────────────────────────────
// With require_design_review on, executeStory first drafts a design and parks at
// design_review (no implementation). After a human approves (→ in_progress), a
// second pass implements and reaches human_review.

test("design gate: drafts a design, parks at design_review, then implements after approval", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot, /* requireDesignReview */ true);
  __setClaudeRunner(makeFakeRunner({ qaVerdict: "PASS" }));

  try {
    const { storyId } = seedStoryCustom(repo, {
      title: "Add a small feature",
      branchName: "feature/design-1",
      roles: ["techlead", "fullstack", "qa"],
    });

    // Pass 1 — design only.
    for await (const _ of executeStory(storyId)) { /* drain */ }

    let story = db.prepare("SELECT status, design FROM stories WHERE id = ?").get(storyId) as
      { status: string; design: string | null };
    assert.equal(story.status, "design_review", "should park at design_review");
    assert.ok(story.design && story.design.length > 0, "a design should be recorded");

    const tasksAfterDesign = db.prepare("SELECT status FROM story_tasks WHERE story_id = ?").all(storyId) as
      Array<{ status: string }>;
    assert.ok(tasksAfterDesign.length >= 1, "the task breakdown should be created");
    assert.ok(tasksAfterDesign.every((t) => t.status === "todo"), "no implementation should have run yet");

    // Human approves → in_progress.
    db.prepare("UPDATE stories SET status = 'in_progress' WHERE id = ?").run(storyId);

    // Pass 2 — implementation runs to completion.
    for await (const _ of executeStory(storyId)) { /* drain */ }

    story = db.prepare("SELECT status, design FROM stories WHERE id = ?").get(storyId) as
      { status: string; design: string | null };
    const qa = db.prepare("SELECT qa_result FROM stories WHERE id = ?").get(storyId) as { qa_result: string | null };
    assert.equal(story.status, "human_review", "after approval, implementation should reach human_review");
    assert.equal(qa.qa_result, "pass");
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

// ── Snapshot bounds prompt size (CONTEXT.md §6) ──────────────────────────────
// The primary leak this redesign fixes: the prompt used to concatenate every
// prior task's full impl_summary, so it grew O(tasks). The story snapshot caps
// shown completions and truncates each to one short line, so a task prompt is
// ≈ constant no matter how many tasks precede it.

test("snapshot bounds prompt size: ~constant beyond the cap, no full-summary bloat", async () => {
  const repo = makeTempRepo();
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Big multi-task story", roles: ["fullstack", "qa"] });
    const bigSummary = "Implemented a substantial chunk of the feature. ".repeat(300); // ~14k chars

    function tokensAfter(n: number): number {
      db.prepare("DELETE FROM story_snapshot WHERE story_id = ?").run(storyId);
      for (let i = 1; i <= n; i++) {
        recordTaskComplete(storyId, {
          seq: i,
          title: `Task ${i}: a fairly long descriptive task title here`,
          result: bigSummary,
        });
      }
      return buildTaskPromptBlocks({
        storyId,
        taskTitle: "Next task",
        taskDescription: "Do the next thing",
        agentSystemPrompt: "You are an engineer.",
        agentRole: "fullstack",
      }).estimatedTokens;
    }

    const atCap = tokensAfter(13);   // 12 shown + an overflow note
    const wayOver = tokensAfter(60); // also 12 shown + an overflow note

    // Beyond the cap the assembled prompt is effectively constant…
    assert.ok(Math.abs(wayOver - atCap) < 40,
      `beyond the cap, prompt size must stay ~constant (atCap=${atCap}, wayOver=${wayOver})`);
    // …and nowhere near concatenating 60 full ~3.5k-token summaries (~210k tokens).
    assert.ok(wayOver < 3000, `assembled prompt must stay small regardless of task count (got ${wayOver})`);
  } finally {
    cleanup(repo);
  }
});

// ── Planner: LLM task graph (CONTEXT.md §8) ──────────────────────────────────
// The design agent emits a fenced JSON task graph; the planner normalizes seqs,
// remaps depends_on, and populates real scope_paths. executeDesign builds the
// breakdown from it (falling back to the heuristic when no plan is parsed).

test("planner: parse a fenced task-graph — sort by seq, remap depends_on, drop placeholders", () => {
  const text = [
    "## Summary\nBuild login.",
    "```json",
    JSON.stringify({
      goal: "Support email login",
      tasks: [
        { seq: 2, role: "frontend", title: "Login form", scope_paths: ["src/Login.tsx"], depends_on: [1] },
        { seq: 1, role: "backend", title: "Login API", scope_paths: ["server/auth.ts"], depends_on: [] },
        { role: "bogus", title: "<placeholder>", depends_on: [] }, // dropped: placeholder title
      ],
    }),
    "```",
  ].join("\n");

  const plan = parseTaskPlan(text);
  assert.ok(plan, "plan parsed");
  assert.equal(plan!.goal, "Support email login");
  assert.deepEqual(plan!.tasks.map((t) => [t.seq, t.role, t.title]), [
    [1, "backend", "Login API"],
    [2, "frontend", "Login form"],
  ]);
  assert.deepEqual(plan!.tasks[1].depends_on, [1], "old seq 1 remapped to new seq 1");
  assert.deepEqual(plan!.tasks[0].scope_paths, ["server/auth.ts"]);
});

test("planner: no task block → null (caller falls back to the heuristic)", () => {
  assert.equal(parseTaskPlan("Just prose, no JSON here."), null);
});

test("planner: executeDesign builds the task graph from the agent's JSON plan", async () => {
  const repo = makeTempRepo();
  const wsRoot = makeTempDir();
  setWorkspaceRoot(wsRoot, /* requireDesignReview */ true);

  // Fake design agent: prose plan + a machine-readable task graph.
  const planRunner: RunnerFn = async function* (runOpts, resultRef) {
    yield { type: "progress", content: "fake" };
    const out = [
      "## Summary\nBuild it.",
      "```json",
      JSON.stringify({
        goal: "Ship the thing",
        tasks: [
          { seq: 1, role: "backend", title: "API", description: "do api", acceptance_criteria: "works", scope_paths: ["server/api.ts"], depends_on: [] },
          { seq: 2, role: "frontend", title: "UI", description: "do ui", acceptance_criteria: "renders", scope_paths: ["src/UI.tsx"], depends_on: [1] },
        ],
      }),
      "```",
    ].join("\n");
    yield { type: "text", content: out };
    resultRef.current = { ok: true, result: out, tokensIn: 1, tokensOut: 1, turns: 1, model: "fake", costUsd: 0, durationMs: 1 };
  };
  __setClaudeRunner(planRunner);

  try {
    const { storyId } = seedStoryCustom(repo, {
      title: "Build a thing", branchName: "feature/plan-1",
      roles: ["techlead", "backend", "frontend", "qa"],
    });

    for await (const _ of executeStory(storyId)) { /* design pass */ }

    const story = db.prepare("SELECT status, design FROM stories WHERE id = ?").get(storyId) as
      { status: string; design: string | null };
    assert.equal(story.status, "design_review");
    assert.ok(story.design && story.design.includes("Summary"), "prose design stored");
    assert.ok(!story.design!.includes('"tasks"'), "machine-readable task JSON stripped from stored design");

    const tasks = db.prepare("SELECT role, title, scope_paths, depends_on FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
      Array<{ role: string; title: string; scope_paths: string; depends_on: string }>;
    assert.deepEqual(tasks.map((t) => t.role), ["backend", "frontend", "qa"], "plan tasks + an appended QA gate");
    assert.equal(tasks[0].title, "API");
    assert.deepEqual(JSON.parse(tasks[0].scope_paths), ["server/api.ts"], "scope_paths populated from the plan");
    assert.deepEqual(JSON.parse(tasks[1].depends_on), [1], "real dependency edge from the plan");
    assert.deepEqual(JSON.parse(tasks[2].depends_on), [1, 2], "appended QA gates after every impl task");
  } finally {
    __setClaudeRunner(null);
    cleanup(repo, wsRoot);
  }
});

// ── Artifacts + budgeted retrieval (CONTEXT.md §5.3, §6, §9) ─────────────────
// Files a task touches are registered as a manifest (path + kind + summary);
// the manifest is injected as pointers ranked by the task's scope. Project
// context is injected under a token budget instead of wholesale.

test("artifacts: parse ARTIFACT markers and infer kind from path", () => {
  const text = [
    "Did work.",
    "ARTIFACT: api server/routes/auth.ts — login + refresh endpoints",
    "ARTIFACT: schema migrations/004_users.sql",
    "ARTIFACT: code <path>", // placeholder — ignored
  ].join("\n");
  const parsed = parseArtifactMarkers(text);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { kind: "api", path: "server/routes/auth.ts", summary: "login + refresh endpoints" });
  assert.equal(parsed[1].summary, null);

  assert.equal(inferKind("migrations/004_users.sql"), "schema");
  assert.equal(inferKind("src/components/Login.test.tsx"), "test");
  assert.equal(inferKind("README.md"), "doc");
  assert.equal(inferKind("server/routes/x.ts"), "api");
  assert.equal(inferKind("src/lib/util.ts"), "code");
});

test("artifacts: register from git + markers (noise filtered), manifest ranks scoped files first", async () => {
  const repo = makeTempRepo();
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Auth", roles: ["fullstack", "qa"] });
    const { project_id: projectId } = db.prepare("SELECT project_id FROM stories WHERE id = ?").get(storyId) as
      { project_id: string };

    registerArtifacts({
      projectId, storyId, taskId: null,
      fromGit: ["server/auth.ts", "src/pages/Login.tsx", "node_modules/x/index.js"],
      markers: [{ kind: "api", path: "server/auth.ts", summary: "auth endpoints" }],
    });

    const rows = db.prepare("SELECT path, kind, summary FROM artifacts WHERE story_id = ? ORDER BY path").all(storyId) as
      Array<{ path: string; kind: string; summary: string | null }>;
    assert.deepEqual(rows.map((r) => r.path), ["server/auth.ts", "src/pages/Login.tsx"], "node_modules noise filtered out");
    const auth = rows.find((r) => r.path === "server/auth.ts")!;
    assert.equal(auth.kind, "api", "marker overrides the inferred kind");
    assert.equal(auth.summary, "auth endpoints");

    const manifest = renderArtifactManifest(storyId, ["src/pages/Login.tsx"]);
    assert.ok(manifest, "manifest rendered");
    const firstItem = manifest!.split("\n").find((l) => l.startsWith("- "))!;
    assert.match(firstItem, /Login\.tsx/, "the in-scope file is listed first");
  } finally {
    cleanup(repo);
  }
});

test("context budget: oversized project context is trimmed and reported", async () => {
  const repo = makeTempRepo();
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Build a UI component with an API", roles: ["fullstack", "qa"] });
    const { project_id: projectId } = db.prepare("SELECT project_id FROM stories WHERE id = ?").get(storyId) as
      { project_id: string };

    // Tiny budget + several large context sections.
    db.prepare("INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ context_token_budget: 300 }));
    const big = "lorem ipsum ".repeat(2000); // ~6k tokens each
    for (const s of ["overview", "architecture", "data_model", "design_system", "conventions"]) {
      db.prepare("INSERT INTO project_contexts (id, project_id, section, title, content) VALUES (?,?,?,?,?)")
        .run(nanoid(), projectId, s, s, big);
    }

    const blocks = buildTaskPromptBlocks({
      storyId, taskTitle: "Do it", taskDescription: "x",
      agentSystemPrompt: "engineer", agentRole: "fullstack",
    });

    assert.ok(blocks.droppedForBudget.length >= 3, `most sections dropped for budget (dropped ${blocks.droppedForBudget.length})`);
    assert.ok(blocks.estimatedTokens < 2000, `prompt stays bounded by the budget (got ${blocks.estimatedTokens})`);
  } finally {
    cleanup(repo);
  }
});

// ── Decision log (CONTEXT.md §5.2, §7) ───────────────────────────────────────
// Agents emit `DECISION:` markers; decisions are stored once and injected as
// compact one-liners into later prompts. A new decision on a topic supersedes
// the prior active one (a topic has one current answer).

test("decisions: parse DECISION markers, ignoring the instruction template", () => {
  const text = [
    "Did some work.",
    "DECISION: [Authentication] Use JWT — stateless architecture",
    "DECISION: [Storage] Use SQLite",
    "DECISION: [topic] <decision> — <why>", // template echo — must be ignored
    "Done.",
  ].join("\n");
  const parsed = parseDecisionMarkers(text);
  assert.equal(parsed.length, 2, "two real decisions, template skipped");
  assert.deepEqual(parsed[0], { topic: "Authentication", decision: "Use JWT", rationale: "stateless architecture" });
  assert.equal(parsed[1].decision, "Use SQLite");
  assert.equal(parsed[1].rationale, null);
});

test("decisions: active decision is injected into later prompts; same topic supersedes", async () => {
  const repo = makeTempRepo();
  try {
    const { storyId } = seedStoryCustom(repo, { title: "Auth feature", roles: ["fullstack", "qa"] });
    const { project_id: projectId } = db.prepare("SELECT project_id FROM stories WHERE id = ?").get(storyId) as
      { project_id: string };

    recordDecisions({ projectId, storyId, decisions: [{ topic: "Authentication", decision: "Use sessions", rationale: null }] });
    recordDecisions({ projectId, storyId, decisions: [{ topic: "Authentication", decision: "Use JWT", rationale: "stateless" }] });

    const block = renderDecisionsBlock(storyId);
    assert.ok(block && block.includes("Use JWT"), "active decision is shown");
    assert.ok(!block.includes("Use sessions"), "superseded decision is hidden");

    // It lands in the assembled task prompt…
    const blocks = buildTaskPromptBlocks({
      storyId, taskTitle: "Login API", taskDescription: "build it",
      agentSystemPrompt: "engineer", agentRole: "fullstack",
    });
    assert.match(blocks.storyBlock, /Use JWT/);

    // …and only one decision stays active for the topic.
    const active = db.prepare("SELECT decision FROM decisions WHERE project_id = ? AND status = 'active'").all(projectId) as
      Array<{ decision: string }>;
    assert.deepEqual(active.map((a) => a.decision), ["Use JWT"]);
  } finally {
    cleanup(repo);
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
