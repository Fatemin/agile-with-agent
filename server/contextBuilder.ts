import { db } from "./db.js";

type StoryType = "story" | "bug" | "task" | "spike";
type AgentRole = "frontend" | "backend" | "fullstack" | "qa" | "devops" | "techlead" | "security" | "custom";

interface KeywordRule {
  keywords: string[];
  sections: string[];
}

// ─── Defaults (mirrors Settings page defaults) ────────────────────────────────

const DEFAULT_STORY_RULES: Record<StoryType, string[]> = {
  story: ["overview", "prd", "design_system", "conventions"],
  bug:   ["overview", "data_model", "conventions"],
  task:  ["overview", "architecture", "conventions"],
  spike: ["overview", "architecture", "data_model", "conventions"],
};

const DEFAULT_ROLE_RULES: Record<string, string[]> = {
  frontend:  ["overview", "design_system", "conventions"],
  backend:   ["overview", "architecture", "data_model", "conventions"],
  fullstack: ["overview", "architecture", "data_model", "design_system", "conventions"],
  qa:        ["overview", "prd", "conventions"],
  devops:    ["overview", "architecture", "conventions"],
  techlead:  ["overview", "prd", "architecture", "data_model", "conventions"],
  security:  ["overview", "architecture", "data_model", "conventions"],
  custom:    ["overview", "conventions"],
};

const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
  { keywords: ["api", "endpoint", "rest", "graphql", "route"],             sections: ["architecture"] },
  { keywords: ["database", "schema", "migration", "model", "sql"],         sections: ["data_model"] },
  { keywords: ["ui", "component", "style", "css", "layout", "design"],     sections: ["design_system"] },
  { keywords: ["auth", "login", "permission", "role", "token", "jwt"],     sections: ["architecture", "data_model"] },
  { keywords: ["test", "spec", "unit", "e2e", "qa"],                       sections: ["conventions"] },
  { keywords: ["deploy", "ci", "cd", "pipeline", "docker"],                sections: ["architecture"] },
];

// ─── Load settings ────────────────────────────────────────────────────────────

function loadSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

// ─── Section selection — three-layer union ────────────────────────────────────

export function selectContextSections(params: {
  storyType: StoryType;
  agentRole: AgentRole | null;
  titleAndDescription: string;
}): string[] {
  const storyRules = loadSetting<Record<string, string[]>>("execution_context_rules", DEFAULT_STORY_RULES);
  const roleRules  = loadSetting<Record<string, string[]>>("agent_role_context_rules", DEFAULT_ROLE_RULES);
  const kwRules    = loadSetting<KeywordRule[]>("keyword_context_rules", DEFAULT_KEYWORD_RULES);

  const selected = new Set<string>();

  // Layer 1 — story type
  for (const s of storyRules[params.storyType] ?? DEFAULT_STORY_RULES[params.storyType] ?? []) {
    selected.add(s);
  }

  // Layer 2 — agent role
  if (params.agentRole) {
    for (const s of roleRules[params.agentRole] ?? DEFAULT_ROLE_RULES[params.agentRole] ?? []) {
      selected.add(s);
    }
  }

  // Layer 3 — keyword matching
  const text = params.titleAndDescription.toLowerCase();
  for (const rule of kwRules) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      for (const s of rule.sections) selected.add(s);
    }
  }

  return Array.from(selected);
}

// ─── Build full execution prompt ──────────────────────────────────────────────

