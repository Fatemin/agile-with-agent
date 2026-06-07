# Context & State Management Specification

Status: Draft v1 — **Phases 1–4 implemented** (snapshot, decisions, artifacts+budget, planner); Phase 5 proposed.

Purpose: Define how this system assembles the context a coding agent sees for a unit of work,
so that **prompt size stays roughly constant as a story grows**, decisions are not lost, and a new
agent can take over a half-finished story at any time.

This document supersedes the thin §12 ("Prompt Construction and Context Assembly") of
[specs.md](specs.md). Symphony (specs.md) owns *scheduling*; this document owns *what goes into the
prompt*. Section references written `CTX §x` point here; `§x` still points at specs.md.

---

## 1. Problem Statement

As a story moves through design → multiple implementation tasks → QA → retries, the naive approach
is to keep feeding the agent more: the full story, every prior task's output, all project docs, the
whole decision history. Every LLM (Claude, GPT, Gemini) degrades the same way under that load:

- inference slows down,
- token cost grows super-linearly with story length,
- context pollution and "lost in the middle" dilute attention,
- the agent forgets what actually matters.

The fix is the one most modern agent frameworks converge on: **don't hold all context — build
context on demand from durable state.**

```
Traditional chat:           This system (target):
  Human                       State (DB + git worktree)
   ↓                           ↓
  Conversation                Context Builder  (budget-bounded, per task)
   ↓                           ↓
  LLM                         LLM  (fresh process, pulls detail via its own file tools)
```

The LLM should only ever see *what the current task needs*, not the entire project.

---

## 2. Current System Assessment

The current implementation is **partway there already** — it is not the "one giant conversation"
anti-pattern:

