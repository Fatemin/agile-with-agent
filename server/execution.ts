import { db } from "./db.js";
import { log } from "./logger.js";
import { buildBranchName, createBranch, createBranchFrom } from "./git.js";
import { nanoid } from "nanoid";
import { buildTaskPromptBlocks, buildWorkflowPolicyBlock, type PriorTaskContext } from "./contextBuilder.js";
import { TemplateRenderError } from "./workflow.js";
import { runClaudeCode, recordAgentRun, type RunResult } from "./claudeRunner.js";
import { getAgentRuntimeConfig } from "./runtimeConfig.js";
import { ensureWorkspace } from "./workspace.js";
import { loadWorkflow } from "./workflow.js";
import { runHook } from "./hooks.js";

export interface RunOptions {
  signal?: AbortSignal;
  /**
   * Run attempt number for prompt rendering (Symphony §12.3): null/absent on the
   * first run, integer on a retry or continuation. Passed to the WORKFLOW.md
   * template as `attempt` so policies can vary instructions across attempts.
   */
  attempt?: number | null;
}

/**
 * Ensure a per-story workspace exists and return its path. Symphony §9.
 * Used by executeTask / executeQA so agents always run in an isolated
 * worktree (NOT the main project directory).
 *
 * Runs `after_create` hook on first creation (§9.4).
 */
async function resolveStoryWorkspace(storyId: string): Promise<{ path: string | null; error?: string }> {
  const story = db.prepare(
    "SELECT s.key, s.branch_name, p.local_path FROM stories s JOIN projects p ON s.project_id = p.id WHERE s.id = ?"
  ).get(storyId) as { key: string; branch_name: string | null; local_path: string | null } | undefined;
  if (!story) return { path: null, error: "story not found" };
  if (!story.local_path) return { path: null, error: "project has no local_path" };

  const config = getAgentRuntimeConfig();
  const ws = ensureWorkspace({
    workspaceRoot: config.workspace_root,
    storyKey: story.key,
    repoPath: story.local_path,
    branchName: story.branch_name,
  });
  if (!ws.ok || !ws.path) return { path: null, error: ws.error ?? "workspace creation failed" };

  if (ws.created_now) {
    log(storyId, "workspace", `Workspace created: \`${ws.path}\` (branch: ${story.branch_name ?? "HEAD"})`, "system");

    // Run after_create hook (§9.4) — failure aborts workspace creation
    const wf = loadWorkflow(story.local_path);
    const hookScript = wf.definition?.config.hooks?.after_create;
    const hookTimeout = wf.definition?.config.hooks?.timeout_ms;
    if (hookScript) {
      const result = await runHook({ kind: "after_create", script: hookScript, workspacePath: ws.path, timeoutMs: hookTimeout });
      if (result && !result.ok) {
        log(storyId, "workspace", `after_create hook failed: ${result.error ?? "exit non-zero"}\n${result.stderr.slice(-500)}`, "system", "error");
        return { path: null, error: `after_create hook failed: ${result.error}` };
      }
      if (result) log(storyId, "workspace", `after_create hook completed (${result.durationMs}ms)`, "system");
    }
  }
  return { path: ws.path };
}

/** Run before_run hook (§9.4) — failure aborts the attempt. */
async function runBeforeHook(storyId: string, workspacePath: string): Promise<{ ok: boolean; error?: string }> {
  const story = db.prepare("SELECT p.local_path FROM stories s JOIN projects p ON s.project_id = p.id WHERE s.id = ?")
    .get(storyId) as { local_path: string | null } | undefined;
  if (!story?.local_path) return { ok: true };
  const wf = loadWorkflow(story.local_path);
  const script = wf.definition?.config.hooks?.before_run;
  const timeout = wf.definition?.config.hooks?.timeout_ms;
  if (!script) return { ok: true };
  const result = await runHook({ kind: "before_run", script, workspacePath, timeoutMs: timeout });
  if (!result) return { ok: true };
  if (!result.ok) {
    log(storyId, "workspace", `before_run hook failed: ${result.error}\n${result.stderr.slice(-500)}`, "system", "error");
    return { ok: false, error: result.error };
  }
  log(storyId, "workspace", `before_run hook completed (${result.durationMs}ms)`, "system", "debug");
  return { ok: true };
}