export function buildExecutionPrompt(params: {
  storyId: string;
  agentSystemPrompt: string;
  agentRole: AgentRole | null;
}): { prompt: string; includedSections: string[]; estimatedTokens: number } {
  const story = db.prepare(`
    SELECT s.*, p.local_path, p.name AS project_name
    FROM stories s
    JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(params.storyId) as {
    key: string; title: string; type: StoryType;
    as_a: string | null; i_want: string | null; so_that: string | null;
    description: string | null; acceptance_criteria: string | null;
    branch_name: string | null; project_id: string;
    local_path: string | null; project_name: string;
  } | undefined;

  if (!story) throw new Error(`Story ${params.storyId} not found`);

  const titleDesc = `${story.title} ${story.description ?? ""}`;

  const sectionKeys = selectContextSections({
    storyType: story.type,
    agentRole: params.agentRole,
    titleAndDescription: titleDesc,
  });

  // Fetch only populated sections in the selected set
  const contexts = sectionKeys.length > 0
    ? db.prepare(`
        SELECT section, title, content
        FROM project_contexts
        WHERE project_id = ? AND section IN (${sectionKeys.map(() => "?").join(",")})
        ORDER BY sort_order ASC
      `).all(story.project_id, ...sectionKeys) as Array<{ section: string; title: string; content: string | null }>
    : [];

  const populated = contexts.filter((c) => c.content?.trim());
  const includedSections = populated.map((c) => c.section);

  // ── Assemble prompt ──────────────────────────────────────────────────────────
  const parts: string[] = [];

  // System role (to be marked cache_control: ephemeral by the caller)
  parts.push(params.agentSystemPrompt.trim());

  // Project context (to be marked cache_control: ephemeral by the caller)
  if (populated.length > 0) {
    parts.push("## Project Context\n");
    for (const ctx of populated) {
      parts.push(`### ${ctx.title}\n\n${ctx.content!.trim()}`);
    }
  }

  // Story — not cached (changes every call)
  parts.push("## Your Task\n");
  parts.push(`**${story.key}** — ${story.title}`);

  if (story.as_a || story.i_want || story.so_that) {
    parts.push([
      story.as_a    ? `**As a** ${story.as_a}` : null,
      story.i_want  ? `**I want** ${story.i_want}` : null,
      story.so_that ? `**So that** ${story.so_that}` : null,
    ].filter(Boolean).join("\n"));
  }

  if (story.description?.trim()) {
    parts.push(`### Description\n\n${story.description.trim()}`);
  }

  if (story.acceptance_criteria?.trim()) {
    parts.push(`### Acceptance Criteria\n\n${story.acceptance_criteria.trim()}`);
  }

  const workDir = story.local_path ?? ".";
  const branch  = story.branch_name ?? "(current branch)";

  parts.push(`## Instructions

You are working in \`${workDir}\` on branch \`${branch}\`.

**Phase 1 — Design:** Explore the relevant files. Understand existing patterns. Note your implementation approach briefly.

**Phase 2 — Development:** Implement the acceptance criteria. Follow project conventions exactly. Do not introduce abstractions beyond what the story requires.

**Phase 3 — Testing:** Write unit tests that verify the acceptance criteria. Run them and confirm they pass.

**Phase 4 — Commit:** \`git add -A && git commit -m "${story.key}: <concise summary>"\`

Report: what you built, which files you changed, and test results.`);

  const prompt = parts.join("\n\n");

  // Rough token estimate (1 token ≈ 4 chars)
  const estimatedTokens = Math.ceil(prompt.length / 4);

  return { prompt, includedSections, estimatedTokens };
}

// ─── Task prompt blocks (multi-agent pipeline) ───────────────────────────────

export interface PriorTaskContext {
  seq: number;
  title: string;
  role: string;
  design_output: string | null;
  impl_summary: string | null;
}

