/**
 * Manual driver: run ONE happy flow along the PRODUCTION path and report where
 * it blocks. This faithfully replays what orchestrator.dispatch + runWorker do
 * for a brand-new auto story (no pre-set branch), using the fake agent runner.
 *
 * Run:  npm run flow
 * It prints the full story activity log and the final state, then a verdict.
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { makeTempRepo, makeTempDir, cleanup, makeFakeRunner } from "./helpers.ts";

process.env.AGILE_DB_PATH = join(tmpdir(), `agile-flow-${process.pid}-${Date.now()}.db`);

const { db } = await import("../server/db.js");
const { __setClaudeRunner, executeStory } = await import("../server/execution.js");
const { createBranchNoCheckout, buildBranchName } = await import("../server/git.js");

const repo = makeTempRepo();
const wsRoot = makeTempDir();

db.prepare(
  "INSERT INTO settings (key, value) VALUES ('agent_runtime_config', ?) " +
  "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
).run(JSON.stringify({ enabled: true, workspace_root: wsRoot }));

const projectId = nanoid();
const projectKey = "FLOW";
db.prepare("INSERT INTO projects (id, key, name, local_path) VALUES (?, ?, ?, ?)")
  .run(projectId, projectKey, "Flow Project", repo);
db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'fullstack')").run(nanoid(), "Dev Bot");
db.prepare("INSERT INTO agents (id, name, role) VALUES (?, ?, 'qa')").run(nanoid(), "QA Bot");

// A brand-new auto story, exactly as a user would create it: todo, no branch.
const storyId = nanoid();
const storyKey = `${projectKey}-1`;
const title = "Add a small feature";
db.prepare(
  "INSERT INTO stories (id, project_id, key, type, title, status, mode) " +
  "VALUES (?, ?, ?, 'story', ?, 'todo', 'auto')"
).run(storyId, projectId, storyKey, title);

__setClaudeRunner(makeFakeRunner({ qaVerdict: "PASS" }));

console.log("\n=== Replaying orchestrator.dispatch for a new auto story ===");

// --- exactly what orchestrator.dispatch does (server/orchestrator.ts) ---
const branchName = buildBranchName(storyKey, title);
const cb = createBranchNoCheckout(repo, branchName);  // step 1: create branch WITHOUT checking it out
console.log(`dispatch: createBranchNoCheckout("${branchName}") -> ok=${cb.ok}${cb.error ? `, error=${cb.error}` : ""}`);
if (cb.ok && cb.branch) {
  db.prepare("UPDATE stories SET branch_name = ? WHERE id = ?").run(cb.branch, storyId);
}
db.prepare("UPDATE stories SET status = 'in_progress' WHERE id = ?").run(storyId); // step 2: flip to in_progress

// --- what runWorker does: drain executeStory ---
const events: Array<{ type: string; content?: string }> = [];
for await (const e of executeStory(storyId)) events.push(e);

// Design gate: first pass parks at design_review. Simulate a human approving.
const afterPass1 = db.prepare("SELECT status, design FROM stories WHERE id = ?").get(storyId) as
  { status: string; design: string | null };
if (afterPass1.status === "design_review") {
  console.log(`\n--- design produced (awaiting review) ---\n${(afterPass1.design || "").slice(0, 400)}`);
  console.log("\n[human approves design → in_progress]");
  db.prepare("UPDATE stories SET status = 'in_progress' WHERE id = ?").run(storyId);
  for await (const e of executeStory(storyId)) events.push(e); // pass 2: implementation
}

// --- report ---
const story = db.prepare("SELECT status, qa_result, branch_name FROM stories WHERE id = ?").get(storyId) as
  { status: string; qa_result: string | null; branch_name: string | null };
const tasks = db.prepare("SELECT seq, role, status FROM story_tasks WHERE story_id = ? ORDER BY seq").all(storyId) as
  Array<{ seq: number; role: string; status: string }>;
const acts = db.prepare(
  "SELECT type, level, content FROM story_activities WHERE story_id = ? ORDER BY created_at, rowid"
).all(storyId) as Array<{ type: string; level: string; content: string }>;

console.log("\n=== Story activity log ===");
for (const a of acts) {
  const mark = a.level === "error" ? "✗" : a.level === "warn" ? "⚠" : "·";
  console.log(`  ${mark} [${a.type}] ${a.content.replace(/\n/g, "\n      ")}`);
}

console.log("\n=== Final state ===");
console.log(`  story.status   = ${story.status}`);
console.log(`  story.qa_result= ${story.qa_result ?? "(none)"}`);
console.log(`  story.branch   = ${story.branch_name}`);
console.log(`  tasks          = ${tasks.map((t) => `#${t.seq}:${t.role}=${t.status}`).join(", ") || "(none)"}`);
console.log(`  stream events  = ${events.map((e) => e.type).join(" → ")}`);

console.log("\n=== Verdict ===");
const reachedHumanReview = story.status === "human_review";
const blockers = acts.filter((a) => a.level === "error").map((a) => `[${a.type}] ${a.content.split("\n")[0]}`);
if (reachedHumanReview) {
  console.log("  ✔ HAPPY FLOW COMPLETED — story reached human_review");
} else {
  console.log(`  ✗ HAPPY FLOW BLOCKED — story stuck at "${story.status}"`);
  console.log("  Blocking errors:");
  for (const b of blockers) console.log(`    - ${b}`);
}

__setClaudeRunner(null);
cleanup(repo, wsRoot);
process.exit(reachedHumanReview ? 0 : 1);