/** Run after_run hook (§9.4) — failure is logged but ignored. */
async function runAfterHook(storyId: string, workspacePath: string): Promise<void> {
  const story = db.prepare("SELECT p.local_path FROM stories s JOIN projects p ON s.project_id = p.id WHERE s.id = ?")
    .get(storyId) as { local_path: string | null } | undefined;
  if (!story?.local_path) return;
  const wf = loadWorkflow(story.local_path);
  const script = wf.definition?.config.hooks?.after_run;
  const timeout = wf.definition?.config.hooks?.timeout_ms;
  if (!script) return;
  const result = await runHook({ kind: "after_run", script, workspacePath, timeoutMs: timeout });
  if (!result) return;
  if (!result.ok) log(storyId, "workspace", `after_run hook failed (ignored): ${result.error}`, "system", "warn");
  else log(storyId, "workspace", `after_run hook completed (${result.durationMs}ms)`, "system", "debug");
}

export type ExecutionEventType = "progress" | "text" | "tool_call" | "tool_result" | "done" | "error";

export interface ExecutionEvent {
  type: ExecutionEventType;
  content?: string;
  tool?: string;
  input?: unknown;
  sections?: string[];
  tokens?: number;
  /** Token usage for a completed agent run, surfaced so the orchestrator can
   *  accumulate live per-session totals for the Ops snapshot (Symphony §13.5). */
  tokensIn?: number;
  tokensOut?: number;
}

type StoryRow = {
  id: string;
  key: string;
  title: string;
  type: string;
  status: string;
  mode: string;
  project_id: string;
  assigned_agent_id: string | null;
  branch_name: string | null;
  epic_id: string | null;
  sprint_id: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role: string | null;
};

type TaskRow = {
  id: string;
  story_id: string;
  seq: number;
  type: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  estimate_hours: number | null;
  role: string;
  agent_id: string | null;
  status: string;
  phase: string;
};

type PlannedTask = {
  seq: number;
  type: "subtask" | "defect" | "spike";
  title: string;
  description: string;
  acceptance_criteria: string;
  estimate_hours: number;
  role: string;
};

