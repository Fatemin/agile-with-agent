import { nanoid } from "nanoid";
import { db } from "./db.js";

/**
 * Decision log — compressed, append-only technical decisions (CONTEXT.md §5.2, §7).
 *
 * Agents emit decisions with a `DECISION:` marker (the same convention as the
 * QA `QA_RESULT:` marker). Each is stored once and injected into later prompts
 * as a compact one-line reference ("#15 [Authentication] Use JWT — stateless"),
 * so the reasoning that produced a decision is never re-sent in full.
 */

export interface ParsedDecision {
  topic: string;
  decision: string;
  rationale: string | null;
}

// `DECISION: [<topic>] <decision> — <rationale>` — one per line.
const DECISION_RE = /^\s*DECISION:\s*\[([^\]]{1,80})\]\s*(.+?)\s*$/gim;
// Split decision from rationale on the first " — " / " – " / " - ".
const SPLIT_RE = /\s+[—–-]\s+/;

/** Parse `DECISION:` marker lines out of agent output. */
export function parseDecisionMarkers(text: string | null | undefined): ParsedDecision[] {
  if (!text) return [];
  const out: ParsedDecision[] = [];
  for (const m of text.matchAll(DECISION_RE)) {
    const topic = m[1].trim();
    const body = m[2].trim();
    // Skip the instruction template itself if an agent echoes it verbatim.
    if (/<decision>|<why>|<rationale>/i.test(body) || /^topic$/i.test(topic)) continue;

    let decision = body;
    let rationale: string | null = null;
    const parts = body.split(SPLIT_RE);
    if (parts.length >= 2) {
      decision = parts[0].trim();
      rationale = parts.slice(1).join(" — ").trim() || null;
    }
    if (decision) {
      out.push({ topic: topic.slice(0, 80), decision: decision.slice(0, 200), rationale: rationale?.slice(0, 300) ?? null });
    }
  }
  return out;
}

/**
 * Persist parsed decisions. A new decision on a topic that already has an
 * active decision in the same project supersedes it. Returns the assigned
 * per-project seq numbers (the human-facing "#15" references).
 */
export function recordDecisions(opts: {
  projectId: string;
  storyId: string | null;
  decisions: ParsedDecision[];
  createdBy?: string;
}): number[] {
  const seqs: number[] = [];
  for (const d of opts.decisions) {
    const prior = db.prepare(
      "SELECT id FROM decisions WHERE project_id = ? AND status = 'active' AND lower(topic) = lower(?)",
    ).all(opts.projectId, d.topic) as Array<{ id: string }>;

    const { next } = db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM decisions WHERE project_id = ?",
    ).get(opts.projectId) as { next: number };

    const id = nanoid();
    db.prepare(`
      INSERT INTO decisions (id, project_id, story_id, seq, topic, decision, rationale, status, supersedes_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id, opts.projectId, opts.storyId, next, d.topic, d.decision, d.rationale,
      prior[0]?.id ?? null, opts.createdBy ?? "agent",
    );
    for (const p of prior) {
      db.prepare("UPDATE decisions SET status = 'superseded' WHERE id = ?").run(p.id);
    }
    seqs.push(next);
  }
  return seqs;
}

const MAX_DECISIONS_SHOWN = 15;

/**
 * Compact "## Decisions" block for a task prompt, or null if there are none.
 * Shows active decisions scoped to this story plus project-level ones.
 */
export function renderDecisionsBlock(storyId: string): string | null {
  const story = db.prepare("SELECT project_id FROM stories WHERE id = ?").get(storyId) as
    { project_id: string } | undefined;
  if (!story) return null;

  const rows = db.prepare(`
    SELECT seq, topic, decision, rationale FROM decisions
    WHERE project_id = ? AND status = 'active' AND (story_id = ? OR story_id IS NULL)
    ORDER BY seq ASC
  `).all(story.project_id, storyId) as Array<{ seq: number; topic: string; decision: string; rationale: string | null }>;
  if (rows.length === 0) return null;

  const shown = rows.slice(-MAX_DECISIONS_SHOWN);
  const overflow = rows.length - shown.length;
  const items = shown.map((r) => `- #${r.seq} [${r.topic}] ${r.decision}${r.rationale ? ` — ${r.rationale}` : ""}`);
  if (overflow > 0) items.unshift(`- _(+${overflow} earlier decision${overflow > 1 ? "s" : ""})_`);
  return `## Decisions (already made — follow these)\n\n${items.join("\n")}`;
}

export interface DecisionRow {
  id: string;
  seq: number;
  topic: string;
  decision: string;
  rationale: string | null;
  status: string;
  created_at: string;
}

/** All decisions for a story (active + superseded), for display (CONTEXT.md §15). */
export function listDecisions(storyId: string): DecisionRow[] {
  const story = db.prepare("SELECT project_id FROM stories WHERE id = ?").get(storyId) as
    { project_id: string } | undefined;
  if (!story) return [];
  return db.prepare(`
    SELECT id, seq, topic, decision, rationale, status, created_at FROM decisions
    WHERE project_id = ? AND (story_id = ? OR story_id IS NULL)
    ORDER BY seq ASC
  `).all(story.project_id, storyId) as unknown as DecisionRow[];
}
