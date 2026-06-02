# Product Requirements Document — Agile with Agent

## Overview

**Agile with Agent** is a lightweight agile project management tool built for AI-augmented development teams. It combines standard scrum/kanban workflows with first-class support for assigning AI coding agents (Claude, Codex, Copilot, Gemini, etc.) to user stories. The key differentiator is the **Project Context** system — a structured knowledge base per project that gives agents the background they need to execute stories correctly.

**Current Status:** MVP — core project management loop is functional. Agent execution is not yet automated (agents are assigned but not invoked).

---

## Problem Statement

Modern AI coding agents can implement features autonomously, but they lack structured context:

- They don't know the project's conventions, data model, or architecture without being told
- Agile backlogs are scattered across Notion/Linear/Jira with no clean way to feed them into an agent
- There's no single place to manage which agent is responsible for which story and track its status

**Agile with Agent** solves this by pairing a lightweight agile board with a project knowledge base that agents read before starting work.

---

## Target Users

| User | Description |
|------|-------------|
| **Solo developer with agents** | One developer managing multiple AI agents across several projects |
| **Small team** | 2–5 engineers using a mix of human developers and AI agents |
| **AI-first team** | Team where majority of implementation is delegated to agents with humans reviewing |

---

## Goals

### Primary
- Manage agile work (stories, sprints, epics, backlog) with minimal friction
- Assign AI agents to stories and track their status on the board
- Maintain a per-project knowledge base that agents can consume before starting work

### Secondary
- Auto-populate context by scanning existing codebases (local or GitHub)
- Provide agents with a structured prompt that includes story + project context
- Reduce the "setup tax" for onboarding a project into AI-assisted development

---

## Features

### 1. Project Management

#### 1.1 Projects
- Create projects with name, key (e.g., `AGW`), description, and color
- Two-step creation wizard: basic info → source (None / Local / GitHub)
- If existing project: auto-scan repo to populate context on creation
- Project key auto-generates short unique identifiers for stories (e.g., `AGW-12`)
- Settings: name, description, tech stack tags, local path, GitHub URL, definition of done
- Delete project (with confirmation) — cascades to all stories, sprints, epics

#### 1.2 Epics
- Group related stories under a named, color-coded epic
- Status: `open` / `closed`
- Stories can be assigned to an epic or left ungrouped
- Backlog view groups stories by epic

#### 1.3 Sprints
- Create sprints with name, goal, date range, and story point capacity
- Status flow: `planning` → `active` → `completed`
- One active sprint per project at a time (enforced)
- Starting a sprint promotes backlog stories in that sprint to `todo`
- Deleting a sprint returns its stories to backlog
- Sprint progress: stories done / total, points used / capacity

#### 1.4 Stories
- Types: `story` | `bug` | `task` | `spike`
- Status flow: `backlog` → `todo` → `in_progress` → `in_review` → `done`
- Priority: `low` | `medium` | `high` | `urgent`
- User story format: "As a ___, I want ___, so that ___"
- Acceptance criteria, description, definition of done (inherits from project if unset)
- Story points, epic assignment, sprint assignment, agent assignment
- Auto-generated sequential key per project (`PROJECT_KEY-N`)

---

### 2. Board & Backlog Views

#### 2.1 Kanban Board
- Shows active sprint's stories in 4 columns: Todo / In Progress / In Review / Done
- Story cards: type icon, key, title, epic badge, priority dot, story points, agent name
- Click card to open full detail dialog
- Quick-add story in Todo column

#### 2.2 Backlog
- All stories without a sprint assignment
- Grouped by epic
- Filter by story type
- Quick-add story

---

### 3. AI Agents

#### 3.1 Agent Registry
- Define agents with: name, provider (`claude` | `codex` | `copilot` | `gemini` | `custom`), model, system prompt, prompt template
- Provider color coding for visual identification
- Per-agent stats: active stories, total stories assigned

#### 3.2 Agent Assignment
- Assign any agent to any story
- Assigned agent shown on board cards and story detail
- Agent stats reflect current assignment counts

#### 3.3 Prompt Template
- Each agent has a configurable prompt template with variable substitution:
  - `{{story_title}}` — story title
  - `{{story_description}}` — description / user story
  - `{{acceptance_criteria}}` — acceptance criteria checklist
