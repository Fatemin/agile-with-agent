/**
 * Planner — parse the machine-readable task graph an agent emits during the
 * design phase (CONTEXT.md §8).
 *
 * The design agent outputs a prose plan (human-reviewed, stored in stories.design)
 * followed by ONE fenced ```json block with the task graph. This module turns
 * that block into a normalized, validated set of tasks with real scope_paths and
 * depends_on edges. If parsing fails, the caller falls back to the heuristic
 * planner (inferTasks), so an offline / CLI-less run still produces tasks.
 */

const VALID_ROLES = new Set([
  "frontend", "backend", "fullstack", "qa", "devops", "techlead", "security", "custom",
]);

export interface PlanTask {
  seq: number;
  role: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  scope_paths: string[];
  depends_on: number[];
}

export interface TaskPlan {
  goal: string | null;
  tasks: PlanTask[];
}

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function asStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, maxLen)).slice(0, maxItems);
}

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

/** A title that's just the template placeholder (angle brackets / ellipsis) → skip. */
function isPlaceholderTitle(title: string): boolean {
  return /[<>]/.test(title) || /^[.…\s]+$/.test(title);
}

function normalizePlan(o: Record<string, unknown>): TaskPlan | null {
  const rawTasks = Array.isArray(o.tasks) ? (o.tasks as unknown[]) : [];

  const cleaned = rawTasks
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t, i) => ({
      origSeq: typeof t.seq === "number" ? t.seq : i + 1,
      role: VALID_ROLES.has(String(t.role)) ? String(t.role) : "fullstack",
      title: asString(t.title, 200).trim(),
      description: asString(t.description, 4000),
      acceptance_criteria: asString(t.acceptance_criteria, 4000),
      scope_paths: asStringArray(t.scope_paths, 40, 200),
      depends_on: asNumberArray(t.depends_on),
    }))
    .filter((t) => t.title && !isPlaceholderTitle(t.title));

  if (cleaned.length === 0) return null;

  // Sort by the agent's seq, then reassign contiguous 1..N and remap depends_on
  // through the old→new map, dropping edges that don't point to an earlier task.
  cleaned.sort((a, b) => a.origSeq - b.origSeq);
  const seqMap = new Map<number, number>();
  cleaned.forEach((t, i) => seqMap.set(t.origSeq, i + 1));

  const tasks: PlanTask[] = cleaned.map((t, i) => ({
    seq: i + 1,
    role: t.role,
    title: t.title,
    description: t.description,
    acceptance_criteria: t.acceptance_criteria,
    scope_paths: t.scope_paths,
    depends_on: t.depends_on
      .map((d) => seqMap.get(d))
      .filter((d): d is number => typeof d === "number" && d < i + 1),
  }));

  const goal = typeof o.goal === "string" ? o.goal.trim().slice(0, 400) : null;
  return { goal, tasks };
}

function tryParseObjectWithTasks(s: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(s) as unknown;
    if (o && typeof o === "object" && Array.isArray((o as Record<string, unknown>).tasks)) {
      return o as Record<string, unknown>;
    }
  } catch { /* fall through to substring extraction */ }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(s.slice(start, end + 1)) as unknown;
      if (o && typeof o === "object" && Array.isArray((o as Record<string, unknown>).tasks)) {
        return o as Record<string, unknown>;
      }
    } catch { /* give up */ }
  }
  return null;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

/** Parse the agent's task graph out of its design output, or null. */
export function parseTaskPlan(text: string | null | undefined): TaskPlan | null {
  if (!text) return null;
  const candidates: string[] = [];
  for (const m of text.matchAll(FENCE_RE)) candidates.push(m[1].trim());
  candidates.push(text.trim()); // last resort: the whole thing
  for (const cand of candidates) {
    const obj = tryParseObjectWithTasks(cand);
    if (obj) {
      const plan = normalizePlan(obj);
      if (plan) return plan;
    }
  }
  return null;
}

/** Drop the machine-readable task-plan block so the stored design reads cleanly. */
export function stripTaskPlanJson(text: string): string {
  return text
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, inner: string) =>
      /"tasks"\s*:/.test(inner) ? "" : full,
    )
    .trim();
}
