import { db } from "./db.js";

/**
 * Relevance-based context retrieval (CONTEXT.md §9, Phase 5).
 *
 * Replaces the old static three-layer rules (story type / agent role / keyword)
 * with FTS5 bm25 ranking: given a task's query text, rank the project's context
 * sections by relevance. Falls back to all populated sections (in their
 * configured order) when there's no term overlap or FTS is unavailable, so the
 * budget step downstream still has something to trim.
 */

const STOPWORDS = new Set(
  "the a an and or of to in on for with is are be this that it as by at from into your you we our will should can".split(" "),
);

function queryTerms(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 40) break;
  }
  return out;
}

/** Section keys for a project, ranked most-relevant-first for the given query. */
export function rankContextSections(projectId: string, query: string): string[] {
  const terms = queryTerms(query);
  if (terms.length > 0) {
    try {
      const match = terms.map((t) => `"${t}"`).join(" OR ");
      const rows = db.prepare(
        `SELECT section FROM context_fts
         WHERE project_id = ? AND context_fts MATCH ?
         ORDER BY bm25(context_fts)`,
      ).all(projectId, match) as Array<{ section: string }>;
      if (rows.length > 0) return rows.map((r) => r.section);
    } catch {
      /* FTS unavailable or bad query — fall back below */
    }
  }
  const rows = db.prepare(
    `SELECT section FROM project_contexts
     WHERE project_id = ? AND content IS NOT NULL AND trim(content) != ''
     ORDER BY sort_order ASC`,
  ).all(projectId) as Array<{ section: string }>;
  return rows.map((r) => r.section);
}
