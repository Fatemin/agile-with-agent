import { CheckCircle2, ClipboardCheck, GitBranch, ListTodo, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import type { StoryStatus } from "@/types";

/**
 * Single source of truth for how a story status looks across the app
 * (Dashboard, board, cards, Agents). Add a status here, not in each page.
 */
export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  color: string;   // hex, for the board column header / dots
  badge: string;   // Tailwind classes for an inline chip
  dot: string;     // Tailwind bg- class for a small status dot
}

export const STORY_STATUS: Record<StoryStatus, StatusMeta> = {
  backlog:       { label: "Backlog",       icon: ListTodo,       color: "#71717A", badge: "bg-surface-tertiary text-content-tertiary",             dot: "bg-zinc-400" },
  todo:          { label: "Todo",          icon: ListTodo,       color: "#71717A", badge: "bg-surface-tertiary text-content-secondary",            dot: "bg-zinc-400" },
  design_review: { label: "Design Review", icon: ClipboardCheck, color: "#8B5CF6", badge: "bg-violet-50 text-violet-700 border border-violet-200", dot: "bg-violet-500" },
  in_progress:   { label: "In Progress",   icon: GitBranch,      color: "#0891B2", badge: "bg-cyan-50 text-cyan-700 border border-cyan-200",       dot: "bg-cyan-500" },
  human_review:  { label: "Human Review",  icon: ShieldCheck,    color: "#F59E0B", badge: "bg-amber-50 text-amber-700 border border-amber-200",    dot: "bg-amber-500" },
  done:          { label: "Done",          icon: CheckCircle2,   color: "#22C55E", badge: "bg-green-50 text-green-700 border border-green-200",    dot: "bg-green-500" },
  cancelled:     { label: "Cancelled",     icon: XCircle,        color: "#EF4444", badge: "bg-red-50 text-red-700 border border-red-200",          dot: "bg-red-500" },
};

export function statusMeta(status: StoryStatus): StatusMeta {
  return STORY_STATUS[status] ?? STORY_STATUS.backlog;
}

/** A story is "actively running" (agent working) — used for the live pulse. */
export const ACTIVE_STORY_STATUSES: StoryStatus[] = ["in_progress"];

/** Statuses that need a human to act (gates) — used for the "Awaiting you" queue. */
export const AWAITING_HUMAN_STATUSES: StoryStatus[] = ["design_review", "human_review"];
