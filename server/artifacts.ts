import { nanoid } from "nanoid";
import { db } from "./db.js";

/**
 * Artifact manifest (CONTEXT.md §5.3, §9).
 *
 * The artifact's content lives in the git worktree; this module keeps an index
 * (path + kind + one-line summary) so a task prompt can offer relevant files
 * without inlining their contents — the agent reads what it needs on demand.
 *
 * Artifacts are registered from two sources after a task runs:
 *   - the files git says the task changed (kind inferred from the path), and
 *   - optional `ARTIFACT:` markers in the agent's output (which override kind/summary).
 */

export interface ParsedArtifact {
  kind: string;
  path: string;
  summary: string | null;
}

// `ARTIFACT: <kind> <path> — <summary>` (summary optional), one per line.
const ARTIFACT_RE = /^\s*ARTIFACT:\s*(\w+)\s+(\S+)\s*(?:[—–-]\s*(.+))?$/gim;

const NOISE_RE = /(^|\/)(node_modules|\.git|dist|build|coverage)\//;

/** Infer an artifact kind from a file path. */
export function inferKind(path: string): string {
  const p = path.toLowerCase();
  if (/\.sql$|(^|\/)migrations?\//.test(p)) return "schema";
  if (/\.(test|spec)\.[a-z0-9]+$|(^|\/)(tests?|__tests__)\//.test(p)) return "test";
  if (/\.(md|mdx|txt|rst)$/.test(p)) return "doc";
  if (/(^|\/)(routes?|api|controllers?)\//.test(p)) return "api";
  return "code";
}

/** Parse `ARTIFACT:` marker lines out of agent output. */
export function parseArtifactMarkers(text: string | null | undefined): ParsedArtifact[] {
  if (!text) return [];
  const out: ParsedArtifact[] = [];
  for (const m of text.matchAll(ARTIFACT_RE)) {
    const kind = m[1].trim().toLowerCase();
    const path = m[2].trim();
    if (!path || /[<>]/.test(path)) continue; // skip the template placeholder
    out.push({ kind: kind.slice(0, 20), path: path.slice(0, 300), summary: m[3]?.trim().slice(0, 300) ?? null });
  }
  return out;
}

/**
 * Upsert artifacts for a task (keyed on story_id + path). Git-changed files are
 * registered with an inferred kind; markers override kind/summary and may add
 * paths git didn't surface. Returns the number of paths registered.
 */
export function registerArtifacts(opts: {
  projectId: string;
  storyId: string;
  taskId: string | null;
  fromGit?: string[];
  markers?: ParsedArtifact[];
}): number {
  // Merge sources into one map keyed by path; markers win on kind/summary.
  const byPath = new Map<string, { kind: string; summary: string | null }>();
  for (const path of opts.fromGit ?? []) {
    if (NOISE_RE.test(path)) continue;
    byPath.set(path, { kind: inferKind(path), summary: null });
  }
  for (const m of opts.markers ?? []) {
    if (NOISE_RE.test(m.path)) continue;
    const existing = byPath.get(m.path);
    byPath.set(m.path, { kind: m.kind || existing?.kind || inferKind(m.path), summary: m.summary ?? existing?.summary ?? null });
  }

  const upsert = db.prepare(`
    INSERT INTO artifacts (id, project_id, story_id, task_id, path, kind, summary, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(story_id, path) DO UPDATE SET
      kind = excluded.kind,
      summary = COALESCE(excluded.summary, artifacts.summary),
      task_id = excluded.task_id,
      status = 'active',
      updated_at = excluded.updated_at
  `);
  for (const [path, { kind, summary }] of byPath) {
    upsert.run(nanoid(), opts.projectId, opts.storyId, opts.taskId, path, kind, summary);
  }
  return byPath.size;
}

const MAX_ARTIFACTS_SHOWN = 20;

/** Strip glob/regex chars so a scope entry can be matched against a path. */
function normalizeScope(s: string): string {
  return s.replace(/[*?{}[\]]/g, "").replace(/\/+$/, "").trim().toLowerCase();
}

/**
 * Compact "## Artifacts" manifest for a task prompt, or null if none. When
 * scopePaths are given, files intersecting the task's scope are listed first.
 */
export function renderArtifactManifest(storyId: string, scopePaths?: string[]): string | null {
  const rows = db.prepare(
    "SELECT path, kind, summary FROM artifacts WHERE story_id = ? AND status = 'active' ORDER BY updated_at DESC",
  ).all(storyId) as Array<{ path: string; kind: string; summary: string | null }>;
  if (rows.length === 0) return null;

  const scopes = (scopePaths ?? []).map(normalizeScope).filter(Boolean);
  const inScope = (p: string): boolean => {
    const lp = p.toLowerCase();
    return scopes.some((s) => lp.includes(s) || s.includes(lp));
  };

  const ranked = scopes.length > 0
    ? [...rows].sort((a, b) => Number(inScope(b.path)) - Number(inScope(a.path)))
    : rows;
  const shown = ranked.slice(0, MAX_ARTIFACTS_SHOWN);
  const overflow = ranked.length - shown.length;

  const items = shown.map((r) => `- \`${r.path}\` [${r.kind}]${r.summary ? ` — ${r.summary}` : ""}`);
  if (overflow > 0) items.push(`- _(+${overflow} more)_`);
  return `## Artifacts (files this story has touched — read what you need)\n\n${items.join("\n")}`;
}
