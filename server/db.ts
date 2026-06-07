// Node.js 22.5+ built-in SQLite (no native compilation required)
// @ts-ignore — node:sqlite types not yet in @types/node
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// AGILE_DB_PATH lets tests (and ops) point at an isolated DB file.
const DB_PATH = process.env.AGILE_DB_PATH ?? join(__dirname, "../data", "agile.db");
const DB_DIR = dirname(DB_PATH);

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

/** Value types accepted as a bound parameter by node:sqlite statements. */
export type SqlParam = string | number | bigint | null | Uint8Array;

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#0891B2',
    local_path TEXT,
    github_url TEXT,
    tech_stack TEXT,
    definition_of_done TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS epics (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#8B5CF6',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT,
    start_date TEXT,
    end_date TEXT,
    capacity INTEGER,
    status TEXT NOT NULL DEFAULT 'planning',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    model TEXT,
    system_prompt TEXT,
    prompt_template TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
    sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
    key TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'story',
    title TEXT NOT NULL,
    as_a TEXT,
    i_want TEXT,
    so_that TEXT,
    description TEXT,
    acceptance_criteria TEXT,
    definition_of_done TEXT,
    story_points INTEGER,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'backlog',
    assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_contexts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT 'human',
    UNIQUE(project_id, section)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Context-section selection is relevance-based (CONTEXT.md §9, Phase 5) via the
// context_fts index above — the old static execution/role/keyword rule settings
// were retired. Existing rows (if any) are left dormant.

db.exec(`
  CREATE TABLE IF NOT EXISTS story_tasks (
    id           TEXT PRIMARY KEY,
    story_id     TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    role         TEXT NOT NULL,
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    scope_paths  TEXT NOT NULL DEFAULT '[]',
    depends_on   TEXT NOT NULL DEFAULT '[]',
    phase        TEXT NOT NULL DEFAULT 'pending',
    design_output TEXT,
    impl_summary  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// CONTEXT.md §9 (Phase 5) — full-text index over project context sections so the
// context builder picks sections by relevance (FTS5 bm25) instead of static
// keyword/role/type rules. Kept in sync with project_contexts via triggers.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(section UNINDEXED, content, project_id UNINDEXED);

  CREATE TRIGGER IF NOT EXISTS context_fts_ai AFTER INSERT ON project_contexts BEGIN
    INSERT INTO context_fts(rowid, section, content, project_id)
    VALUES (new.rowid, new.section, COALESCE(new.content, ''), new.project_id);
  END;
  CREATE TRIGGER IF NOT EXISTS context_fts_ad AFTER DELETE ON project_contexts BEGIN
    DELETE FROM context_fts WHERE rowid = old.rowid;
  END;
  CREATE TRIGGER IF NOT EXISTS context_fts_au AFTER UPDATE ON project_contexts BEGIN
    DELETE FROM context_fts WHERE rowid = old.rowid;
    INSERT INTO context_fts(rowid, section, content, project_id)
    VALUES (new.rowid, new.section, COALESCE(new.content, ''), new.project_id);
  END;
`);
// Backfill rows that predate the index (idempotent).
db.exec(`
  INSERT INTO context_fts(rowid, section, content, project_id)
  SELECT rowid, section, COALESCE(content, ''), project_id FROM project_contexts
  WHERE rowid NOT IN (SELECT rowid FROM context_fts);
`);

// CONTEXT.md §5.1 — per-story working memory ("snapshot"). One row per story.
// Replaces injecting every prior task's full impl_summary into sibling-task
// prompts (the O(tasks) prompt-growth leak). state_json holds a bounded,
// compact view: completed[] (one line each), in_progress, blocked[], key files.
db.exec(`
  CREATE TABLE IF NOT EXISTS story_snapshot (
    story_id    TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
    goal        TEXT,
    state_json  TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// CONTEXT.md §5.2 — compressed, append-only decision log. A decision is
// recorded once and referenced by its per-project seq ("#15") thereafter,
// instead of replaying the conversation that produced it. A new decision on a
// topic that already has an active one supersedes it (one current answer/topic).
db.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_id      TEXT REFERENCES stories(id) ON DELETE SET NULL,
    seq           INTEGER NOT NULL,
    topic         TEXT NOT NULL,
    decision      TEXT NOT NULL,
    rationale     TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    supersedes_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
    created_by    TEXT NOT NULL DEFAULT 'agent',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_decisions_story   ON decisions(story_id);
`);

// CONTEXT.md §5.3 — artifact manifest. The artifact's *content* lives in the
// git worktree; this is an index (path + kind + one-line summary) so the context
// builder can offer relevant files for a task without reading every file.
db.exec(`
  CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_id    TEXT REFERENCES stories(id) ON DELETE SET NULL,
    task_id     TEXT REFERENCES story_tasks(id) ON DELETE SET NULL,
    path        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'code',
    summary     TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(story_id, path)
  );
  CREATE INDEX IF NOT EXISTS idx_artifacts_story ON artifacts(story_id, status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS story_activities (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'comment',
    content TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'human',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Orchestrator / system-level events (no story FK)
  CREATE TABLE IF NOT EXISTS system_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC);
`);

// Migrations for existing databases (idempotent ALTER TABLE)
const migrations = [
  "ALTER TABLE projects ADD COLUMN local_path TEXT",
  "ALTER TABLE projects ADD COLUMN github_url TEXT",
  "ALTER TABLE projects ADD COLUMN tech_stack TEXT",
  "ALTER TABLE projects ADD COLUMN definition_of_done TEXT",
  "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE sprints ADD COLUMN capacity INTEGER",
  "ALTER TABLE stories ADD COLUMN type TEXT NOT NULL DEFAULT 'story'",
  "ALTER TABLE stories ADD COLUMN as_a TEXT",
  "ALTER TABLE stories ADD COLUMN i_want TEXT",
  "ALTER TABLE stories ADD COLUMN so_that TEXT",
  "ALTER TABLE stories ADD COLUMN definition_of_done TEXT",
  // Agent role
  "ALTER TABLE agents ADD COLUMN role TEXT",
  // Dev/QA/Rollout fields
  "ALTER TABLE stories ADD COLUMN branch_name TEXT",
  "ALTER TABLE stories ADD COLUMN pr_url TEXT",
  "ALTER TABLE stories ADD COLUMN pr_number INTEGER",
  "ALTER TABLE stories ADD COLUMN qa_test_cases TEXT",
  "ALTER TABLE stories ADD COLUMN qa_notes TEXT",
  "ALTER TABLE stories ADD COLUMN qa_signed_off_by TEXT",
  "ALTER TABLE stories ADD COLUMN qa_signed_off_at TEXT",
  "ALTER TABLE stories ADD COLUMN staging_url TEXT",
  "ALTER TABLE stories ADD COLUMN deploy_env TEXT",
  "ALTER TABLE stories ADD COLUMN deploy_url TEXT",
  "ALTER TABLE stories ADD COLUMN commit_hash TEXT",
  "ALTER TABLE stories ADD COLUMN deployed_at TEXT",
  "ALTER TABLE stories ADD COLUMN qa_result TEXT",
  "ALTER TABLE stories ADD COLUMN parent_story_id TEXT",
  "ALTER TABLE stories ADD COLUMN pipeline_mode INTEGER NOT NULL DEFAULT 0",
  // Workflow mode
  "ALTER TABLE stories ADD COLUMN mode TEXT NOT NULL DEFAULT 'manual'",
  // Design-review gate: agent's implementation plan, awaiting human approval
  "ALTER TABLE stories ADD COLUMN design TEXT",
  // Sprint branch tracking
  "ALTER TABLE sprints ADD COLUMN branch_name TEXT",
  // Activity log level
  "ALTER TABLE story_activities ADD COLUMN level TEXT NOT NULL DEFAULT 'info'",
  // Task redesign — Jira-style fields
  "ALTER TABLE story_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'subtask'",
  "ALTER TABLE story_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'",
  "ALTER TABLE story_tasks ADD COLUMN acceptance_criteria TEXT",
  "ALTER TABLE story_tasks ADD COLUMN estimate_hours REAL",
  "ALTER TABLE story_tasks ADD COLUMN logged_hours REAL",
  "ALTER TABLE story_tasks ADD COLUMN severity TEXT",
  "ALTER TABLE story_tasks ADD COLUMN steps_to_repro TEXT",
  "ALTER TABLE story_tasks ADD COLUMN expected TEXT",
  "ALTER TABLE story_tasks ADD COLUMN actual TEXT",
  "ALTER TABLE story_tasks ADD COLUMN found_during TEXT",
  "ALTER TABLE story_tasks ADD COLUMN linked_task_id TEXT",
];

for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id           TEXT PRIMARY KEY,
    story_id     TEXT REFERENCES stories(id) ON DELETE CASCADE,
    task_id      TEXT REFERENCES story_tasks(id) ON DELETE SET NULL,
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    run_type     TEXT NOT NULL DEFAULT 'execute',
    model        TEXT,
    provider     TEXT NOT NULL DEFAULT 'claude',
    tokens_in    INTEGER NOT NULL DEFAULT 0,
    tokens_out   INTEGER NOT NULL DEFAULT 0,
    turns        INTEGER NOT NULL DEFAULT 1,
    prompt_text  TEXT,
    output_text  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_story  ON agent_runs(story_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_agent  ON agent_runs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_task   ON agent_runs(task_id);
`);

// Rename legacy statuses to new workflow statuses (older "in_progress"/"done" → sprint-style)
try {
  db.exec(`UPDATE stories SET status = 'in_dev' WHERE status = 'in_progress'`);
  db.exec(`UPDATE stories SET status = 'released' WHERE status = 'done'`);
} catch { /* ignore */ }

// Linear-style flow migration:
//   sprint statuses → flow statuses
//   in_dev    → in_progress  (agent is working)
//   in_qa     → human_review (agent done, awaiting human)
//   ready     → human_review (release candidate, still needs human ack)
//   released  → done
//   (backlog / todo / cancelled stay as-is)
try {
  db.exec(`UPDATE stories SET status = 'in_progress'  WHERE status = 'in_dev'`);
  db.exec(`UPDATE stories SET status = 'human_review' WHERE status IN ('in_qa', 'ready')`);
  db.exec(`UPDATE stories SET status = 'done'         WHERE status = 'released'`);
} catch { /* ignore */ }

// Backfill story_tasks.status from legacy phase column
try {
  db.exec(`
    UPDATE story_tasks SET status = CASE
      WHEN phase = 'pending'      THEN 'todo'
      WHEN phase = 'designing'    THEN 'in_progress'
      WHEN phase = 'design_done'  THEN 'in_progress'
      WHEN phase = 'implementing' THEN 'in_progress'
      WHEN phase = 'done'         THEN 'done'
      WHEN phase = 'failed'       THEN 'failed'
      ELSE 'todo'
    END
    WHERE status = 'todo' AND phase IS NOT NULL
  `);
} catch { /* ignore */ }