- (Planned) Project context injection into prompt before agent execution

---

### 4. Project Context

#### 4.1 Context Sections (7 fixed per project)
| Section | Purpose |
|---------|---------|
| `overview` | Project goals, target users, high-level description |
| `prd` | Product requirements, feature list, user flows |
| `design_system` | UI components, colors, typography, patterns |
| `data_model` | Database schema, entities, relationships |
| `architecture` | System design, tech stack, infrastructure decisions |
| `conventions` | Code style, naming, file structure, patterns |
| `glossary` | Domain terms and definitions |

#### 4.2 Context Editing
- Inline markdown editor per section
- Manual edit with Save / Cancel
- Shows last updated time and source (`human` / `scan`)

#### 4.3 Auto-scan (Local)
- Reads files from `local_path`: README, PRD.md, schema files, package.json, CONTRIBUTING.md, docs/, etc.
- Populates matching context sections automatically
- Available via "Scan from repo" button in Context tab or on project creation

#### 4.4 Auto-scan (GitHub)
- Fetches files from public GitHub repo via API (no auth for public repos)
- Same file mapping as local scan
- Triggered on project creation when "existing project" + GitHub URL is selected

---

### 5. Dashboard

- Workspace-level stats: total projects, total agents, stories in progress, stories in review
- Live feed of all active work (in_progress + in_review) across all projects
- Auto-refreshes every 15 seconds

---

## User Flows

### Create a project from an existing repo
1. Click "New project" → enter name, key, color → Next
2. Select "Local directory" or "GitHub repo" → enter path/URL
3. Select "Existing project — scan for content"
4. Click "Create & Scan" → project created, context auto-populated from repo files

### Plan and start a sprint
1. Create stories in backlog (with type, priority, points, epic)
2. Create sprint (name, goal, dates, capacity)
3. Drag or assign stories to sprint from backlog
4. Click "Start" on sprint → stories move to Todo, board becomes active

### Assign agent to a story and track work
1. Open story detail → Assigned Agent → select agent
2. Story appears on board under agent's name
3. (Manual for now) Execute agent with generated prompt
4. Move story through In Progress → In Review → Done

### Build project context for agents
1. Go to project Context tab
2. Click "Scan from repo" to auto-populate from codebase
3. Manually edit sections to add architecture decisions, conventions, glossary
4. Agents will receive this context when executing stories (planned)

---

## Out of Scope (MVP)

- **Agent execution automation** — invoking agents via API or CLI is not implemented; assignment is tracking-only
- **Real-time collaboration** — no multi-user sync or presence
- **Notifications** — no email/Slack alerts
- **GitHub integration beyond scanning** — no PR creation, issue sync, or status updates
- **Time tracking** — no logged hours or time estimates beyond story points
- **Role-based access control** — single-user tool

---

## Planned / Future Features

| Feature | Priority | Notes |
|---------|----------|-------|
| Agent execution via Claude Code CLI | High | Run `claude` with generated prompt, capture output |
| Context injection into agent prompt | High | Append relevant context sections to story prompt |
| Story auto-decomposition | Medium | Agent breaks epic into stories |
| PR → story status sync | Medium | Close story when PR merged |
| Story comments / activity log | Medium | Track what happened, agent output log |
| GitHub auth for private repo scanning | Low | OAuth or PAT for private repos |
| Archive project (soft delete) | Low | `status = 'archived'` already in schema |
| Export / import project | Low | JSON dump of project + context + stories |
| Multi-user support | Low | Auth + row-level ownership |

---

## Technical Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS v4, TanStack Query, React Router v7 |
| Backend | Hono (on Node.js), TypeScript |
| Database | Node.js built-in SQLite (`node:sqlite`, Node 22.5+) |
| Animation | Framer Motion |
| Dev Runtime | `node --watch` + tsx ESM loader |

**Data persistence:** Single SQLite file at `data/agile.db`  
**API:** REST, co-located server on port 3001, proxied through Vite in dev  
**No build step for server** — TypeScript executed directly via tsx at runtime

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to create project + first sprint | < 3 minutes |
| Context sections populated per project | ≥ 3 of 7 via scan |
| Stories completable per sprint | No technical limit |
| Agent-assigned story ratio | Tracked via dashboard active count |
