// Node.js 22.5+ built-in SQLite (no native compilation required)
// @ts-ignore — node:sqlite types not yet in @types/node
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const DB_PATH = join(DATA_DIR, "agile.db");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

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
];

for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}