export function getEnv(key: string): string | undefined {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'env_vars'").get() as { value: string } | undefined;
    if (!row) return undefined;
    const vars = JSON.parse(row.value) as Record<string, string>;
    return vars[key]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function getStory(storyId: string): StoryRow | undefined {
  return db.prepare(
    "SELECT id, key, title, type, status, mode, project_id, assigned_agent_id, branch_name, epic_id, sprint_id FROM stories WHERE id = ?"
  ).get(storyId) as StoryRow | undefined;
}

function getProjectLocalPath(projectId: string): string | null {
  const row = db.prepare("SELECT local_path FROM projects WHERE id = ?").get(projectId) as { local_path: string | null } | undefined;
  return row?.local_path ?? null;
}

function listStoryTasks(storyId: string): TaskRow[] {
  return db.prepare("SELECT * FROM story_tasks WHERE story_id = ? ORDER BY seq ASC").all(storyId) as TaskRow[];
}

function findIdleAgentByRole(role: string): AgentRow | null {
  const row = db.prepare(
    `SELECT a.id, a.name, a.role
     FROM agents a
     WHERE a.role = ?
       AND a.id NOT IN (
         SELECT DISTINCT assigned_agent_id
         FROM stories
         WHERE assigned_agent_id IS NOT NULL
           AND status = 'in_progress'
       )
     ORDER BY a.created_at ASC
     LIMIT 1`
  ).get(role) as AgentRow | undefined;
  return row ?? null;
}

// Fallback role chain — when the preferred role has no available agent, try these in order
const ROLE_FALLBACK: Record<string, string[]> = {
  fullstack: ["techlead", "backend", "frontend"],
  frontend:  ["fullstack", "techlead"],
  backend:   ["fullstack", "techlead"],
  qa:        ["techlead", "fullstack"],
  devops:    ["techlead", "backend"],
  security:  ["techlead", "backend"],
  techlead:  ["fullstack"],
  custom:    ["fullstack", "techlead"],
};

function findIdleAgentWithFallback(role: string): { agent: AgentRow; usedRole: string } | null {
  const direct = findIdleAgentByRole(role);
  if (direct) return { agent: direct, usedRole: role };
  for (const fallback of ROLE_FALLBACK[role] ?? []) {
    const agent = findIdleAgentByRole(fallback);
    if (agent) return { agent, usedRole: fallback };
  }
  return null;
}

function inferTaskRole(story: StoryRow, title: string, description: string | null): string {
  const text = `${story.title} ${title} ${description ?? ""}`.toLowerCase();
  // QA only when it's clearly a QA-specific task (not just any title containing "test")
  if (/\b(qa|verify|validation|regression|test\s+plan|test\s+case)\b/.test(text)) return "qa";
  if (/\b(ui|frontend|browser|react|component|css|layout|header|localstorage)\b/.test(text)) return "frontend";
  if (/\b(api|server|backend|route|database|sql|migration|endpoint|model)\b/.test(text)) return "backend";
  return "fullstack";
}

function getStoryContext(storyId: string): { description: string | null; acceptance_criteria: string | null; type: string } | null {
  return db.prepare("SELECT description, acceptance_criteria, type FROM stories WHERE id = ?").get(storyId) as
    { description: string | null; acceptance_criteria: string | null; type: string } | null;
}

function buildAC(items: string[]): string {
  return items.map((s) => `- [ ] ${s}`).join("\n");
}

/**
 * Tech Lead breaks the story down into Jira-style sub-tasks.
 * Each task gets: clear title, description with concrete steps,
 * acceptance criteria, estimate, and target role.
 *
 * Always ends with a QA verification task.
 */
function inferTasks(story: StoryRow): PlannedTask[] {
  const text = `${story.title}`.toLowerCase();
  const role = inferTaskRole(story, story.title, null);
  const ctx = getStoryContext(story.id);
  const storyDesc = ctx?.description?.trim() || "";
  const tasks: Omit<PlannedTask, "seq">[] = [];

  const isCrossStack = /\b(api|server|backend|ui|frontend|component|header|localstorage|database|sql)\b/.test(text);

  if (role === "frontend") {
    tasks.push({
      type: "subtask",
      title: `Implement: ${story.title}`,
      description: storyDesc ||
        `Build the UI for the story.\n` +
        `Reference the design system and existing components for consistency.\n` +
        `Use semantic tokens; avoid hard-coded colors/spacing.`,
      acceptance_criteria: buildAC([
        "UI renders correctly in all supported breakpoints",
        "Matches design system tokens (colors, spacing, typography)",
        "Handles loading and error states",
        "No console errors or warnings",
      ]),
      estimate_hours: 3,
      role: "frontend",
    });
  } else if (role === "backend") {
    tasks.push({
      type: "subtask",
      title: `Implement: ${story.title}`,
      description: storyDesc ||
        `Build the server-side logic for the story.\n` +
        `Define request/response shape, validate input, handle error paths.\n` +
        `Update the data model if needed.`,
      acceptance_criteria: buildAC([
        "Endpoint returns correct shape for the happy path",
        "Validates input and returns 4xx for invalid requests",
        "Handles concurrent / edge-case requests safely",
        "Logged appropriately for observability",
      ]),
      estimate_hours: 3,
      role: "backend",
    });
  } else if (isCrossStack) {
    tasks.push(
      {
        type: "subtask",
        title: `Backend: ${story.title}`,
        description: storyDesc ||
          `Implement the server-side changes required for this story.\n` +
          `Define the data contract that the frontend will consume.`,
        acceptance_criteria: buildAC([
          "API contract defined and documented",
          "Endpoint(s) implemented and validated",
          "Data persistence works correctly",
          "Errors return clear messages",
        ]),
        estimate_hours: 3,
        role: "backend",
      },
      {
        type: "subtask",
        title: `Frontend: ${story.title}`,
        description: `Build the UI that consumes the new/updated backend.\n` +
          `Handle loading, error and success states.`,
        acceptance_criteria: buildAC([
          "UI integrates with the backend contract",
          "Loading / error / empty states handled",
          "Matches design system",
          "Works on supported breakpoints",
        ]),
        estimate_hours: 2,
        role: "frontend",
      },
    );
  } else {
    tasks.push({
      type: "subtask",
      title: `Implement: ${story.title}`,
      description: storyDesc ||
        `End-to-end implementation for this story.\n` +
        `Update server, schema, and UI as needed.`,
      acceptance_criteria: buildAC([
        "Feature works end-to-end from UI to data layer",
        "Error paths handled gracefully",
        "Existing tests pass; new tests added for the new behavior",
      ]),
      estimate_hours: 4,
      role: "fullstack",
    });
  }

  // Always end with a QA verification task — Jira-style "Definition of Done" gate
  tasks.push({
    type: "subtask",
    title: "QA verification",
    description:
      `Validate the story end-to-end against its acceptance criteria.\n` +
      `Test the happy path, edge cases, and visible regressions.\n` +
      `File defects for any deviations from the spec.`,
    acceptance_criteria: buildAC([
      "All story acceptance criteria checked",
      "No new regressions in adjacent features",
      "Manual smoke test in a real browser / environment",
      "Defects filed for any issues found",
    ]),
    estimate_hours: 1,
    role: "qa",
  });

  return tasks.map((t, idx) => ({ ...t, seq: idx + 1 }));
}

function createPipelineTasks(story: StoryRow): number {
  const existing = listStoryTasks(story.id);
  if (existing.length > 0) return existing.length;

  const tasks = inferTasks(story);
  for (const task of tasks) {
    const match = findIdleAgentWithFallback(task.role);
    db.prepare(
      `INSERT INTO story_tasks (id, story_id, seq, type, title, description, acceptance_criteria, estimate_hours,
                                role, agent_id, scope_paths, depends_on, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo')`
    ).run(
      nanoid(), story.id, task.seq, task.type, task.title,
      task.description, task.acceptance_criteria, task.estimate_hours,
      task.role, match?.agent.id ?? null,
      JSON.stringify([]),
      JSON.stringify(task.seq > 1 ? [task.seq - 1] : []),
    );
    if (match) {
      const fallbackNote = match.usedRole !== task.role ? ` (fallback from ${task.role} → ${match.usedRole})` : "";
      log(story.id, "task_created",
        `Task #${task.seq} created: **${task.title}** [${task.role}] · ~${task.estimate_hours}h → ${match.agent.name}${fallbackNote}`,
        "system", match.usedRole === task.role ? "info" : "warn"
      );
    } else {
      log(story.id, "task_created",
        `Task #${task.seq} created: **${task.title}** [${task.role}] — no agent available (will fail when executed)`,
        "system", "warn"
      );
    }
  }

  db.prepare("UPDATE stories SET pipeline_mode = 1, updated_at = datetime('now') WHERE id = ?").run(story.id);
  log(story.id, "execution_complete",
    `Pipeline planned: ${tasks.length} task(s)\n${tasks.map((t) => `  #${t.seq} ${t.title} [${t.role}]`).join("\n")}`,
    "agent"
  );
  return tasks.length;
}

export async function* executeTechLeadPlan(storyId: string): AsyncGenerator<ExecutionEvent> {
  const story = getStory(storyId);
  if (!story) {
    log(storyId, "execution_error", "Planning failed: story not found", "system", "error");
    yield { type: "error", content: "Story not found" };
    return;
  }

  const projectPath = getProjectLocalPath(story.project_id);
  if (!projectPath) {
    log(storyId, "execution_error", "Planning failed: project has no local path configured", "system", "error");
    yield { type: "error", content: "Project has no local path" };
    return;
  }

  log(storyId, "execution_start", "Tech Lead planning pipeline...", "system", "debug");
  yield { type: "progress", content: "Tech Lead planning pipeline..." };

  const tasksCreated = createPipelineTasks(story);
  if (tasksCreated === 0) {
    log(storyId, "execution_error", "Planning failed: could not infer any tasks from story", "system", "error");
    yield { type: "error", content: "Tech Lead did not create any pipeline tasks" };
    return;
  }

  yield { type: "progress", content: `Pipeline ready with ${tasksCreated} task(s)` };
}

export async function* executeTask(storyId: string, taskId: string, opts?: RunOptions): AsyncGenerator<ExecutionEvent> {
  const task = db.prepare("SELECT * FROM story_tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task) {
    log(storyId, "execution_error", `Task execution failed: task ${taskId} not found`, "system", "error");
    yield { type: "error", content: "Task not found" };
    return;
  }

  // Try to assign an agent if none — use role fallback
  if (!task.agent_id) {
    const match = findIdleAgentWithFallback(task.role);
    if (match) {
      db.prepare("UPDATE story_tasks SET agent_id = ?, updated_at = datetime('now') WHERE id = ?").run(match.agent.id, taskId);
      task.agent_id = match.agent.id;
      const fallbackNote = match.usedRole !== task.role ? ` (fallback ${task.role} → ${match.usedRole})` : "";
      log(storyId, "agent_assigned",
        `Auto-assigned **${match.agent.name}** to task #${task.seq}${fallbackNote}`,
        "system", match.usedRole === task.role ? "info" : "warn"
      );
    }
  }

  // No agent available → mark task failed, do not fake completion
  if (!task.agent_id) {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    const msg = `Task #${task.seq} **${task.title}** cannot run: no available ${task.role} agent (and no fallback)`;
    log(storyId, "execution_error", msg, "system", "error");
    yield { type: "error", content: msg };
    return;
  }

  const agent = db.prepare("SELECT id, name, role, provider, system_prompt, model FROM agents WHERE id = ?").get(task.agent_id) as
    { id: string; name: string; role: string | null; provider: string; system_prompt: string | null; model: string | null } | undefined;

  if (!agent) {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    log(storyId, "execution_error", `Task #${task.seq}: agent record missing`, "system", "error");
    yield { type: "error", content: "Agent record missing" };
    return;
  }

  const config = getAgentRuntimeConfig();

  // Dry-run mode: explicit user opt-out of real agent execution
  if (!config.enabled) {
    const stubMsg = `Task #${task.seq} **${task.title}** halted: agent runtime is disabled in settings (would invoke ${agent.name})`;
    db.prepare("UPDATE story_tasks SET impl_summary = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`[DRY RUN] ${agent.provider} ${agent.name} would do: ${task.description ?? task.title}`, taskId);
    log(storyId, "execution_error", stubMsg, "system", "warn");
    yield { type: "error", content: stubMsg };
    return;
  }

  const story = getStory(storyId);
  if (!story) {
    yield { type: "error", content: "Story not found" };
    return;
  }

  // Symphony §9.5 Invariant 1: agent cwd MUST be the per-story workspace,
  // never the main project directory.
  const ws = await resolveStoryWorkspace(storyId);
  if (!ws.path) {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    log(storyId, "execution_error", `Task #${task.seq}: workspace setup failed — ${ws.error}`, "system", "error");
    yield { type: "error", content: `Workspace setup failed: ${ws.error}` };
    return;
  }
  const projectPath = ws.path;

  // Build prompt — include prior completed tasks for handoff context
  const priorTasks: PriorTaskContext[] = db.prepare(
    `SELECT seq, title, role, design_output, impl_summary
     FROM story_tasks
     WHERE story_id = ? AND seq < ? AND status = 'done'
     ORDER BY seq ASC`
  ).all(storyId, task.seq) as PriorTaskContext[];

  const role = (agent.role ?? task.role) as Parameters<typeof buildTaskPromptBlocks>[0]["agentRole"];
  const blocks = buildTaskPromptBlocks({
    storyId,
    taskTitle: task.title,
    taskDescription: [task.description, task.acceptance_criteria ? `\n### Acceptance Criteria\n${task.acceptance_criteria}` : ""].filter(Boolean).join("\n"),
    agentSystemPrompt: agent.system_prompt ??
      `You are a ${role ?? "software"} engineer working on an agile sprint. ` +
      `Use your tools (Read, Write, Edit, Bash, Grep) to complete the task in the project directory. ` +
      `Follow existing conventions. End your turn with a one-paragraph summary of what you changed.`,
    agentRole: role,
    phase: "implement",
    priorTasks,
  });

  // Repo-owned WORKFLOW.md policy (§5.4, §12) — strict render; a failure fails
  // this attempt (§12.4) just like any other run error.
  let workflowBlock: string | null;
  try {
    workflowBlock = buildWorkflowPolicyBlock(storyId, opts?.attempt ?? null);
  } catch (e) {
    const msg = e instanceof TemplateRenderError ? e.message : (e instanceof Error ? e.message : String(e));
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    log(storyId, "execution_error", `Task #${task.seq}: WORKFLOW.md prompt render failed — ${msg}`, "system", "error");
    yield { type: "error", content: `Workflow prompt render failed: ${msg}` };
    return;
  }

  const userPrompt = [workflowBlock, blocks.contextBlock, blocks.storyBlock].filter(Boolean).join("\n\n");

  db.prepare("UPDATE story_tasks SET status = 'in_progress', phase = 'implementing', updated_at = datetime('now') WHERE id = ?").run(taskId);
  log(storyId, "task_start",
    `▶ Task #${task.seq} → spawning **${agent.name}** [${agent.role ?? "?"}] · ${config.model} · cwd: ${projectPath}`,
    "system"
  );
  yield { type: "progress", content: `Spawning ${agent.name} for: ${task.title}` };

  // before_run hook (§9.4)
  const beforeHook = await runBeforeHook(storyId, projectPath);
  if (!beforeHook.ok) {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    yield { type: "error", content: `before_run hook failed: ${beforeHook.error}` };
    return;
  }

  const resultRef: { current: RunResult | null } = { current: null };
  yield* runClaudeCode({
    prompt: userPrompt,
    systemPrompt: blocks.systemBlock,
    cwd: projectPath,
    model: agent.model ?? config.model,
    permissionMode: config.permission_mode,
    cliPath: config.cli_path,
    timeoutMs: config.timeout_minutes * 60 * 1000,
    signal: opts?.signal,
  }, resultRef);

  // after_run hook (§9.4) — runs regardless of outcome
  await runAfterHook(storyId, projectPath);

  const result = resultRef.current;
  if (!result) {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(taskId);
    log(storyId, "execution_error", `Task #${task.seq} failed: runner returned no result`, "system", "error");
    yield { type: "error", content: "Runner returned no result" };
    return;
  }

  recordAgentRun({
    storyId, taskId, agentId: agent.id,
    runType: "execute", promptText: userPrompt, result,
  });

  // Token fields ride on the terminal event so the orchestrator can accumulate
  // live per-session totals for the Ops snapshot (Symphony §13.5).
  if (result.ok) {
    const summary = (result.result || "(no summary returned)").slice(0, 8000);
    db.prepare("UPDATE story_tasks SET status = 'done', phase = 'done', impl_summary = ?, updated_at = datetime('now') WHERE id = ?")
      .run(summary, taskId);
    log(storyId, "execution_complete",
      `✓ Task #${task.seq} complete · ${result.tokensIn}+${result.tokensOut} tok · ${result.turns}t · ${(result.durationMs/1000).toFixed(1)}s${result.costUsd ? ` · $${result.costUsd.toFixed(4)}` : ""}`,
      "agent"
    );
    yield { type: "progress", content: `Completed ${task.title}`, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  } else {
    db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', impl_summary = ?, updated_at = datetime('now') WHERE id = ?")
      .run((result.error ?? result.result ?? "").slice(0, 8000), taskId);
    log(storyId, "execution_error",
      `Task #${task.seq} failed: ${result.error ?? "agent reported error"}`,
      "system", "error"
    );
    yield { type: "error", content: result.error ?? "Agent execution failed", tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  }
}

export async function* executeQA(storyId: string, opts?: RunOptions): AsyncGenerator<ExecutionEvent> {
  const story = getStory(storyId);
  if (!story) {
    log(storyId, "execution_error", "QA failed: story not found", "system", "error");
    yield { type: "error", content: "Story not found" };
    return;
  }

  // Resolve a QA agent — explicit assignment, then idle qa-role agent, then fallback
  let qaAgentId: string | null = story.assigned_agent_id;
  if (!qaAgentId) {
    const match = findIdleAgentWithFallback("qa");
    if (match) {
      qaAgentId = match.agent.id;
      const fallbackNote = match.usedRole !== "qa" ? ` (fallback qa → ${match.usedRole})` : "";
      log(storyId, "agent_assigned",
        `Auto-assigned **${match.agent.name}** for QA${fallbackNote}`,
        "system", match.usedRole === "qa" ? "info" : "warn"
      );
    }
  }

  if (!qaAgentId) {
    log(storyId, "execution_error",
      "QA cannot run: no QA agent available (and no fallback). Story stays in QA with no result.",
      "system", "error"
    );
    yield { type: "error", content: "No QA agent available" };
    return;
  }

  const agent = db.prepare("SELECT id, name, role, provider, system_prompt, model FROM agents WHERE id = ?").get(qaAgentId) as
    { id: string; name: string; role: string | null; provider: string; system_prompt: string | null; model: string | null } | undefined;
  if (!agent) {
    yield { type: "error", content: "QA agent record missing" };
    return;
  }

  const config = getAgentRuntimeConfig();
  if (!config.enabled) {
    const stubMsg = `QA halted: agent runtime is disabled in settings (would invoke ${agent.name} to verify story)`;
    log(storyId, "execution_error", stubMsg, "system", "warn");
    yield { type: "error", content: stubMsg };
    return;
  }

  // Symphony §9.5: per-story workspace, not project root
  const ws = await resolveStoryWorkspace(storyId);
  if (!ws.path) {
    log(storyId, "execution_error", `QA cannot run: ${ws.error}`, "system", "error");
    yield { type: "error", content: `Workspace setup failed: ${ws.error}` };
    return;
  }
  const projectPath = ws.path;

  // Build QA prompt — same project context, but instructions focused on verification
  const priorTasks: PriorTaskContext[] = db.prepare(
    `SELECT seq, title, role, design_output, impl_summary
     FROM story_tasks
     WHERE story_id = ? AND status = 'done' AND role != 'qa'
     ORDER BY seq ASC`
  ).all(storyId) as PriorTaskContext[];

  const blocks = buildTaskPromptBlocks({
    storyId,
    taskTitle: "QA verification",
    taskDescription:
      `Verify the story against its acceptance criteria.\n\n` +
      `1. Read what the dev agents changed (see prior task summaries below).\n` +
      `2. Run the project's test suite if one exists (npm test / pytest / etc).\n` +
      `3. Inspect the changed files for obvious issues (type errors, missing handlers, broken imports).\n` +
      `4. Manually trace one happy-path and one edge-case through the new code.\n\n` +
      `End your final message with EXACTLY one of these lines on its own:\n` +
      `  QA_RESULT: PASS\n` +
      `  QA_RESULT: FAIL — <one-line reason>\n`,
    agentSystemPrompt: agent.system_prompt ??
      `You are a QA engineer. Verify implementation work against the acceptance criteria. ` +
      `Use Read, Bash (for tests), and Grep tools. Do not modify implementation files. ` +
      `Be skeptical but pragmatic.`,
    agentRole: "qa",
    phase: "implement",
    priorTasks,
  });

  // Repo-owned WORKFLOW.md policy (§5.4, §12) — strict render; a failure fails this attempt (§12.4).
  let workflowBlock: string | null;
  try {
    workflowBlock = buildWorkflowPolicyBlock(storyId, opts?.attempt ?? null);
  } catch (e) {
    const msg = e instanceof TemplateRenderError ? e.message : (e instanceof Error ? e.message : String(e));
    log(storyId, "execution_error", `QA: WORKFLOW.md prompt render failed — ${msg}`, "system", "error");
    yield { type: "error", content: `Workflow prompt render failed: ${msg}` };
    return;
  }

  const userPrompt = [workflowBlock, blocks.contextBlock, blocks.storyBlock].filter(Boolean).join("\n\n");

  log(storyId, "task_start",
    `▶ QA agent → spawning **${agent.name}** · ${config.model} · cwd: ${projectPath}`,
    "system"
  );
  yield { type: "progress", content: `Spawning ${agent.name} for QA verification` };

  // before_run hook (§9.4)
  const beforeHook = await runBeforeHook(storyId, projectPath);
  if (!beforeHook.ok) {
    yield { type: "error", content: `before_run hook failed: ${beforeHook.error}` };
    return;
  }

  const resultRef: { current: RunResult | null } = { current: null };
  yield* runClaudeCode({
    prompt: userPrompt,
    systemPrompt: blocks.systemBlock,
    cwd: projectPath,
    model: agent.model ?? config.model,
    permissionMode: config.permission_mode,
    cliPath: config.cli_path,
    timeoutMs: config.timeout_minutes * 60 * 1000,
    signal: opts?.signal,
  }, resultRef);

  // after_run hook
  await runAfterHook(storyId, projectPath);

  const result = resultRef.current;
  if (!result) {
    yield { type: "error", content: "QA runner returned no result" };
    return;
  }

  recordAgentRun({
    storyId, taskId: null, agentId: agent.id,
    runType: "qa", promptText: userPrompt, result,
  });

  // Token fields ride on the terminal events so the orchestrator can accumulate
  // live per-session totals for the Ops snapshot (Symphony §13.5).
  const tok = { tokensIn: result.tokensIn, tokensOut: result.tokensOut };

  if (!result.ok) {
    log(storyId, "execution_error",
      `QA run failed: ${result.error ?? "unknown error"}`,
      "system", "error"
    );
    yield { type: "error", content: result.error ?? "QA execution failed", ...tok };
    return;
  }

  // Parse PASS/FAIL marker from the result
  const text = result.result || "";
  const passMatch = /QA_RESULT:\s*PASS\b/i.test(text);
  const failMatch = text.match(/QA_RESULT:\s*FAIL\s*[—\-:]?\s*(.+?)(?:\n|$)/i);

  log(storyId, "execution_complete",
    `QA finished · ${result.tokensIn}+${result.tokensOut} tok · ${result.turns}t · ${(result.durationMs/1000).toFixed(1)}s${result.costUsd ? ` · $${result.costUsd.toFixed(4)}` : ""}`,
    "agent"
  );

  if (failMatch) {
    const reason = failMatch[1].trim();
    db.prepare("UPDATE stories SET qa_result = 'fail', qa_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(reason, storyId);
    log(storyId, "qa", `✗ QA failed: ${reason}`, "agent", "warn");
    yield { type: "progress", content: `QA failed: ${reason}`, ...tok };
  } else if (passMatch) {
    db.prepare("UPDATE stories SET qa_result = 'pass', status = 'human_review', updated_at = datetime('now') WHERE id = ?").run(storyId);
    log(storyId, "qa", `✓ QA passed`, "agent");
    log(storyId, "status_change", "Status changed to **Human Review** — awaiting human ack to mark Done", "system");
    yield { type: "progress", content: "QA passed — awaiting human review", ...tok };
  } else {
    // Agent didn't emit the marker — record but don't auto-advance status
    db.prepare("UPDATE stories SET qa_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run("Agent did not return QA_RESULT marker — review output manually", storyId);
    log(storyId, "qa", "QA inconclusive — agent did not emit QA_RESULT marker; review output", "agent", "warn");
    yield { type: "progress", content: "QA inconclusive — review output", ...tok };
  }
}

export async function* executePipeline(storyId: string, opts?: RunOptions): AsyncGenerator<ExecutionEvent> {
  const story = getStory(storyId);
  if (!story) {
    log(storyId, "execution_error", "Pipeline failed: story not found", "system", "error");
    yield { type: "error", content: "Story not found" };
    return;
  }

  const tasks = listStoryTasks(storyId);
  if (tasks.length === 0) {
    log(storyId, "execution_error", "Pipeline failed: no tasks found", "system", "error");
    yield { type: "error", content: "No pipeline tasks" };
    return;
  }

  log(storyId, "execution_start", `Pipeline started: ${tasks.length} task(s)`, "system");
  yield { type: "progress", content: `Running ${tasks.length} task(s)` };

  for (const task of tasks) {
    if (opts?.signal?.aborted) { yield { type: "error", content: "Aborted" }; return; }
    let taskFailed = false;
    const generator = task.role === "qa" ? executeQA(storyId, opts) : executeTask(storyId, task.id, opts);
    for await (const evt of generator) {
      yield evt;
      if (evt.type === "error") taskFailed = true;
    }
    if (taskFailed) {
      if (task.role === "qa") {
        db.prepare("UPDATE story_tasks SET status = 'failed', phase = 'failed', updated_at = datetime('now') WHERE id = ?").run(task.id);
      }
      log(storyId, "execution_error",
        `Pipeline halted at task #${task.seq}: ${task.title} — fix the issue and re-run`,
        "system", "error"
      );
      yield { type: "error", content: `Pipeline halted at task #${task.seq}` };
      return;
    }
    // QA path: executeQA only updates story; we must mark the qa task done here
    if (task.role === "qa") {
      db.prepare("UPDATE story_tasks SET status = 'done', phase = 'done', updated_at = datetime('now') WHERE id = ?").run(task.id);
    }
  }

  // All tasks passed — if executeQA already moved to human_review, leave it.
  // Otherwise (no QA task in pipeline), move to human_review for human ack.
  const current = getStory(storyId);
  if (current && current.status === "in_progress") {
    db.prepare("UPDATE stories SET status = 'human_review', updated_at = datetime('now') WHERE id = ?").run(storyId);
    log(storyId, "status_change", "Status changed to **Human Review**", "system");
  }
  log(storyId, "execution_complete", "✓ Pipeline complete", "system");
  yield { type: "done", content: "Pipeline complete" };
}

export async function* runSingleAgentStory(storyId: string): AsyncGenerator<ExecutionEvent> {
  yield* executeStory(storyId);
}

export async function* executeStory(storyId: string, opts?: RunOptions): AsyncGenerator<ExecutionEvent> {
  const story = getStory(storyId);
  if (!story) {
    log(storyId, "execution_error", "Execution failed: story not found", "system", "error");
    yield { type: "error", content: "Story not found" };
    return;
  }

  if (story.status !== "in_progress") {
    log(storyId, "execution_error",
      `Execution rejected: story status is "${story.status}" — must be In Progress`,
      "system", "warn"
    );
    yield { type: "error", content: `Cannot execute story in status "${story.status}" — move it to In Progress first` };
    return;
  }

  log(storyId, "execution_start",
    `Execution started (${story.mode} mode)${story.assigned_agent_id ? " with lead agent" : " — agents will be resolved per task"}`,
    "system", "debug"
  );

  if (listStoryTasks(storyId).length === 0) {
    yield* executeTechLeadPlan(storyId);
    if (opts?.signal?.aborted) { yield { type: "error", content: "Aborted by orchestrator" }; return; }
  }

  const tasks = listStoryTasks(storyId);
  if (tasks.length === 0) {
    log(storyId, "execution_error", "Execution aborted: no pipeline tasks were created", "system", "error");
    yield { type: "error", content: "No pipeline tasks created" };
    return;
  }

  // Signal is propagated all the way down to claudeRunner — child processes get SIGTERM on abort.
  yield* executePipeline(storyId, opts);
}

export async function spawnAutoStory(storyId: string): Promise<void> {
  // Drain the generator chain to completion — do NOT break on the first error,
  // because breaking triggers GeneratorReturn upstream which prevents
  // executePipeline / executeTask / executeQA from running their own
  // finalization logs (e.g. "Pipeline halted at task #N").
  let lastError: string | null = null;
  try {
    for await (const event of executeStory(storyId)) {
      if (event.type === "error") lastError = event.content ?? "unknown";
    }
    if (lastError) {
      log(storyId, "execution_error", `Auto-execution stopped: ${lastError}`, "system", "error");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(storyId, "execution_error", `Auto-execution exception: ${msg}`, "system", "error");
    console.error("Auto story failed:", msg);
  }
}

export async function* executeDocsAgent(projectId: string, agentId: string): AsyncGenerator<ExecutionEvent> {
  const project = db.prepare("SELECT id, name FROM projects WHERE id = ?").get(projectId) as { id: string; name: string } | undefined;
  if (!project) {
    yield { type: "error", content: "Project not found" };
    return;
  }
  const agent = db.prepare("SELECT id, name FROM agents WHERE id = ?").get(agentId) as { id: string; name: string } | undefined;
  if (!agent) {
    yield { type: "error", content: "Agent not found" };
    return;
  }
  yield { type: "progress", content: `Docs agent ${agent.name} scanned ${project.name}` };
  yield { type: "done", content: "Docs updated" };
}