export function buildTaskPromptBlocks(params: {
  storyId: string;
  taskTitle: string;
  taskDescription: string | null;
  agentSystemPrompt: string;
  agentRole: AgentRole | null;
  phase: "design" | "implement";
  designOutput?: string | null;
  priorTasks?: PriorTaskContext[];
}): {
  systemBlock: string;
  contextBlock: string | null;
  storyBlock: string;
  includedSections: string[];
  estimatedTokens: number;
} {
  const story = db.prepare(`
    SELECT s.*, p.local_path, p.name AS project_name
    FROM stories s
    JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(params.storyId) as {
    key: string; title: string; type: StoryType;
    as_a: string | null; i_want: string | null; so_that: string | null;
    description: string | null; acceptance_criteria: string | null;
    branch_name: string | null; project_id: string;
    local_path: string | null;
  } | undefined;

  if (!story) throw new Error(`Story ${params.storyId} not found`);

  const titleDesc = `${story.title} ${story.description ?? ""}`;
  const sectionKeys = selectContextSections({
    storyType: story.type,
    agentRole: params.agentRole,
    titleAndDescription: titleDesc,
  });

  const contexts = sectionKeys.length > 0
    ? db.prepare(`
        SELECT section, title, content FROM project_contexts
        WHERE project_id = ? AND section IN (${sectionKeys.map(() => "?").join(",")})
        ORDER BY sort_order ASC
      `).all(story.project_id, ...sectionKeys) as Array<{ section: string; title: string; content: string | null }>
    : [];

  const populated = contexts.filter((c) => c.content?.trim());
  const includedSections = populated.map((c) => c.section);

  const contextBlock = populated.length > 0
    ? "## Project Context\n\n" + populated.map((c) => `### ${c.title}\n\n${c.content!.trim()}`).join("\n\n")
    : null;

  // ── Story block ──────────────────────────────────────────────────────────────
  const parts: string[] = ["## Story\n"];
  parts.push(`**${story.key}** — ${story.title}`);
  if (story.as_a || story.i_want || story.so_that) {
    parts.push([
      story.as_a   ? `**As a** ${story.as_a}` : null,
      story.i_want ? `**I want** ${story.i_want}` : null,
      story.so_that? `**So that** ${story.so_that}` : null,
    ].filter(Boolean).join("\n"));
  }
  if (story.acceptance_criteria?.trim()) {
    parts.push(`### Acceptance Criteria\n\n${story.acceptance_criteria.trim()}`);
  }

  // Prior task context (handoff)
  if (params.priorTasks && params.priorTasks.length > 0) {
    const priorParts = ["## Prior Task Context\n\nThe following tasks have already completed. Use their outputs as context.\n"];
    for (const t of params.priorTasks) {
      priorParts.push(`### Task ${t.seq}: ${t.title} [${t.role}] — DONE`);
      if (t.design_output) priorParts.push(`**Design Spec:**\n${t.design_output}`);
      if (t.impl_summary)  priorParts.push(`**Implementation Summary:**\n${t.impl_summary}`);
    }
    parts.push(priorParts.join("\n\n"));
  }

  // Task-specific instructions
  parts.push(`## Your Task\n\n**${params.taskTitle}**`);
  if (params.taskDescription) parts.push(params.taskDescription);

  const branch  = story.branch_name ?? "(current branch)";
  const workDir = story.local_path ?? ".";

  if (params.phase === "design") {
    // Phase A — design output — submitted via Phase B design output
    if (params.designOutput) {
      parts.push(`## Your Design Spec (Phase A output)\n\n${params.designOutput}`);
      parts.push(`## Instructions\n\nWorking in \`${workDir}\` on branch \`${branch}\`.\n\nPhase B — Implementation: Implement the changes described in your design spec above. Use \`write_file\` to create or modify files. Follow project conventions.`);
    } else {
      parts.push(`## Instructions\n\nWorking in \`${workDir}\` on branch \`${branch}\`.\n\nPhase A — Design:\n1. Explore the project structure with \`list_directory\` and \`read_file\`\n2. Understand existing patterns and conventions\n3. Design your implementation: which files to create/modify, interfaces, approach\n4. Call \`submit_design\` with your complete design specification\n\nDo NOT use \`write_file\` in this phase.`);
    }
  } else {
    parts.push(`## Instructions\n\nWorking in \`${workDir}\` on branch \`${branch}\`.\n\nImplement the changes. Follow existing conventions. Write tests where applicable. Commit when done: \`git commit -m "${story.key}: ${params.taskTitle}"\``);
  }

  const storyBlock = parts.join("\n\n");
  const total = params.agentSystemPrompt.length + (contextBlock?.length ?? 0) + storyBlock.length;

  return {
    systemBlock: params.agentSystemPrompt.trim(),
    contextBlock,
    storyBlock,
    includedSections,
    estimatedTokens: Math.ceil(total / 4),
  };
}

// ─── Prompt structure for caching ─────────────────────────────────────────────
// For Anthropic SDK callers, the prompt can be split into cache-friendly blocks:
//
//   messages[0].content = [
//     { type: "text", text: systemPrompt,      cache_control: { type: "ephemeral" } },
//     { type: "text", text: projectContextPart, cache_control: { type: "ephemeral" } },
//     { type: "text", text: storyPart }         // no cache — changes every call
//   ]
//
// The caller should use buildPromptBlocks() below for structured access.

export function buildPromptBlocks(params: {
  storyId: string;
  agentSystemPrompt: string;
  agentRole: AgentRole | null;
}): {
  systemBlock: string;
  contextBlock: string | null;
  storyBlock: string;
  includedSections: string[];
  estimatedTokens: number;
} {
  const story = db.prepare(`
    SELECT s.*, p.local_path, p.name AS project_name
    FROM stories s
    JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(params.storyId) as {
    key: string; title: string; type: StoryType;
    as_a: string | null; i_want: string | null; so_that: string | null;
    description: string | null; acceptance_criteria: string | null;
    branch_name: string | null; project_id: string;
    local_path: string | null;
  } | undefined;

  if (!story) throw new Error(`Story ${params.storyId} not found`);

  const titleDesc = `${story.title} ${story.description ?? ""}`;
  const sectionKeys = selectContextSections({
    storyType: story.type,
    agentRole: params.agentRole,
    titleAndDescription: titleDesc,
  });

  const contexts = sectionKeys.length > 0
    ? db.prepare(`
        SELECT section, title, content FROM project_contexts
        WHERE project_id = ? AND section IN (${sectionKeys.map(() => "?").join(",")})
        ORDER BY sort_order ASC
      `).all(story.project_id, ...sectionKeys) as Array<{ section: string; title: string; content: string | null }>
    : [];

  const populated = contexts.filter((c) => c.content?.trim());
  const includedSections = populated.map((c) => c.section);

  const contextBlock = populated.length > 0
    ? "## Project Context\n\n" + populated.map((c) => `### ${c.title}\n\n${c.content!.trim()}`).join("\n\n")
    : null;

  const storyParts: string[] = ["## Your Task\n"];
  storyParts.push(`**${story.key}** — ${story.title}`);
  if (story.as_a || story.i_want || story.so_that) {
    storyParts.push([
      story.as_a    ? `**As a** ${story.as_a}` : null,
      story.i_want  ? `**I want** ${story.i_want}` : null,
      story.so_that ? `**So that** ${story.so_that}` : null,
    ].filter(Boolean).join("\n"));
  }
  if (story.description?.trim()) storyParts.push(`### Description\n\n${story.description.trim()}`);
  if (story.acceptance_criteria?.trim()) storyParts.push(`### Acceptance Criteria\n\n${story.acceptance_criteria.trim()}`);

  const branch  = story.branch_name ?? "(current branch)";
  const workDir = story.local_path ?? ".";
  storyParts.push(`## Instructions\n\nWorking in \`${workDir}\` on branch \`${branch}\`.\n\n**Phase 1 — Design** → **Phase 2 — Development** → **Phase 3 — Testing** → **Phase 4 — Commit** (\`git commit -m "${story.key}: <summary>"\`)`);

  const storyBlock = storyParts.join("\n\n");
  const total = params.agentSystemPrompt.length + (contextBlock?.length ?? 0) + storyBlock.length;

  return {
    systemBlock: params.agentSystemPrompt.trim(),
    contextBlock,
    storyBlock,
    includedSections,
    estimatedTokens: Math.ceil(total / 4),
  };
}