| Principle | Where it stands today | Reference |
|---|---|---|
| No conversation accumulation | ✅ Each task/QA/design spawns a **fresh** `claude` process with a freshly-built prompt; nothing is carried turn-to-turn between tasks. | [server/claudeRunner.ts:70](server/claudeRunner.ts#L70), [server/execution.ts:544](server/execution.ts#L544) |
| Story → Task decomposition | ◐ Exists, but the "planner" is a keyword heuristic that always emits 1–2 impl tasks + a QA task. | [`inferTasks`](server/execution.ts#L251) |
| Context-section selection | ◐ Selects a subset of the 7 sections (story-type ∪ role ∪ keyword), but injects each selected section **in full**. | [`selectContextSections`](server/contextBuilder.ts#L51), [contextBuilder.ts:144](server/contextBuilder.ts#L144) |
| Task graph (`depends_on`, `scope_paths`) | ✗ Columns exist but `depends_on` is linear seq-order and `scope_paths` is **always written `[]`**. | [db.ts:168-169](server/db.ts#L168-L169), [execution.ts:381](server/execution.ts#L381) |
| Artifact system | ✗ The git worktree is the de-facto artifact store, but nothing indexes it. Outputs are captured as free-text `impl_summary` blobs. | [execution.ts:573](server/execution.ts#L573) |
| Working memory / snapshot | ✗ None. | — |
| Decision log / compression | ✗ Decisions are buried inside the design blob and impl prose. | [stories.design](server/db.ts#L233) |
| Long-term memory / retrieval | ✗ Project context is injected by static rules, not retrieved by relevance. | [contextBuilder.ts:51](server/contextBuilder.ts#L51) |

### 2.1 The primary leak

```ts
// server/contextBuilder.ts:163-171 (abridged)
if (params.priorTasks && params.priorTasks.length > 0) {
  for (const t of params.priorTasks) {
    priorParts.push(`### Task ${t.seq}: ${t.title} ...`);
    if (t.impl_summary) priorParts.push(`**Implementation Summary:**\n${t.impl_summary}`);
  }
}
```

`priorTasks` is **every** prior `done` task ([execution.ts:505-510](server/execution.ts#L505-L510)),
each `impl_summary` up to 8000 chars ([execution.ts:573](server/execution.ts#L573)). So:

- task *N* carries *N − 1* full prose summaries → prompt grows **O(tasks)**;
- on every orchestrator retry the whole `executeStory` pipeline re-runs from the top
  ([orchestrator.ts:258](server/orchestrator.ts#L258)), rebuilding that growing prompt each time.

Fixing just this — replacing the concatenated summaries with a compact, bounded **snapshot** —
converts the token curve from O(tasks) to ≈ constant and captures most of the win.

---

## 3. Design Principles

1. **Manage State, not Context.** The conversation is disposable; the durable record is State
   (DB rows + the git worktree). Context is *derived* from State per task, never the reverse.
2. **Carry pointers, not bodies.** The prompt names files, decisions, and artifacts and summarizes
   them in one line each; the agent pulls full content itself with its Read/Grep tools in the
   worktree. (This is natural here — agents already have file tools.)
3. **Bounded budget.** Assembled context has a fixed token budget (CTX §6.3). Lower-priority
   material is dropped or truncated, never allowed to grow unbounded.
4. **Compress decisions.** A decision becomes a short record ("Decision #15: use JWT — stateless"),
   not a 5000-token replay of the conversation that produced it.
5. **Resumability.** From State alone, a fresh agent (or a restarted server) can pick up a
   half-finished story. No in-memory or in-conversation state is load-bearing for correctness.
6. **Keep the offline test seam.** Every change must remain verifiable through the fake-runner seam
   (`__setClaudeRunner`) so `npm test` stays green without the CLI, tokens, or auth.

---

## 4. Target Architecture

```
        ┌──────────────── State (SQLite + git worktree) ────────────────┐
        │ stories / story_tasks   the task graph (depends_on, scope_paths)│
        │ story_snapshot          working memory — compact, ~few KB/story │
        │ decisions               append-only, compressed                │
        │ artifacts               manifest: path / kind / one-line summary│
        │ project_contexts        long-term memory — retrieved, not dumped│
        └───────────────────────────────┬──────────────────────────────┘
                                         │
                          ContextBuilder v2  (CTX §6)
                          assemble for ONE task, under a token budget,
                          pointers + summaries (not file bodies)
                                         │
                              claude CLI  (fresh process; reads full
                              files itself via Read/Grep in worktree)
                                         │
                          structured write-back  (CTX §7)
                          decisions[] · artifacts[] · snapshot patch
```

Two layers of memory, mirroring human memory:

- **Working memory** = `story_snapshot` (the current sprint/story state — a few KB, always loaded).
- **Long-term memory** = `project_contexts` + `decisions` + `artifacts` (retrieved on demand,
  never loaded wholesale).

---

## 5. Domain Model — Schema Additions

All additions follow the existing hand-rolled style in [server/db.ts](server/db.ts): idempotent
`CREATE TABLE IF NOT EXISTS` plus best-effort `ALTER TABLE`. No ORM, no migration tool.

### 5.1 `story_snapshot` — working memory (Phase 1)

One row per story. The compact, always-injected state object that **replaces** the concatenated
prior-summaries loop.

```sql
CREATE TABLE IF NOT EXISTS story_snapshot (
  story_id    TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  goal        TEXT,            -- 1-2 sentence story goal (derived once at plan time)
  state_json  TEXT NOT NULL DEFAULT '{}',  -- see shape below
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`state_json` shape (bounded; each list capped, each string truncated):

```jsonc
{
  "completed":   [{ "seq": 1, "title": "Design DB", "result": "added users table + migration" }],
  "in_progress": { "seq": 3, "title": "Implement login API" },
  "blocked":     [{ "seq": 4, "reason": "waiting on token format decision (#15)" }],
  "decisions":   [15, 16],          // active decision ids relevant to this story
  "artifacts":   ["server/auth.ts", "migrations/004_users.sql"]  // key paths
}
```

The per-task `result` is a one-line summary, not the full `impl_summary`. The full `impl_summary`
stays in `story_tasks` for the detail view; it is **not** injected into sibling-task prompts.

### 5.2 `decisions` — compressed decision log (Phase 2)

Append-only. A decision is recorded once and referenced by id thereafter.

```sql
CREATE TABLE IF NOT EXISTS decisions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id      TEXT REFERENCES stories(id) ON DELETE SET NULL,  -- null = project-level
  seq           INTEGER NOT NULL,        -- human-facing "#15", monotonic per project
  topic         TEXT NOT NULL,           -- "Authentication"
  decision      TEXT NOT NULL,           -- "Use JWT"
  rationale     TEXT,                    -- "Stateless architecture"
  status        TEXT NOT NULL DEFAULT 'active',   -- active | superseded
  supersedes_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
  created_by    TEXT NOT NULL DEFAULT 'agent',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_story   ON decisions(story_id);
```

Injected form (compact): `#15 [Authentication] Use JWT — stateless architecture`. Tens of tokens,
not thousands. Superseded decisions are excluded by default.

### 5.3 `artifacts` — manifest, not content (Phase 3)

The artifact's *content* lives in the git worktree. This table is an **index** so the context
builder can offer relevant paths + one-line summaries without reading every file.

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id    TEXT REFERENCES stories(id) ON DELETE SET NULL,
  task_id     TEXT REFERENCES story_tasks(id) ON DELETE SET NULL,
  path        TEXT NOT NULL,           -- relative to the worktree, e.g. "server/auth.ts"
  kind        TEXT NOT NULL,           -- prd | api | schema | test | doc | code | design
  summary     TEXT,                    -- one line: what this file is / does
  status      TEXT NOT NULL DEFAULT 'active',  -- active | stale | removed
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(story_id, path)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_story ON artifacts(story_id, status);
```

The existing `stories.design` blob ([db.ts:233](server/db.ts#L233)) is itself an artifact of
`kind='design'` and should be registered here once this table exists.

### 5.4 Reuse existing columns

- `story_tasks.scope_paths` — finally populate it (CTX §8): the files/globs a task is allowed to
  touch. Becomes the retrieval key for which artifacts/decisions to inject for that task.
- `story_tasks.depends_on` — keep as the task-graph edges; the planner (CTX §8) sets real edges
  instead of `[seq-1]`.

---

## 6. ContextBuilder v2

Replaces [`buildTaskPromptBlocks`](server/contextBuilder.ts#L95). Builds the prompt for **one task**
from State, under a fixed budget.

### 6.1 Inputs

`{ storyId, taskId }` — everything else is read from State. (Today the caller passes prose blobs
in; v2 reads them from `story_snapshot` / `decisions` / `artifacts`.)

### 6.2 Assembly order (highest priority first)

1. **System block** — agent role system prompt (unchanged).
2. **Task block** — this task's title, description, acceptance criteria, and its `scope_paths`.
3. **Story snapshot** — `goal` + the compact `state_json` (CTX §5.1). *Bounded.*
4. **Active decisions in scope** — compact lines (CTX §5.2), filtered to this task's scope/topic.
5. **Artifact manifest in scope** — `path — summary` lines for artifacts whose path intersects
   `scope_paths` (CTX §5.3). The agent reads the actual files itself.
6. **Retrieved project-context chunks** — relevance-ranked, budget-capped (CTX §9). Replaces the
   wholesale section injection at [contextBuilder.ts:144](server/contextBuilder.ts#L144).

### 6.3 Token budget

A single `context_token_budget` setting (default ≈ 8000 tokens for items 3–6; the system prompt and
task block are always included). Greedy fill in priority order; when the budget is exhausted, stop
adding lower-priority items. Each block also has a per-block cap so no single block can crowd out the
rest. Estimation reuses the existing `Math.ceil(len/4)` heuristic ([contextBuilder.ts:200](server/contextBuilder.ts#L200)) until a real tokenizer is worth adding.

### 6.4 Output

`{ systemBlock, contextBlock, includedSections, includedDecisionIds, includedArtifactPaths,
estimatedTokens, droppedForBudget[] }`. The `dropped*`/`included*` fields are logged so context
assembly is observable (which is impossible today).

---

## 7. Write-Back Protocol

Agents already signal results through a marker convention — QA emits `QA_RESULT: PASS/FAIL`, parsed
at [execution.ts:729](server/execution.ts#L729). Extend the same mechanism so a run can update State
without us parsing free-form prose.

A run's final message may include any of:

```
DECISION: [<topic>] <decision> — <rationale>
ARTIFACT: <kind> <path> — <one-line summary>
SNAPSHOT: <one-line status of what this task accomplished>
```

After a task completes ([execution.ts:572](server/execution.ts#L572)):

1. Parse `DECISION:` lines → insert into `decisions` (assign next `seq`, mark prior same-topic
   decisions `superseded` if the agent says so).
2. Parse `ARTIFACT:` lines → upsert into `artifacts` (keyed on `story_id,path`).
3. Update `story_snapshot`: move this task to `completed` with its `SNAPSHOT:` line (or a truncated
   `impl_summary` fallback), recompute `in_progress`/`blocked`, refresh `decisions`/`artifacts`
   id lists.

Markers are optional and additive — a run that emits none still works (snapshot falls back to a
truncated `impl_summary`, exactly as the QA marker is optional today).

---

## 8. Planner (replacing the heuristic)

[`inferTasks`](server/execution.ts#L251) is a keyword heuristic. The target is a real **Planner**
that runs inside the existing design gate (`executeDesign`, [execution.ts:820](server/execution.ts#L820))
and emits a structured task graph instead of prose:

```jsonc
{
  "goal": "Support email login",
  "tasks": [
    { "seq": 1, "role": "backend",  "title": "Design DB",   "scope_paths": ["migrations/**","server/db.ts"], "depends_on": [] },
    { "seq": 2, "role": "backend",  "title": "Login API",   "scope_paths": ["server/auth.ts","server/routes/auth.ts"], "depends_on": [1] },
    { "seq": 3, "role": "frontend", "title": "Login form",  "scope_paths": ["src/pages/Login.tsx"], "depends_on": [2] },
    { "seq": 4, "role": "qa",       "title": "Verify login", "scope_paths": [], "depends_on": [2,3] }
  ]
}
```

This finally populates `scope_paths`/`depends_on` (CTX §5.4), which are the retrieval keys
ContextBuilder v2 needs. The planner output is still gated by `design_review` (human approves the
plan once, as today). The heuristic stays as the offline/`enabled=false` fallback so the test suite
needs no CLI.

---

## 9. Long-Term Memory / Retrieval

Don't over-engineer this for a single-user, SQLite, Node tool. Recommended progression:

- **Phase 3 (start here):** keyword/scope overlap. Rank `project_contexts` sections and `artifacts`
  by overlap with the task's `scope_paths` + title/AC terms; take the top-K under budget. This is a
  better version of the static rules already in [contextBuilder.ts](server/contextBuilder.ts#L51).
- **Phase 5 (optional):** SQLite **FTS5** virtual table over `artifacts.summary`, `decisions`, and
  `project_contexts.content` for BM25 ranking — still zero external deps, ships with SQLite.
- **Only if needed:** embeddings + a vector column. For one project's worth of docs this is almost
  certainly unnecessary; note it as a future option, not a requirement.

---

## 10. Migration Plan (phased, each independently shippable)

Each phase keeps `npm test` green via the fake-runner seam and is small enough to land alone.

| Phase | Scope | Outcome |
|---|---|---|
| **1 ✅** | `story_snapshot` + rewrite the prior-summaries loop in ContextBuilder to inject the snapshot. | **Done.** Prompt size O(tasks) → ≈ constant. Also pruned the dead `phase==="design"` branch + `design_output` reads (14.B). New module [server/snapshot.ts](server/snapshot.ts); regression guard in [tests/execution-chain.test.ts](tests/execution-chain.test.ts). |
| **2 ✅** | `decisions` table + `DECISION:` marker parse + compact injection. | **Done.** Decisions stop getting lost / re-derived; same-topic supersession keeps one current answer. New module [server/decisions.ts](server/decisions.ts). (`story_snapshot.decisions[]` stays reserved until Phase 3 scopes them per task.) |
| **3 ✅** | `artifacts` manifest + populate `scope_paths` + scoped/budgeted retrieval (replaces wholesale section injection). | **Done.** New module [server/artifacts.ts](server/artifacts.ts); files registered from `git diff` + `ARTIFACT:` markers; manifest ranked by the task's `scope_paths`; project context now injected under `context_token_budget` (default 8000). Static section *rules* still pick candidates — replacing them with FTS5/embeddings is Phase 5. |
| **4 ✅** | Real Planner agent (CTX §8) behind the design gate. | **Done.** The design agent emits a fenced JSON task graph; [server/planner.ts](server/planner.ts) normalizes it; `executeDesign` builds tasks from it (real `depends_on`/`scope_paths`, appended QA gate) and falls back to `inferTasks` offline. |
| **5** | FTS5 (or embeddings) retrieval upgrade. | Relevance ranking replaces static keyword rules. |

Phase 1 is the recommended first cut: it directly delivers the "token cost approaches constant"
goal and de-risks the rest.

---

## 11. Testing Strategy

- Extend [tests/execution-chain.test.ts](tests/execution-chain.test.ts) with a multi-task story and
  assert that the assembled `estimatedTokens` for task *N* does **not** grow with *N* once Phase 1
  lands (the regression guard for the primary leak).
- Unit-test the marker parsers (CTX §7) the same way the QA marker is implicitly exercised today.
- Unit-test ContextBuilder v2 budget enforcement: given oversized inputs, assert priority order is
  respected and `droppedForBudget` is populated.
- The fake runner can emit `DECISION:`/`ARTIFACT:`/`SNAPSHOT:` markers so the whole write-back loop
  is exercised offline, with no CLI.

---

## 12. Open Questions

1. **Snapshot authorship.** Derive the snapshot deterministically server-side from task rows
   (cheap, predictable), or have the agent author its own `SNAPSHOT:` line (richer, costs a marker)?
   Proposal: deterministic by default, agent line as an override.
2. **Decision `seq` scope.** Per-project (`#15` globally) or per-story? Proposal: per-project, so a
   decision can be referenced across stories.
3. **Artifact registration source.** Parse `ARTIFACT:` markers only, or also diff the worktree
   (`git diff --name-only`) after a task to auto-register touched files? Proposal: auto-register
   from git diff, let markers override `kind`/`summary`.
4. **Budget default.** 8000 tokens is a guess; tune against real runs once Phase 1 is measurable.
5. **Backfill.** Existing stories have no snapshot. Proposal: lazily build one on first access from
   existing `story_tasks` rows; no bulk migration.

---

## 13. Appendix — Illustrative Before/After

A story on its 4th task (3 prior done tasks), today vs. Phase 1.

**Today** (prompt for task #4):
```
[system prompt]
## Project Context        (full text of every selected section)
## Story ...
## Prior Task Context
### Task 1 ... Implementation Summary: <up to 8000 chars>
### Task 2 ... Implementation Summary: <up to 8000 chars>
### Task 3 ... Implementation Summary: <up to 8000 chars>
## Your Task ...
```
≈ grows with each completed task; on retry, rebuilt and re-sent.

**Phase 1** (prompt for task #4):
```
[system prompt]
## Story Snapshot
Goal: Support email login
Done:  #1 Design DB (users table + migration) · #2 Login API · #3 Login form
Now:   #4 Verify login
Blocked: none
Key files: server/auth.ts, migrations/004_users.sql
## Your Task ...   (+ scope_paths; agent reads the files it needs)
```
≈ constant regardless of how many tasks precede it.

---

## 14. Replacement & Deprecation Map

What the redesign *replaces*, what becomes *dead*, and what is deliberately *kept*. This is the
inventory to work from so we don't reimplement something that already works, or preserve something
that's already dead.

### 14.A — Existing code replaced BY the redesign

| New component | Replaces | Existing code disposition | Phase |
|---|---|---|---|
| `story_snapshot` + snapshot injection | The prior-task concatenation loop and its query | **Delete** [contextBuilder.ts:163-171](server/contextBuilder.ts#L163-L171); **delete** the `priorTasks` queries at [execution.ts:505-510](server/execution.ts#L505-L510) and [execution.ts:648-653](server/execution.ts#L648-L653); drop the `priorTasks` param + `PriorTaskContext` | 1 |
| `decisions` table + `DECISION:` marker | Decisions buried in `stories.design` / `impl_summary` prose | `stories.design` **kept** (human-reviewed plan); decisions are *extracted* into their own records | 2 |
| `artifacts` manifest + scoped retrieval | Wholesale section injection | ✅ **Done** — `contextBlock` assembled under a token budget (drops lowest-priority sections first); artifact manifest injected as scoped pointers. | 3 |
| Scope/relevance retrieval | The 3-layer static rules + their settings | **Retire** [`selectContextSections`](server/contextBuilder.ts#L51) and the seeded settings `execution_context_rules` / `agent_role_context_rules` / `keyword_context_rules` ([db.ts:114-157](server/db.ts#L114-L157)) **and the Settings-page UI that edits them** | 3 → 5 |
| Real Planner agent | `inferTasks` keyword heuristic | ✅ **Done** — `inferTasks` kept as the `enabled=false`/offline fallback; LLM planner ([server/planner.ts](server/planner.ts)) used in `executeDesign`. | 4 |
| Planner-set `scope_paths` / `depends_on` | `scope_paths` always `[]`, `depends_on` linear | ✅ **Done** — `createTasksFromPlan` populates both from the agent's task graph. | 4 |

### 14.B — Dead code TODAY (useless regardless of the redesign — remove on contact)

These are already non-functional. They are not "replaced"; they are pruned.

| Dead feature | Evidence | Action |
|---|---|---|
| `buildTaskPromptBlocks` `phase === "design"` branch | `phase` is **only ever** passed as `"implement"` ([execution.ts:522](server/execution.ts#L522), [:672](server/execution.ts#L672), [:859](server/execution.ts#L859)); the branch is unreachable. It also instructs the agent to call `list_directory` / `read_file` / `submit_design` / `write_file` — **tools that don't exist** in the Claude Code CLI (which has Read/Write/Edit/Bash/Grep). Leftover from an abandoned custom tool-calling design. | **Delete** the branch + `phase`/`designOutput` params ([contextBuilder.ts:101](server/contextBuilder.ts#L101), [:180-187](server/contextBuilder.ts#L180-L187)) |
| `story_tasks.design_output` | Column was **read** + **displayed** but **never written** → always `null`. The "Design Spec" rendering was dead. | ✅ **Done** — reads removed (Phase 1), UI panel + `StoryTask.design_output` type removed (cleanup); column left dormant (SQLite can't cheaply drop it) |
| Legacy `phase` column double-write | `phase` was written alongside `status` on every task transition but **never read for logic** — only the one-time backfill at [db.ts](server/db.ts) consumes it. Fully redundant with `status`. | ✅ **Done** — writes removed from [execution.ts](server/execution.ts), dropped from the [tasks PATCH allowlist](server/routes/tasks.ts) and the `StoryTask`/`TaskPhase` types; column + one-time backfill left dormant |

### 14.C — Kept as-is (explicitly NOT replaced — do not touch)

So it's clear what's load-bearing and good:

- **Orchestrator / scheduling** ([orchestrator.ts](server/orchestrator.ts)) — out of scope; untouched.
- **Fresh-process-per-task** ([claudeRunner.ts](server/claudeRunner.ts)) — this is the *correct*
  foundation the redesign builds on, not a thing to fix.
- **Design-review gate** (`executeDesign` → `design_review` → human approve,
  [execution.ts:820](server/execution.ts#L820)) — kept; the Planner (Phase 4) plugs *into* it.
- **`stories.design` blob** — kept as the human-facing plan; decisions are extracted *alongside* it.
- **QA gate + `QA_RESULT:` marker** ([execution.ts:729](server/execution.ts#L729)) — kept; the new
  `DECISION:`/`ARTIFACT:`/`SNAPSHOT:` markers extend the *same* convention.
- **Workspace/worktree isolation, hooks, WORKFLOW.md** — kept.
- **`project_contexts` (7 sections) + scanner** — kept as the long-term-memory *source*; only *how
  sections are selected* changes (Phase 3).
- **`agent_runs` token accounting** — kept.

### 14.D — Net effect by phase

- **Phase 1** removes: prior-task loop (14.A), dead design branch (14.B), `design_output` reads
  (14.B), `phase` writes (14.B). Adds: `story_snapshot`. Everything else in `contextBuilder` /
  `selectContextSections` stays — Phase 1 only swaps the prior-task block for the snapshot block.
- **Phase 3** retires the static-rules selection + its Settings UI (14.A row 4).
- **Phase 4** demotes `inferTasks` to fallback (14.A row 5).
