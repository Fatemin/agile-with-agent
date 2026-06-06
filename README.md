# Agile with Agent

A lightweight agile project-management tool for AI-augmented development teams. It pairs a
Linear/Jira-style board (projects, epics, sprints, stories, tasks) with a runtime that **actually
executes** AI coding agents against stories — each in its own isolated git worktree, driven by the
Claude Code CLI.

The differentiator is the **Project Context** system: a structured, per-project knowledge base that
is automatically injected into each agent's prompt so agents start with the conventions, data model,
and architecture they need.

> **Status:** Working MVP. The board, the per-project context system, and autonomous agent execution
> (orchestrator → per-story workspace → multi-task pipeline → QA gate → human review) are all
> functional. See [Known limitations](#known-limitations) for the rough edges.

---

## How it works

```
 Story (mode = auto)                          Story (mode = manual)
        │                                              │
        ▼                                              ▼
  Orchestrator poll loop                      UI "Execute" / "Plan" buttons
  (WIP-limited dispatch)                       (server/routes/execution.ts)
        │                                              │
        └───────────────────┬──────────────────────────┘
                            ▼
                   executeStory(storyId)
                            │
        1. Tech-Lead plan → story_tasks  (executeTechLeadPlan)
        2. ensureWorkspace → git worktree under workspace_root
        3. For each task: spawn `claude` CLI in the worktree (executeTask)
        4. QA task verifies acceptance criteria → QA_RESULT: PASS/FAIL (executeQA)
        5. Pass → status = human_review (awaiting human ack to mark Done)
```

- **Orchestrator** ([server/orchestrator.ts](server/orchestrator.ts)) is the single authority over
  scheduling. It polls the DB for `status IN (todo, in_progress)` stories with `mode = 'auto'`,
  dispatches up to a WIP limit, reconciles/kills stalled or no-longer-eligible runs, retries with
  exponential backoff, and recovers in-flight work on restart. Its design follows the
  **Symphony** spec ([specs.md](specs.md)) — the `§` references throughout the code point there.
- **Agents run via the Claude Code CLI**, not the HTTP API. `runClaudeCode`
  ([server/claudeRunner.ts](server/claudeRunner.ts)) spawns `claude --print --output-format
  stream-json …`, feeds the prompt over stdin, and streams parsed events back. Agents therefore use
  the CLI's own tools (Read/Write/Edit/Bash/Grep) and the CLI's own authentication.
- **Isolation:** every story gets its own git worktree under `workspace_root`
  ([server/workspace.ts](server/workspace.ts)). Agents never run in the main project directory.
- **Context injection:** [server/contextBuilder.ts](server/contextBuilder.ts) selects which context
  sections to include via a three-layer union (story type → agent role → keyword match) and assembles
  the prompt.
- **In-repo workflow contract:** an optional `WORKFLOW.md` in the target project supplies lifecycle
  hooks (`after_create`, `before_run`, `after_run`, `before_remove`) and runtime settings, hot-reloaded
  on change ([server/workflow.ts](server/workflow.ts)).

### Status model

Stories use a Linear-style flow (the DB migrates older sprint-style states forward automatically):

| Status | Meaning |
|--------|---------|
| `backlog` | Not yet scheduled |
| `todo` | Scheduled; eligible for the orchestrator to pick up |
| `in_progress` | An agent pipeline is running (or has been dispatched) |
| `human_review` | Agent work + QA done; awaiting a human to acknowledge and mark Done |
| `done` | Terminal — complete |
| `cancelled` | Terminal — abandoned |

`todo` and `in_progress` are the **active** states the orchestrator acts on; `done` and `cancelled`
are **terminal**.

Tasks (`story_tasks`) are Jira-style sub-units with their own `status`
(`todo`/`in_progress`/`in_review`/`done`/`blocked`/`failed`) and a target `role`
(`frontend`/`backend`/`fullstack`/`qa`/`devops`/`techlead`/`security`/`custom`).

---

## Quick start

### Prerequisites

- **Node.js 22.5+** — the server uses the built-in `node:sqlite` module (started with
  `--experimental-sqlite`), so no native build step is required.
- **[Claude Code CLI](https://docs.claude.com/en/docs/claude-code)** installed and authenticated
  (`claude` on PATH, or `claude.cmd` on Windows). The app shells out to it to run agents.
- A target project that is a **git repository with a local path** — agent execution creates worktrees
  from it. Projects without a local path can still be managed on the board but cannot run agents.

### Install & run

```bash
npm install
npm run dev      # server (:3001) + Vite client concurrently
```

Open the Vite dev URL it prints. The client proxies `/api/*` to the server on port 3001.

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run server + client together (dev) |
| `npm run dev:server` | Server only (`node --watch`, tsx ESM loader, experimental SQLite) |
| `npm run dev:client` | Vite dev server only |
| `npm run build` | Build the client to `dist/` (server runs from source via tsx) |
| `npm run lint` | Type-check **both** client and server (`tsc --noEmit` × 2) |
| `npm run lint:client` / `npm run lint:server` | Type-check one side only |
| `npm test` | Offline end-to-end test of the agent execution chain (see [Testing](#testing)) |

In production the server serves the built client from `dist/` and listens on `PORT` (default `3001`).

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router v7, Framer Motion |
| Backend | Hono on Node.js, TypeScript run directly via `tsx` (no compile step) |
| Database | Node.js built-in SQLite (`node:sqlite`), single file at `data/agile.db` (WAL mode) |
| Agent runtime | Claude Code CLI spawned as a subprocess, streaming `stream-json` |

- **No ORM, no migrations tool.** The schema lives in [server/db.ts](server/db.ts); schema changes are
  applied as idempotent `CREATE TABLE IF NOT EXISTS` + best-effort `ALTER TABLE` statements run at
  startup, plus a few one-off data backfills.
- **REST API** under `/api/*`, mounted in [server/index.ts](server/index.ts). Long-running operations
  (execute, plan, qa-run, scan, generate-context) stream Server-Sent Events.
- **Orchestrator observability:** `GET /api/snapshot` returns the live running/retrying/totals view
  (surfaced in the **Ops** page); `POST /api/snapshot/kick` forces a poll tick.

### Repository layout

```
server/
  index.ts          Hono app + route mounts + orchestrator lifecycle
  orchestrator.ts   Symphony scheduler: poll, dispatch, reconcile, retry, recover
  execution.ts      executeStory / TechLead plan / per-task / QA pipeline
  claudeRunner.ts   Spawns the Claude Code CLI and parses its stream-json output
  contextBuilder.ts Context-section selection + prompt assembly
  workspace.ts      Per-story git worktrees under workspace_root
  workflow.ts       WORKFLOW.md loader (YAML front matter + hooks) with hot reload
  hooks.ts          Runs workspace lifecycle hook scripts
  git.ts            Branch helpers
  scanner.ts        Auto-populate Project Context from a local repo or public GitHub repo
  runtimeConfig.ts  Agent runtime config (read from the settings table, with defaults)
  logger.ts         Story activity log + system events
  db.ts             SQLite connection, schema, migrations, seed settings
  routes/           One router per resource (projects, epics, sprints, stories, tasks, …)
src/                React client (pages: Dashboard, Projects, ProjectView, Agents, Ops, Settings)
tests/              Offline end-to-end chain test (node:test) + fake-agent helpers
data/               SQLite DB files (git-ignored)
PRD.md              Product requirements
DESIGN.md           UI design system (tokens, typography, layout)
specs.md            Symphony service specification (the orchestrator's design contract)
```

---

## Testing

`npm test` runs an **offline** end-to-end test of the whole business chain
([tests/execution-chain.test.ts](tests/execution-chain.test.ts)), using Node's built-in `node:test`
runner — no extra dependencies.

The only external, paid, non-deterministic step in the pipeline is spawning the Claude Code CLI. The
test injects a **fake agent runner** through a seam in `execution.ts` (`__setClaudeRunner`) that
simulates agent events, writes a real file into the worktree, and commits it. Everything else runs for
real against a throwaway git repo and an isolated SQLite DB (`AGILE_DB_PATH`), so the test exercises:
Tech-Lead planning → per-story git worktree creation → task implementation → QA gate → status
transition to `human_review`.

This means the full chain can be validated **without** the Claude Code CLI, an API key, tokens, or
clicking through the frontend. Companion tests pin the branch/worktree fix: one asserts the worktree
model works with non-checkout branch creation, and a guard test documents why the old `checkout -b`
approach conflicted.

A second test boots the **real orchestrator** (`orchestrator.start()`), lets its poll loop pick up a
brand-new `todo`/`auto` story on its own, and drives it `todo → human_review`, then human-acks it to
`done` and asserts the scheduler doesn't re-pick a terminal story — covering the actual production
dispatch/reconcile lifecycle, not just the execution functions.

`npm run flow` runs the same chain along the production path (replaying `orchestrator.dispatch`
exactly) and prints the full story activity log plus a pass/blocked verdict — handy for eyeballing what
the orchestrator actually does end to end.

To smoke-test against the **real** CLI instead, swap the fake runner for the default and point a story
at a scratch repo — that path is intentionally not part of `npm test` because it is slow, costs tokens,
and requires CLI authentication.

---

## Project Context

Each project has seven fixed context sections: `overview`, `prd`, `design_system`, `data_model`,
`architecture`, `conventions`, `glossary`. They can be edited inline, or auto-populated:

- **Scan from repo** ([server/scanner.ts](server/scanner.ts)) reads well-known files (README, PRD,
  schema files, `package.json`, CONTRIBUTING/CLAUDE.md, `docs/`, …) from the project's local path or a
  public GitHub repo and maps them onto sections.
- At execution time, only the relevant **populated** sections are injected into the agent prompt. The
  selection rules (per story type, per agent role, per keyword) are stored in the `settings` table and
  editable from the Settings page.

---

## Configuration

Runtime behavior is stored in the `settings` table (editable from the **Settings** page) and read by
[server/runtimeConfig.ts](server/runtimeConfig.ts). Key `agent_runtime_config` fields:

| Field | Default | Purpose |
|-------|---------|---------|
| `enabled` | `true` | Master switch; when off, execution halts instead of spawning agents |
| `cli_path` | `claude` / `claude.cmd` | Path to the Claude Code CLI |
| `model` | `claude-sonnet-4-5` | Model passed to the CLI |
| `permission_mode` | `acceptEdits` | CLI permission mode (`default`/`acceptEdits`/`bypassPermissions`/`plan`) |
| `timeout_minutes` | `15` | Per-agent run timeout |
| `wip_limit` | `3` | Max concurrent agent runs |
| `poll_interval_ms` | `30000` | Orchestrator tick interval |
| `workspace_root` | OS temp dir `/agile_workspaces` | Where per-story worktrees are created |
| `stall_timeout_ms` | `300000` | Kill a run after this long with no agent events |
| `max_retry_backoff_ms` | `300000` | Cap on exponential retry backoff |

Agents authenticate through the Claude Code CLI's own session; this app does not store an Anthropic API
key. Additional environment variables can be stored under the `env_vars` setting (read via `getEnv`).

---

## Known limitations

- **Persistently failing work loops in `auto` mode.** A story whose task or QA keeps failing stays
  `in_progress`, so the orchestrator keeps retrying it (with backoff). There is no max-attempts
  give-up / move-to-blocked policy yet.
- **Test coverage is meaningful but not exhaustive.** The suite covers the execution chain, the
  branch/worktree fix, the QA gate, multi-task pipelines, orchestrator dispatch/retry, and restart
  recovery (see [Testing](#testing)); most HTTP routes and the React client are still untested.
- **Server schema is hand-rolled.** Migrations are best-effort `ALTER TABLE` statements; there is no
  down-migration or schema-version tracking.
- **`executeDocsAgent` is a stub** ([server/execution.ts](server/execution.ts)) — the
  "generate context" docs endpoint reports success without invoking a real agent yet.
- **GitHub scanning is unauthenticated** — public repos only, subject to GitHub's anonymous API rate
  limits.
- **Single-user.** No authentication, multi-tenancy, or access control.

---

## Related docs

- [PRD.md](PRD.md) — product requirements and feature list
- [DESIGN.md](DESIGN.md) — UI design system (color tokens, typography, layout patterns)
- [specs.md](specs.md) — the Symphony orchestration spec the runtime implements
- [BACKLOG.md](BACKLOG.md) — fix backlog (archived §1–7 resolved; current ACTIVE items at top)
