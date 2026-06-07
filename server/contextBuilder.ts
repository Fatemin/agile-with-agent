import { db } from "./db.js";
import { renderSnapshotBlock } from "./snapshot.js";
import { renderDecisionsBlock } from "./decisions.js";
import { renderArtifactManifest } from "./artifacts.js";
import { rankContextSections } from "./retrieval.js";
import { getAgentRuntimeConfig } from "./runtimeConfig.js";

type StoryType = "story" | "bug" | "task" | "spike";
type AgentRole = "frontend" | "backend" | "fullstack" | "qa" | "devops" | "techlead" | "security" | "custom";

// ─── Task prompt blocks (multi-agent pipeline) ───────────────────────────────

export function buildTaskPromptBlocks(params: {
  storyId: string;
  taskTitle: string;
  taskDescription: string | null;
  agentSystemPrompt: string;
  agentRole: AgentRole | null;
  /** "implement" (default) appends build+commit instructions; "design" is read-only. */
  instructions?: "implement" | "design";
  /** The task's scope_paths — used to rank the artifact manifest (CONTEXT.md §6). */
  scopePaths?: string[];
}): {
  systemBlock: string;
  contextBlock: string | null;
  storyBlock: string;
  includedSections: string[];
  droppedForBudget: string[];
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

  // Relevance-ranked section selection (CONTEXT.md §9, Phase 5) — replaces the
  // old static story-type/role/keyword rules. The budget step below then trims
  // from the least-relevant end.
  const query = [
    story.title, story.description, story.acceptance_criteria,
    params.taskTitle, params.taskDescription, (params.scopePaths ?? []).join(" "),
  ].filter(Boolean).join(" ");
  const rankedKeys = rankContextSections(story.project_id, query);

  type Ctx = { section: string; title: string; content: string | null };
  let populated: Ctx[] = [];
  if (rankedKeys.length > 0) {
    const rows = db.prepare(`
      SELECT section, title, content FROM project_contexts
      WHERE project_id = ? AND section IN (${rankedKeys.map(() => "?").join(",")})
    `).all(story.project_id, ...rankedKeys) as Ctx[];
    const bySection = new Map(rows.map((r) => [r.section, r]));
    populated = rankedKeys
      .map((k) => bySection.get(k))
      .filter((c): c is Ctx => !!c && !!c.content?.trim());
  }

  // ── Story block (bounded: story, snapshot, decisions, artifacts, task) ────────
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

  // Working-memory snapshot (CONTEXT.md §6.2) — compact, bounded state that
  // replaces concatenating every prior task's full impl_summary into the prompt.
  const snapshot = renderSnapshotBlock(params.storyId);
  if (snapshot) parts.push(snapshot);

  // Compressed decision log (CONTEXT.md §6.2 item 4) — one line per active
  // decision, so the reasoning behind each is never re-sent in full.
  const decisions = renderDecisionsBlock(params.storyId);
  if (decisions) parts.push(decisions);

  // Artifact manifest (CONTEXT.md §6.2 item 5) — pointers (path + summary),
  // ranked by the task's scope; the agent reads the files it needs itself.
  const artifacts = renderArtifactManifest(params.storyId, params.scopePaths);
  if (artifacts) parts.push(artifacts);

  // Task-specific instructions
  parts.push(`## Your Task\n\n**${params.taskTitle}**`);
  if (params.taskDescription) parts.push(params.taskDescription);

  const branch  = story.branch_name ?? "(current branch)";
  const workDir = story.local_path ?? ".";

  if ((params.instructions ?? "implement") === "design") {
    parts.push(`## Instructions\n\nWorking **read-only** in \`${workDir}\` on branch \`${branch}\`. Explore the code and produce the implementation plan in the format above. Do NOT modify files, run git, or write code in this phase.`);
  } else {
    parts.push(`## Instructions\n\nWorking in \`${workDir}\` on branch \`${branch}\`.\n\nImplement the changes. Follow existing conventions. Write tests where applicable. If you make a notable technical decision future tasks must respect, record it on its own line as \`DECISION: [topic] what you decided — why\`. Commit when done: \`git commit -m "${story.key}: ${params.taskTitle}"\``);
  }

  const storyBlock = parts.join("\n\n");

  // ── Project context under a token budget (CONTEXT.md §6.3) ────────────────────
  // The story block above is already bounded; project-context sections are the
  // unbounded part, so they're the ones the budget trims. Greedily include whole
  // sections that fit (lowest priority — dropped first when over budget).
  const estTok = (s: string) => Math.ceil(s.length / 4);
  const budget = getAgentRuntimeConfig().context_token_budget;
  const reserve = estTok(params.agentSystemPrompt) + estTok(storyBlock);
  const ctxBudget = Math.max(budget - reserve, 400);

  const includedSections: string[] = [];
  const droppedForBudget: string[] = [];
  const chosen: string[] = [];
  let used = 0;
  for (const c of populated) {
    const block = `### ${c.title}\n\n${c.content!.trim()}`;
    const t = estTok(block);
    if (used + t <= ctxBudget) {
      chosen.push(block); includedSections.push(c.section); used += t;
    } else {
      droppedForBudget.push(c.section);
    }
  }
  // If the budget shut everything out, include the first section truncated so
  // some project context still reaches the agent.
  if (chosen.length === 0 && populated.length > 0) {
    const c = populated[0];
    const block = `### ${c.title}\n\n${c.content!.trim()}`;
    chosen.push(block.slice(0, ctxBudget * 4).trimEnd() + "\n\n_(truncated to fit the context budget)_");
    includedSections.push(c.section);
    droppedForBudget.splice(droppedForBudget.indexOf(c.section), 1);
  }
  const contextBlock = chosen.length > 0 ? "## Project Context\n\n" + chosen.join("\n\n") : null;

  const total = params.agentSystemPrompt.length + (contextBlock?.length ?? 0) + storyBlock.length;

  return {
    systemBlock: params.agentSystemPrompt.trim(),
    contextBlock,
    storyBlock,
    includedSections,
    droppedForBudget,
    estimatedTokens: Math.ceil(total / 4),
  };
}
