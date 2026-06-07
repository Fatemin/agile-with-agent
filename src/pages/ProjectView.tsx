import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Bot, Bug, CalendarDays, CheckCircle2, ClipboardCheck,
  Copy, ExternalLink, FileText, FolderOpen, GitBranch,
  Layers, Lightbulb, ListTodo, MessageSquare, Network, Pencil, Play, Plus,
  Rocket, RotateCw, Save, ScanLine, Send, ShieldCheck, Sparkles,
  Trash2, UserCheck, Wrench, XCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { STORY_STATUS } from "@/lib/storyStatus";
import type {
  Agent, AgentRun, DefectSeverity, Epic, Priority,
  ProjectContext, Sprint, Story, StoryMode, StoryStatus, StoryType,
  StoryTask, TaskStatus, TaskType,
} from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#64748b", medium: "#71717A", high: "#F59E0B", urgent: "#EF4444",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};

const TYPE_ICONS: Record<StoryType, React.ElementType> = {
  story: ListTodo, bug: Bug, task: Wrench, spike: Lightbulb,
};

const TYPE_COLORS: Record<StoryType, string> = {
  story: "#06b6d4", bug: "#EF4444", task: "#8B5CF6", spike: "#F59E0B",
};

// Board columns are an ordered subset of statuses; all visual meta comes from
// the shared STORY_STATUS source so the board, cards, Dashboard and Agents agree.
const BOARD_COLUMN_ORDER: StoryStatus[] = ["todo", "design_review", "in_progress", "human_review", "done"];
const BOARD_COLUMNS = BOARD_COLUMN_ORDER.map((status) => ({ status, ...STORY_STATUS[status] }));

const STATUS_LABELS = Object.fromEntries(
  (Object.keys(STORY_STATUS) as StoryStatus[]).map((s) => [s, STORY_STATUS[s].label]),
) as Record<StoryStatus, string>;

// Statuses that represent "active" work (for the dispatch board / running indicator)
const ACTIVE_STATUSES: StoryStatus[] = ["in_progress"];

const CONTEXT_SECTION_META: Record<string, { label: string; placeholder: string }> = {
  overview:      { label: "Project Overview",       placeholder: "Describe what this project is, its goals, and target users..." },
  prd:           { label: "Product Requirements",   placeholder: "Features, user flows, acceptance criteria at the product level..." },
  design_system: { label: "Design System",          placeholder: "Colors, typography, component patterns, layout rules..." },
  data_model:    { label: "Data Model",             placeholder: "Database schema, entities, relationships..." },
  architecture:  { label: "Architecture & Tech Stack", placeholder: "System design, tech choices, infrastructure..." },
  conventions:   { label: "Coding Conventions",     placeholder: "Code style, patterns, file structure, naming rules..." },
  glossary:      { label: "Domain Glossary",        placeholder: "Key terms and definitions used in this project..." },
};

// ─── Acceptance Criteria Checklist ───────────────────────────────────────────

function parseAC(text: string): { text: string; done: boolean }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const done = /^\[x\]/i.test(l) || /^-\s*\[x\]/i.test(l);
      const clean = l.replace(/^-?\s*\[[ x]\]\s*/i, "").trim();
      return { text: clean, done };
    });
}

function serializeAC(items: { text: string; done: boolean }[]): string {
  return items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n");
}

function ACChecklist({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = parseAC(value);
  const [newItem, setNewItem] = useState("");
  const doneCount = items.filter((i) => i.done).length;

  const toggle = (idx: number) => {
    const next = items.map((it, i) => i === idx ? { ...it, done: !it.done } : it);
    onChange(serializeAC(next));
  };
  const remove = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(serializeAC(next));
  };
  const addItem = () => {
    if (!newItem.trim()) return;
    const next = [...items, { text: newItem.trim(), done: false }];
    onChange(serializeAC(next));
    setNewItem("");
  };

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-content-tertiary">{doneCount}/{items.length} done</span>
          {items.length > 0 && (
            <div className="h-1 flex-1 mx-3 rounded-full bg-surface-tertiary overflow-hidden">
              <div className="h-full bg-accent transition-all rounded-full" style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }} />
            </div>
          )}
        </div>
      )}
      {items.map((item, idx) => (
        <div key={idx} className="group flex items-start gap-2">
          <button
            onClick={() => toggle(idx)}
            className={cn(
              "mt-0.5 size-4 shrink-0 rounded border flex items-center justify-center transition-colors",
              item.done ? "bg-accent border-accent" : "border-border hover:border-accent/60"
            )}
          >
            {item.done && <CheckCircle2 size={10} className="text-white" strokeWidth={3} />}
          </button>
          <span className={cn("flex-1 text-xs leading-5", item.done ? "line-through text-content-tertiary" : "text-content-primary")}>
            {item.text}
          </span>
          <button onClick={() => remove(idx)} className="opacity-0 group-hover:opacity-100 text-content-tertiary hover:text-error transition-all p-0.5">
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5 mt-1">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          placeholder="Add criterion…"
          className="text-xs h-7"
        />
        <button onClick={addItem} className="h-7 px-2 rounded-md bg-surface-tertiary text-content-secondary hover:text-content-primary text-xs transition-colors">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Agent Runs Panel ─────────────────────────────────────────────────────────

const RUN_TYPE_LABEL: Record<string, { label: string; color: string }> = {
  plan:      { label: "Plan",    color: "text-purple-600 bg-purple-50 border-purple-200" },
  design:    { label: "Design",  color: "text-amber-600 bg-amber-50 border-amber-200" },
  implement: { label: "Impl",    color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  qa:        { label: "QA",      color: "text-green-600 bg-green-50 border-green-200" },
  single:    { label: "Execute", color: "text-accent bg-accent/10 border-accent/20" },
  execute:   { label: "Execute", color: "text-accent bg-accent/10 border-accent/20" },
};

function RunsPanel({ storyId, agentId }: { storyId?: string; agentId?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", storyId, agentId],
    queryFn: () => api.runs.list({ story_id: storyId, agent_id: agentId }),
    refetchInterval: 10_000,
    enabled: !!(storyId || agentId),
  });

  if (runs.length === 0) return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
        <Sparkles size={10} />Agent Runs
      </p>
      <p className="text-[11px] text-content-tertiary/60 italic">
        No runs yet — executions via Claude API will appear here with token counts and output.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
        <Sparkles size={10} />Agent Runs
      </p>
      {runs.map((run: AgentRun) => {
        const meta = RUN_TYPE_LABEL[run.run_type] ?? { label: run.run_type, color: "text-content-tertiary bg-surface-tertiary border-border" };
        const tokTotal = (run.tokens_in ?? 0) + (run.tokens_out ?? 0);
        const isExpanded = expanded === run.id;
        return (
          <div key={run.id} className="rounded-lg border border-border bg-surface-card overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-secondary/40 transition-colors"
              onClick={() => setExpanded(isExpanded ? null : run.id)}
            >
              <span className={cn("font-mono text-[9px] rounded border px-1.5 py-0.5 shrink-0", meta.color)}>
                {meta.label}
              </span>
              {run.agent_name && (
                <span className="text-[11px] text-content-secondary font-medium truncate flex-1">{run.agent_name}</span>
              )}
              <span className="font-mono text-[9px] text-content-tertiary shrink-0">{run.model?.split("-").slice(-2).join("-")}</span>
              {tokTotal > 0 && (
                <span className="font-mono text-[9px] text-content-tertiary shrink-0 flex items-center gap-0.5">
                  {tokTotal >= 1000 ? `${(tokTotal / 1000).toFixed(1)}k` : tokTotal}tok
                  <span className="text-content-tertiary/50">({run.turns}t)</span>
                </span>
              )}
              <span className="font-mono text-[9px] text-content-tertiary/60 shrink-0">
                {dayjs(run.created_at).format("HH:mm")}
              </span>
            </div>
            {isExpanded && (
              <div className="border-t border-border bg-surface-secondary/30 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-[10px] text-content-tertiary font-mono">
                  <span>↑ {run.tokens_in} in</span>
                  <span>↓ {run.tokens_out} out</span>
                  <span>{run.turns} turn{run.turns !== 1 ? "s" : ""}</span>
                  {run.model && <span>{run.model}</span>}
                </div>
                {run.prompt_text && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Context sent</span>
                    <pre className="text-[10px] font-mono text-content-secondary whitespace-pre-wrap bg-surface-tertiary rounded p-2 max-h-40 overflow-y-auto">
                      {run.prompt_text}
                    </pre>
                  </div>
                )}
                {run.output_text && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Output</span>
                    <pre className="text-[10px] font-mono text-content-secondary whitespace-pre-wrap bg-surface-tertiary rounded p-2 max-h-40 overflow-y-auto">
                      {run.output_text}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Activities Feed ──────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, { row: string; dot: string; text: string; badge?: string }> = {
  error: { row: "bg-red-50/60 border border-red-200/80 rounded-lg px-2 py-1.5", dot: "bg-red-100 text-red-600", text: "text-red-700", badge: "bg-red-100 text-red-600 border-red-200" },
  warn:  { row: "bg-amber-50/60 border border-amber-200/80 rounded-lg px-2 py-1.5", dot: "bg-amber-100 text-amber-600", text: "text-amber-700", badge: "bg-amber-100 text-amber-600 border-amber-200" },
  info:  { row: "", dot: "bg-surface-tertiary text-content-tertiary", text: "text-content-secondary" },
  debug: { row: "opacity-40", dot: "bg-surface-tertiary/60 text-content-tertiary/60", text: "text-content-tertiary", badge: "bg-surface-tertiary text-content-tertiary/50 border-border" },
};

const TYPE_ICON: Record<string, string> = {
  status_change: "S", git: "G", git_error: "G", qa: "Q", qa_signoff: "Q",
  execution_start: "▶", execution_complete: "✓", execution_error: "✗",
  task_created: "T", task_start: "▶", task_phase: "T", created: "+",
  field_change: "~", agent_change: "A", sprint_change: "Sp",
};

function ActivitiesFeed({ storyId }: { storyId: string }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState<"all" | "errors" | "system">("all");
  const [showDebug, setShowDebug] = useState(false);

  const { data: rawActivities = [] } = useQuery({
    queryKey: ["activities", storyId],
    queryFn: () => api.activities.list(storyId),
    refetchInterval: 5_000,
  });

  const addComment = useMutation({
    mutationFn: () => api.activities.create(storyId, { content: comment }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["activities", storyId] }); setComment(""); },
  });

  const activities = rawActivities.filter((act) => {
    const level = act.level ?? "info";
    if (!showDebug && level === "debug") return false;
    if (filter === "errors") return level === "error" || level === "warn";
    if (filter === "system") return act.author !== "human" && act.type !== "comment";
    return true;
  });

  const errorCount = rawActivities.filter((a) => (a.level ?? "info") === "error").length;
  const warnCount  = rawActivities.filter((a) => (a.level ?? "info") === "warn").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5 shrink-0">
          <MessageSquare size={10} />Activity
          {errorCount > 0 && <span className="font-mono text-[9px] bg-red-100 text-red-600 border border-red-200 rounded px-1">{errorCount}e</span>}
          {warnCount > 0 && <span className="font-mono text-[9px] bg-amber-100 text-amber-600 border border-amber-200 rounded px-1">{warnCount}w</span>}
        </p>
        <div className="flex items-center gap-0.5">
          {(["all", "errors", "system"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border transition-colors",
                filter === f ? "bg-accent/10 border-accent/30 text-accent" : "border-transparent text-content-tertiary hover:text-content-secondary"
              )}>
              {f}
            </button>
          ))}
          <button onClick={() => setShowDebug((v) => !v)}
            className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border transition-colors ml-1",
              showDebug ? "bg-surface-tertiary border-border text-content-secondary" : "border-transparent text-content-tertiary/40 hover:text-content-tertiary"
            )}>
            dbg
          </button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <Input value={comment} onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (comment.trim()) addComment.mutate(); } }}
          placeholder="Add comment…" className="text-xs h-7 flex-1" />
        <button onClick={() => { if (comment.trim()) addComment.mutate(); }}
          disabled={!comment.trim() || addComment.isPending}
          className="h-7 px-2 rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
          <Send size={11} />
        </button>
      </div>

      <div className="flex flex-col gap-1 pr-1">
        {activities.map((act) => {
          const level = act.level ?? "info";
          const style = LEVEL_STYLE[level] ?? LEVEL_STYLE.info;
          const dotLabel = TYPE_ICON[act.type] ?? act.author[0]?.toUpperCase() ?? "?";
          return (
            <div key={act.id} className={cn("flex gap-2", style.row)}>
              <div className={cn("size-5 shrink-0 rounded-full mt-0.5 flex items-center justify-center text-[9px] font-bold", style.dot)}>
                {(level === "error" || level === "warn") ? "!" : dotLabel}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-semibold text-content-secondary">{act.author}</span>
                  {style.badge && (
                    <span className={cn("font-mono text-[8px] border rounded px-1 py-px leading-none", style.badge)}>{level}</span>
                  )}
                  <span className="font-mono text-[9px] text-content-tertiary/50">{act.type}</span>
                  <span className="text-[9px] text-content-tertiary font-mono ml-auto">{dayjs(act.created_at).format("MMM D HH:mm")}</span>
                </div>
                <p className={cn("text-[11px] leading-relaxed whitespace-pre-line", style.text)}>{act.content}</p>
              </div>
            </div>
          );
        })}
        {activities.length === 0 && (
          <p className="text-[11px] text-content-tertiary py-2 text-center">
            {filter !== "all" ? "No entries match this filter" : "No activity yet"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Story Card ───────────────────────────────────────────────────────────────

function StoryCard({ story, onClick }: { story: Story; onClick: () => void }) {
  const isActive = ACTIVE_STATUSES.includes(story.status) && !!story.assigned_agent_id;
  const TypeIcon = TYPE_ICONS[story.type] ?? ListTodo;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className={cn(
        "w-full text-left bg-surface-card border rounded-lg p-3 outline-none cursor-pointer",
        "transition-[border-color,box-shadow] duration-150",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        isActive
          ? "border-accent/25 shadow-[0_0_12px_rgba(6,182,212,0.08)]"
          : "border-border hover:border-content-tertiary/60"
      )}
    >
      <div className="flex items-start gap-1.5">
        <TypeIcon size={12} className="mt-0.5 shrink-0" style={{ color: TYPE_COLORS[story.type] }} />
        <span className="font-mono text-[10px] leading-snug text-content-tertiary shrink-0">{story.key}</span>
        <p className="line-clamp-2 text-[12px] font-medium leading-snug text-content-primary flex-1 min-w-0">
          {story.title}
        </p>
      </div>

      {story.epic_title && (
        <div className="mt-1.5 pl-5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px]"
            style={{ backgroundColor: `${story.epic_color}15`, color: story.epic_color ?? "#06b6d4" }}
          >
            {story.epic_title}
          </span>
        </div>
      )}

      <div className="mt-2 pl-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
          {story.story_points != null && (
            <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary rounded px-1">
              {story.story_points}p
            </span>
          )}
          {story.mode === "auto" && (
            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-accent bg-accent/10 rounded px-1 py-0.5">
              <Sparkles size={8} />auto
            </span>
          )}
        </div>
        {story.agent_name && (
          <div className={cn("flex items-center gap-1", isActive ? "text-accent" : "text-content-tertiary")}>
            {isActive && <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />}
            <Bot size={10} />
            <span className="font-mono text-[10px] truncate max-w-[7rem]">{story.agent_name}</span>
          </div>
        )}
      </div>

      {/* At-a-glance progress: design gate, task completion, defects, QA verdict */}
      {(story.status === "design_review" || (story.task_total ?? 0) > 0 || (story.defect_count ?? 0) > 0 || story.qa_result) && (
        <div className="mt-1.5 pl-5 flex items-center gap-2 flex-wrap">
          {story.status === "design_review" && (
            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5">
              <ClipboardCheck size={8} />needs review
            </span>
          )}
          {(story.task_total ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] text-content-tertiary" title="tasks done / total">
              <span className="text-content-secondary">{story.task_done ?? 0}/{story.task_total}</span>
              <span className="inline-block h-1 w-8 rounded-full bg-surface-tertiary overflow-hidden">
                <span className="block h-full bg-accent" style={{ width: `${Math.round(((story.task_done ?? 0) / (story.task_total || 1)) * 100)}%` }} />
              </span>
            </span>
          )}
          {(story.defect_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-red-600" title="open defects">
              <Bug size={8} />{story.defect_count}
            </span>
          )}
          {story.qa_result && (
            <span className={cn("inline-flex items-center font-mono text-[9px] rounded px-1 py-0.5 border",
              story.qa_result === "pass" ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200")}>
              QA {story.qa_result}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Story Row (Backlog list view) ────────────────────────────────────────────

const STATUS_BADGE = Object.fromEntries(
  (Object.keys(STORY_STATUS) as StoryStatus[]).map((s) => [s, STORY_STATUS[s].badge]),
) as Record<StoryStatus, string>;

function StoryRow({ story, sprints, onClick, onSprintChange }: {
  story: Story; sprints: Sprint[]; onClick: () => void;
  onSprintChange: (sprintId: string | null) => void;
}) {
  const TypeIcon = TYPE_ICONS[story.type] ?? ListTodo;
  return (
    <div className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-surface-card hover:bg-surface-tertiary hover:border-border transition-colors">
      <TypeIcon size={11} style={{ color: TYPE_COLORS[story.type] }} className="shrink-0" />
      <button onClick={onClick} className="flex-1 flex items-center gap-2 text-left min-w-0">
        <span className="font-mono text-[10px] text-content-tertiary shrink-0">{story.key}</span>
        <span className="text-xs text-content-primary truncate flex-1">{story.title}</span>
        {story.epic_title && (
          <span className="shrink-0 inline-flex rounded-full px-1.5 py-0.5 font-mono text-[9px]"
            style={{ backgroundColor: `${story.epic_color}15`, color: story.epic_color ?? "#06b6d4" }}>
            {story.epic_title}
          </span>
        )}
      </button>
      <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 font-mono text-[9px] ${STATUS_BADGE[story.status] ?? ""}`}>
        {STATUS_LABELS[story.status]}
      </span>
      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
      {story.story_points != null && (
        <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary rounded px-1 shrink-0">{story.story_points}p</span>
      )}
      {story.branch_name && (
        <span className="font-mono text-[9px] text-accent/70 flex items-center gap-0.5 shrink-0 hidden lg:flex">
          <GitBranch size={9} />{story.branch_name.replace("feature/", "")}
        </span>
      )}
      {story.agent_name && (
        <span className="font-mono text-[10px] text-accent flex items-center gap-0.5 shrink-0"><Bot size={9} />{story.agent_name}</span>
      )}
      <select
        value={story.sprint_id ?? ""}
        onChange={(e) => onSprintChange(e.target.value || null)}
        onClick={(e) => e.stopPropagation()}
        className="h-6 rounded border border-border bg-surface-secondary text-[10px] text-content-secondary px-1 outline-none focus:border-accent shrink-0 max-w-[100px]"
      >
        <option value="">Backlog</option>
        {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

// ─── Execute Panel ────────────────────────────────────────────────────────────

interface ExecLine {
  type: "progress" | "text" | "tool_call" | "tool_result" | "done" | "error";
  content: string;
  tool?: string;
}

function ExecutePanel({
  story,
  canExecute,
  showPlan,
  onDone,
  label = "Execute",
}: {
  story: Story;
  canExecute: boolean;
  showPlan?: boolean;
  onDone: () => void;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [lines, setLines] = useState<ExecLine[]>([]);
  const bottomRef = { current: null as HTMLDivElement | null };

  const append = (line: ExecLine) => {
    setLines((prev) => {
      if (line.type === "text" && prev.length > 0 && prev[prev.length - 1].type === "text") {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + line.content };
        return updated;
      }
      return [...prev, line];
    });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
  };

  const streamFrom = async (fetchFn: () => Promise<Response>, onComplete?: () => void) => {
    if (status === "running") return;
    setStatus("running");
    setLines([]);
    try {
      const res = await fetchFn();
      if (!res.ok) {
        append({ type: "error", content: `HTTP ${res.status}` });
        setStatus("error");
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (!json) continue;
          try {
            const evt = JSON.parse(json) as { type: ExecLine["type"]; content?: string; tool?: string };
            append({ type: evt.type, content: evt.content ?? "", tool: evt.tool });
            if (evt.type === "done") { setStatus("done"); onComplete?.(); onDone(); return; }
            if (evt.type === "error") { setStatus("error"); return; }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      append({ type: "error", content: e instanceof Error ? e.message : String(e) });
      setStatus("error");
    }
  };

  const run = () => streamFrom(() => api.execution.run(story.id));
  const plan = () => streamFrom(() => api.execution.plan(story.id));

  const LINE_STYLE: Record<ExecLine["type"], string> = {
    progress:    "text-content-tertiary",
    text:        "text-content-primary whitespace-pre-wrap",
    tool_call:   "text-accent",
    tool_result: "text-content-secondary",
    done:        "text-green-600 font-medium",
    error:       "text-error",
  };

  const LINE_PREFIX: Partial<Record<ExecLine["type"], string>> = {
    progress:    "…  ",
    tool_call:   "▶  ",
    tool_result: "◀  ",
    done:        "✓  ",
    error:       "✗  ",
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
          <Sparkles size={10} />Agent Execution
        </p>
        <div className="flex items-center gap-1.5">
          {showPlan && (
            <button
              onClick={plan}
              disabled={!canExecute || status === "running"}
              title="Run Tech Lead planning only (creates task pipeline without executing)"
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold transition-all border ${
                !canExecute || status === "running"
                  ? "border-border text-content-tertiary/50 cursor-not-allowed"
                  : "border-border text-content-secondary hover:border-accent hover:text-accent"
              }`}
            >
              <Network size={11} />Plan
            </button>
          )}
          <button
            onClick={run}
            disabled={!canExecute || status === "running"}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold transition-all ${
              !canExecute
                ? "border border-border text-content-tertiary/50 cursor-not-allowed"
                : status === "running"
                ? "bg-accent/20 text-accent cursor-not-allowed"
                : status === "done"
                ? "bg-green-50 border border-green-200 text-green-700 hover:opacity-90"
                : "bg-accent text-white hover:opacity-90"
            }`}
          >
            {status === "running" ? (
              <><RotateCw size={11} className="animate-spin" />Running…</>
            ) : status === "done" ? (
              <><CheckCircle2 size={11} />Run again</>
            ) : (
              <><Play size={11} className="fill-current" />{label}</>
            )}
          </button>
        </div>
      </div>

      {!canExecute && status === "idle" && (
        <p className="text-[11px] text-content-tertiary italic">
          Requires: status = In Dev, branch created, and either a lead agent or pipeline tasks
        </p>
      )}

      {lines.length > 0 && (
        <div className="rounded bg-surface-secondary border border-border max-h-56 overflow-y-auto scrollbar-column p-2.5 flex flex-col gap-0.5 font-mono text-[11px]">
          {lines.map((line, i) => (
            <div key={i} className={LINE_STYLE[line.type]}>
              <span className="opacity-40 select-none">{LINE_PREFIX[line.type] ?? "   "}</span>
              {line.tool && line.type === "tool_call" && (
                <span className="opacity-60 mr-1">[{line.tool}]</span>
              )}
              {line.content}
            </div>
          ))}
          <div ref={(el) => { bottomRef.current = el; }} />
        </div>
      )}
    </div>
  );
}

// ─── Role meta ────────────────────────────────────────────────────────────────

const ROLE_EMOJI: Record<string, string> = {
  frontend: "🎨", backend: "⚙️", qa: "🧪", devops: "🚀",
  security: "🔒", techlead: "🏗️", custom: "✏️",
};

const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  todo:        { label: "To Do",        cls: "bg-surface-tertiary text-content-tertiary" },
  in_progress: { label: "In Progress",  cls: "bg-cyan-50 text-cyan-700 border border-cyan-200 animate-pulse" },
  in_review:   { label: "In Review",    cls: "bg-purple-50 text-purple-700 border border-purple-200" },
  done:        { label: "Done",         cls: "bg-green-50 text-green-700 border border-green-200" },
  blocked:     { label: "Blocked",      cls: "bg-orange-50 text-orange-700 border border-orange-200" },
  failed:      { label: "Failed",       cls: "bg-red-50 text-red-700 border border-red-200" },
};

const TASK_TYPE_META: Record<TaskType, { label: string; icon: string; cls: string }> = {
  subtask: { label: "Sub-task", icon: "✓", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  defect:  { label: "Defect",   icon: "🐛", cls: "bg-red-50 text-red-700 border-red-200" },
  spike:   { label: "Spike",    icon: "🔬", cls: "bg-purple-50 text-purple-700 border-purple-200" },
};

const SEVERITY_META: Record<DefectSeverity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border-red-300" },
  major:    { label: "Major",    cls: "bg-orange-50 text-orange-700 border-orange-200" },
  minor:    { label: "Minor",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  trivial:  { label: "Trivial",  cls: "bg-surface-tertiary text-content-tertiary border-border" },
};

// Count AC items: lines starting with - [ ] or - [x]
function countAC(text: string | null): { done: number; total: number } {
  if (!text) return { done: 0, total: 0 };
  const items = text.split("\n").map((l) => l.trim()).filter((l) => /^-?\s*\[[ x]\]/i.test(l));
  return { done: items.filter((l) => /^-?\s*\[x\]/i.test(l)).length, total: items.length };
}

// ─── Task Pipeline View ───────────────────────────────────────────────────────

function TaskPipelineView({ storyId, onTaskDone }: { storyId: string; onTaskDone?: () => void }) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", storyId],
    queryFn: () => api.tasks.list(storyId),
    refetchInterval: 5_000,
  });
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === "done").length;

  const rerunTask = async (taskId: string) => {
    if (rerunningId) return;
    setRerunningId(taskId);
    try {
      const res = await api.execution.runTask(storyId, taskId);
      if (!res.ok) { setRerunningId(null); return; }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim(); if (!json) continue;
          try {
            const evt = JSON.parse(json) as { type: string };
            if (evt.type === "done" || evt.type === "error") {
              qc.invalidateQueries({ queryKey: ["tasks", storyId] });
              onTaskDone?.();
              break;
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      setRerunningId(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 mt-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1">
          <Network size={9} />Pipeline
        </span>
        <span className="text-[9px] font-mono text-content-tertiary">{done}/{tasks.length}</span>
      </div>
      {tasks.map((task) => {
        const status = STATUS_META[task.status] ?? STATUS_META.todo;
        const typeMeta = TASK_TYPE_META[task.type] ?? TASK_TYPE_META.subtask;
        return (
          <div key={task.id} className="flex items-center gap-1.5">
            <span className="text-[11px] leading-none w-4 text-center shrink-0">
              {task.type === "defect" ? typeMeta.icon : (ROLE_EMOJI[task.role] ?? "✏️")}
            </span>
            <span className="text-[11px] text-content-secondary flex-1 truncate">{task.title}</span>
            <span className={cn("font-mono text-[9px] rounded px-1.5 py-0.5 shrink-0", status.cls)}>
              {status.label}
            </span>
            <button
              onClick={() => rerunTask(task.id)}
              disabled={!!rerunningId}
              title="Run this task"
              className="shrink-0 text-content-tertiary hover:text-accent disabled:opacity-40 transition-colors"
            >
              <RotateCw size={10} className={rerunningId === task.id ? "animate-spin" : ""} />
            </button>
          </div>
        );
      })}
    </div>
  );
}


// ─── QA Status Panel ──────────────────────────────────────────────────────────
// Shows auto-run status; QA is triggered by the backend on in_qa transition.
// A manual Re-run button streams live output for debugging/re-verification.

function QAStatusPanel({ story, onDone }: { story: Story; onDone: () => void }) {
  const [rerunStatus, setRerunStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [lines, setLines] = useState<ExecLine[]>([]);
  const bottomRef = { current: null as HTMLDivElement | null };

  const canRerun = (story.status === "in_progress" || story.status === "human_review") && !!story.assigned_agent_id;

  const append = (line: ExecLine) => {
    setLines((prev) => {
      if (line.type === "text" && prev.length > 0 && prev[prev.length - 1].type === "text") {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + line.content };
        return updated;
      }
      return [...prev, line];
    });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
  };

  const rerun = async () => {
    if (rerunStatus === "running") return;
    setRerunStatus("running");
    setLines([]);
    try {
      const res = await api.execution.qaRun(story.id);
      if (!res.ok) { append({ type: "error", content: `HTTP ${res.status}` }); setRerunStatus("error"); return; }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim(); if (!json) continue;
          try {
            const evt = JSON.parse(json) as { type: ExecLine["type"]; content?: string; tool?: string };
            append({ type: evt.type, content: evt.content ?? "", tool: evt.tool });
            if (evt.type === "done") { setRerunStatus("done"); onDone(); return; }
            if (evt.type === "error") { setRerunStatus("error"); return; }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      append({ type: "error", content: e instanceof Error ? e.message : String(e) });
      setRerunStatus("error");
    }
  };

  const LINE_STYLE: Record<ExecLine["type"], string> = {
    progress: "text-content-tertiary", text: "text-content-primary whitespace-pre-wrap",
    tool_call: "text-amber-600", tool_result: "text-content-secondary",
    done: "text-green-600 font-medium", error: "text-error",
  };
  const LINE_PREFIX: Partial<Record<ExecLine["type"], string>> = {
    progress: "…  ", tool_call: "▶  ", tool_result: "◀  ", done: "✓  ", error: "✗  ",
  };

  // Auto-run state: story in human_review (just transitioned from in_progress), agent assigned, no result yet
  const autoRunning = story.status === "human_review" && !!story.assigned_agent_id && !story.qa_result && rerunStatus === "idle";

  return (
    <div className="flex flex-col gap-2">
      {/* Auto-run indicator */}
      {autoRunning && (
        <div className="flex items-center gap-2 rounded bg-amber-50 border border-amber-200 px-2.5 py-2">
          <RotateCw size={11} className="text-amber-600 animate-spin shrink-0" />
          <span className="text-[11px] text-amber-700">QA agent running automatically…</span>
        </div>
      )}

      {/* Result badges */}
      {story.qa_result === "pass" && (
        <div className="flex items-center gap-1.5 rounded bg-green-50 border border-green-200 px-2.5 py-2">
          <CheckCircle2 size={12} className="text-green-600 shrink-0" />
          <span className="text-[11px] text-green-700 font-medium">Agent QA passed</span>
        </div>
      )}
      {story.qa_result === "fail" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 rounded bg-red-50 border border-red-200 px-2.5 py-2">
            <XCircle size={12} className="text-red-500 shrink-0" />
            <span className="text-[11px] text-red-700 font-medium flex-1">Agent QA failed</span>
          </div>
          <p className="text-[10px] text-content-tertiary pl-1">
            Bug story auto-created — check activity log or sprint backlog
          </p>
        </div>
      )}

      {/* Re-run button (always available for manual re-verification) */}
      {canRerun && (
        <button
          onClick={rerun}
          disabled={rerunStatus === "running"}
          className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded text-[11px] font-medium transition-all self-start ${
            rerunStatus === "running"
              ? "text-amber-600 cursor-not-allowed"
              : "text-content-tertiary hover:text-content-primary border border-border hover:border-content-tertiary/60"
          }`}
        >
          <RotateCw size={10} className={rerunStatus === "running" ? "animate-spin" : ""} />
          {rerunStatus === "running" ? "Running…" : story.qa_result ? "Re-run QA" : "Run QA manually"}
        </button>
      )}

      {/* Live output for re-runs */}
      {lines.length > 0 && (
        <div className="rounded bg-surface-secondary border border-border max-h-48 overflow-y-auto scrollbar-column p-2.5 flex flex-col gap-0.5 font-mono text-[11px]">
          {lines.map((line, i) => (
            <div key={i} className={LINE_STYLE[line.type]}>
              <span className="opacity-40 select-none">{LINE_PREFIX[line.type] ?? "   "}</span>
              {line.tool && line.type === "tool_call" && <span className="opacity-60 mr-1">[{line.tool}]</span>}
              {line.content}
            </div>
          ))}
          <div ref={(el) => { bottomRef.current = el; }} />
        </div>
      )}
    </div>
  );
}

// ─── QA Sign-off Button ───────────────────────────────────────────────────────

function QASignOffButton({ storyId, onUpdate, qc }: {
  storyId: string;
  onUpdate: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api.stories.update(storyId, {
      qa_signed_off_by: name,
      qa_signed_off_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
      setOpen(false);
      setName("");
      onUpdate();
      toast.success("QA signed off");
    },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-xs text-content-secondary hover:border-green-400 hover:text-green-600 transition-colors">
        <UserCheck size={12} />Sign off QA
      </button>
    );
  }
  return (
    <div className="flex gap-1.5">
      <Input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Your name" className="h-7 text-xs flex-1"
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) mutation.mutate(); }} />
      <button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}
        className="h-7 px-2.5 rounded-md bg-green-600 text-white text-xs hover:opacity-90 disabled:opacity-50">
        Sign off
      </button>
      <button onClick={() => setOpen(false)} className="h-7 px-2 rounded-md border border-border text-xs text-content-tertiary hover:bg-surface-secondary">✕</button>
    </div>
  );
}

// ─── Tasks Tab ───────────────────────────────────────────────────────────────

function TasksTab({ storyId, storyKey, agents, onRefresh }: {
  storyId: string;
  storyKey: string;
  agents: Agent[];
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", storyId],
    queryFn: () => api.tasks.list(storyId),
    refetchInterval: 3_000,
  });
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addType, setAddType] = useState<TaskType | null>(null);

  const rerunTask = async (taskId: string) => {
    if (rerunningId) return;
    setRerunningId(taskId);
    try {
      const res = await api.execution.runTask(storyId, taskId);
      if (!res.ok) return;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(trimmed.slice(5).trim()) as { type: string };
            if (evt.type === "done" || evt.type === "error") { onRefresh(); break; }
          } catch { /* skip */ }
        }
      }
    } finally {
      setRerunningId(null);
      qc.invalidateQueries({ queryKey: ["tasks", storyId] });
    }
  };

  const updateTask = (taskId: string, patch: Parameters<typeof api.tasks.update>[2]) =>
    api.tasks.update(storyId, taskId, patch)
      .then(() => qc.invalidateQueries({ queryKey: ["tasks", storyId] }));

  const deleteTask = (taskId: string) =>
    api.tasks.delete(storyId, taskId)
      .then(() => qc.invalidateQueries({ queryKey: ["tasks", storyId] }));

  if (isLoading) return <p className="text-xs text-content-tertiary">Loading…</p>;

  const done    = tasks.filter((t) => t.status === "done").length;
  const failed  = tasks.filter((t) => t.status === "failed").length;
  const defects = tasks.filter((t) => t.type === "defect").length;
  const totalEstimate = tasks.reduce((sum, t) => sum + (t.estimate_hours ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Summary bar */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-3 px-1 flex-wrap">
          <span className="text-[11px] text-content-tertiary font-mono">{done}/{tasks.length} done</span>
          {failed > 0 && <span className="text-[11px] text-error font-mono">{failed} failed</span>}
          {defects > 0 && <span className="text-[11px] text-red-600 font-mono flex items-center gap-1"><Bug size={10} />{defects}</span>}
          {totalEstimate > 0 && <span className="text-[11px] text-content-tertiary font-mono">~{totalEstimate}h</span>}
          <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary overflow-hidden min-w-[60px]">
            <div className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Network size={28} className="text-content-tertiary/40" />
          <p className="text-sm text-content-secondary font-medium">No tasks yet</p>
          <p className="text-xs text-content-tertiary max-w-xs">
            Tech Lead will break down this story into sub-tasks when you run Plan or Execute.
            You can also add sub-tasks or defects manually.
          </p>
        </div>
      ) : (
        tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            storyKey={storyKey}
            agents={agents}
            isExpanded={expandedId === task.id}
            rerunning={rerunningId === task.id}
            onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
            onUpdate={(patch) => updateTask(task.id, patch)}
            onDelete={() => deleteTask(task.id)}
            onRerun={() => rerunTask(task.id)}
          />
        ))
      )}

      {/* Add task / defect button row */}
      <div className="relative flex items-center gap-2 pt-1">
        <button
          onClick={() => setShowAddMenu((v) => !v)}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-xs text-content-secondary hover:border-accent hover:text-accent transition-colors"
        >
          <Plus size={11} />Add
        </button>
        {showAddMenu && (
          <div className="absolute left-0 top-9 z-10 bg-surface-card border border-border rounded-lg shadow-lg flex flex-col text-xs overflow-hidden min-w-[140px]">
            <button onClick={() => { setAddType("subtask"); setShowAddMenu(false); }}
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary text-left">
              <CheckCircle2 size={11} className="text-cyan-600" />Sub-task
            </button>
            <button onClick={() => { setAddType("defect"); setShowAddMenu(false); }}
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary text-left">
              <Bug size={11} className="text-red-600" />Defect
            </button>
            <button onClick={() => { setAddType("spike"); setShowAddMenu(false); }}
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary text-left">
              <Lightbulb size={11} className="text-purple-600" />Spike
            </button>
          </div>
        )}
      </div>

      {/* Add task dialog */}
      {addType && (
        <AddTaskDialog
          storyId={storyId}
          type={addType}
          agents={agents}
          nextSeq={(tasks[tasks.length - 1]?.seq ?? 0) + 1}
          onClose={() => setAddType(null)}
          onCreated={() => { qc.invalidateQueries({ queryKey: ["tasks", storyId] }); setAddType(null); }}
        />
      )}
    </div>
  );
}

// ─── Task Card (Jira-style row) ────────────────────────────────────────────────

function TaskCard({ task, storyKey, agents, isExpanded, rerunning, onToggle, onUpdate, onDelete, onRerun }: {
  task: StoryTask;
  storyKey: string;
  agents: Agent[];
  isExpanded: boolean;
  rerunning: boolean;
  onToggle: () => void;
  onUpdate: (patch: Parameters<typeof api.tasks.update>[2]) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onRerun: () => void;
}) {
  const status = STATUS_META[task.status] ?? STATUS_META.todo;
  const typeMeta = TASK_TYPE_META[task.type] ?? TASK_TYPE_META.subtask;
  const sevMeta = task.severity ? SEVERITY_META[task.severity] : null;
  const ac = countAC(task.acceptance_criteria);
  const runLabel = task.status === "todo" ? "Run"
    : task.status === "done" ? "Re-run"
    : task.status === "failed" ? "Retry"
    : task.status === "in_progress" ? "Restart"
    : "Run";
  const assignedAgent = agents.find((a) => a.id === task.agent_id);
  const taskKey = `${storyKey}/${task.type === "defect" ? "D" : task.type === "spike" ? "S" : "T"}${task.seq}`;

  return (
    <div className="rounded-lg border border-border bg-surface-card overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-surface-secondary/50 transition-colors"
        onClick={onToggle}
      >
        <span className={cn("font-mono text-[9px] border rounded px-1.5 py-0.5 shrink-0 leading-none", typeMeta.cls)}>
          {typeMeta.icon} {typeMeta.label}
        </span>
        <span className="font-mono text-[10px] text-content-tertiary shrink-0">{taskKey}</span>
        <span className="text-xs font-medium text-content-primary flex-1 truncate">{task.title}</span>
        <span className="text-[11px] leading-none shrink-0">{ROLE_EMOJI[task.role] ?? "✏️"}</span>
        {sevMeta && (
          <span className={cn("font-mono text-[9px] border rounded px-1.5 py-0.5 shrink-0 leading-none", sevMeta.cls)}>
            {sevMeta.label}
          </span>
        )}
        {ac.total > 0 && (
          <span className="font-mono text-[9px] text-content-tertiary shrink-0" title="Acceptance criteria">
            {ac.done}/{ac.total} AC
          </span>
        )}
        {task.estimate_hours != null && (
          <span className="font-mono text-[9px] text-content-tertiary shrink-0">{task.estimate_hours}h</span>
        )}
        <span className={cn("font-mono text-[9px] rounded px-1.5 py-0.5 shrink-0 leading-none", status.cls)}>
          {status.label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRerun(); }}
          disabled={rerunning}
          title={`${runLabel} task`}
          className="shrink-0 inline-flex items-center gap-1 text-content-tertiary hover:text-accent disabled:opacity-40 transition-colors text-[10px] font-mono px-1"
        >
          <RotateCw size={11} className={rerunning ? "animate-spin" : ""} />
          {runLabel}
        </button>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-border px-3 py-3 flex flex-col gap-3 bg-surface-secondary/30">
          {/* Status + Agent row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Status</label>
              <Select value={task.status} onChange={(e) => onUpdate({ status: e.target.value })}>
                {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Assignee</label>
              <Select value={task.agent_id ?? ""} onChange={(e) => onUpdate({ agent_id: e.target.value || null })}>
                <option value="">— Unassigned —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role ?? a.provider})</option>)}
              </Select>
            </div>
          </div>

          {/* Estimate + Logged */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Estimate (h)</label>
              <Input type="number" step="0.5" min={0}
                defaultValue={task.estimate_hours ?? ""}
                onBlur={(e) => onUpdate({ estimate_hours: e.target.value ? Number(e.target.value) : null })}
                className="h-7 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Logged (h)</label>
              <Input type="number" step="0.5" min={0}
                defaultValue={task.logged_hours ?? ""}
                onBlur={(e) => onUpdate({ logged_hours: e.target.value ? Number(e.target.value) : null })}
                className="h-7 text-xs" />
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Description</label>
            <Textarea rows={3} defaultValue={task.description ?? ""}
              onBlur={(e) => onUpdate({ description: e.target.value || null })}
              placeholder="What needs to be done and how…"
              className="text-xs" />
          </div>

          {/* Acceptance Criteria */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">
              Acceptance Criteria {ac.total > 0 && <span className="font-normal text-content-tertiary/60">— {ac.done}/{ac.total}</span>}
            </label>
            <ACChecklist value={task.acceptance_criteria ?? ""} onChange={(v) => onUpdate({ acceptance_criteria: v || null })} />
          </div>

          {/* Defect-specific fields */}
          {task.type === "defect" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Severity</label>
                  <Select value={task.severity ?? ""} onChange={(e) => onUpdate({ severity: e.target.value || null })}>
                    <option value="">— None —</option>
                    {(Object.keys(SEVERITY_META) as DefectSeverity[]).map((s) => (
                      <option key={s} value={s}>{SEVERITY_META[s].label}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Found during</label>
                  <Select value={task.found_during ?? ""} onChange={(e) => onUpdate({ found_during: e.target.value || null })}>
                    <option value="">—</option>
                    <option value="dev">Development</option>
                    <option value="qa">QA</option>
                    <option value="uat">UAT</option>
                    <option value="prod">Production</option>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Steps to reproduce</label>
                <Textarea rows={3} defaultValue={task.steps_to_repro ?? ""}
                  onBlur={(e) => onUpdate({ steps_to_repro: e.target.value || null })}
                  placeholder="1. Go to…&#10;2. Click…&#10;3. See…" className="text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Expected</label>
                  <Textarea rows={2} defaultValue={task.expected ?? ""}
                    onBlur={(e) => onUpdate({ expected: e.target.value || null })}
                    placeholder="What should happen" className="text-xs" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Actual</label>
                  <Textarea rows={2} defaultValue={task.actual ?? ""}
                    onBlur={(e) => onUpdate({ actual: e.target.value || null })}
                    placeholder="What actually happens" className="text-xs" />
                </div>
              </div>
            </>
          )}

          {/* Output: implementation summary */}
          {task.impl_summary && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-green-600">Implementation output</span>
              <pre className="text-[10px] text-content-secondary whitespace-pre-wrap font-mono bg-surface-tertiary rounded p-2 max-h-32 overflow-y-auto">
                {task.impl_summary}
              </pre>
            </div>
          )}

          {/* Scope paths */}
          {task.scope_paths && JSON.parse(task.scope_paths).length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Scope</span>
              <div className="flex flex-wrap gap-1">
                {(JSON.parse(task.scope_paths) as string[]).map((p) => (
                  <span key={p} className="font-mono text-[9px] bg-surface-tertiary text-content-tertiary rounded px-1.5 py-0.5">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[9px] text-content-tertiary/60">
              {assignedAgent ? `${assignedAgent.name} · ${assignedAgent.role ?? assignedAgent.provider}` : "Unassigned"}
            </span>
            <button
              onClick={() => { if (confirm("Delete this task?")) onDelete(); }}
              className="flex items-center gap-1 text-[10px] text-content-tertiary hover:text-error transition-colors"
            >
              <Trash2 size={10} />Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Task / Defect / Spike Dialog ──────────────────────────────────────────

function AddTaskDialog({ storyId, type, agents, nextSeq, onClose, onCreated }: {
  storyId: string;
  type: TaskType;
  agents: Agent[];
  nextSeq: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState(type === "defect" ? "qa" : "fullstack");
  const [agentId, setAgentId] = useState("");
  const [estimate, setEstimate] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [stepsToRepro, setStepsToRepro] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [foundDuring, setFoundDuring] = useState("");

  const create = useMutation({
    mutationFn: () => api.tasks.create(storyId, {
      seq: nextSeq, type, title, role,
      description: description || undefined,
      agent_id: agentId || undefined,
      estimate_hours: estimate ? Number(estimate) : undefined,
      severity: severity || undefined,
      steps_to_repro: stepsToRepro || undefined,
      expected: expected || undefined,
      actual: actual || undefined,
      found_during: foundDuring || undefined,
    }),
    onSuccess: () => { onCreated(); toast.success(`${TASK_TYPE_META[type].label} created`); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to create"),
  });

  const meta = TASK_TYPE_META[type];

  return (
    <Dialog open onClose={onClose} className="max-w-md p-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className={cn("font-mono text-[10px] border rounded px-2 py-0.5", meta.cls)}>
          {meta.icon} {meta.label}
        </span>
        <span className="text-sm font-semibold text-content-primary">New {meta.label.toLowerCase()}</span>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={type === "defect" ? "Bug summary…" : "What needs doing…"} className="text-xs" autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Description</label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, approach, links…" className="text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Role</label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="fullstack">Fullstack</option>
              <option value="frontend">Frontend</option>
              <option value="backend">Backend</option>
              <option value="qa">QA</option>
              <option value="techlead">Tech Lead</option>
              <option value="devops">DevOps</option>
              <option value="security">Security</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Estimate (h)</label>
            <Input type="number" step="0.5" min={0} value={estimate}
              onChange={(e) => setEstimate(e.target.value)} placeholder="—" className="h-8 text-xs" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Assignee</label>
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role ?? a.provider})</option>)}
          </Select>
        </div>

        {type === "defect" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Severity</label>
                <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="critical">Critical</option>
                  <option value="major">Major</option>
                  <option value="minor">Minor</option>
                  <option value="trivial">Trivial</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Found during</label>
                <Select value={foundDuring} onChange={(e) => setFoundDuring(e.target.value)}>
                  <option value="">—</option>
                  <option value="dev">Development</option>
                  <option value="qa">QA</option>
                  <option value="uat">UAT</option>
                  <option value="prod">Production</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Steps to reproduce</label>
              <Textarea rows={2} value={stepsToRepro} onChange={(e) => setStepsToRepro(e.target.value)}
                placeholder="1. …&#10;2. …&#10;3. …" className="text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Expected</label>
                <Textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} className="text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-content-tertiary">Actual</label>
                <Textarea rows={2} value={actual} onChange={(e) => setActual(e.target.value)} className="text-xs" />
              </div>
            </div>
          </>
        )}
      </div>
      <DialogFooter>
        <button onClick={onClose} className="h-8 px-3 rounded-md border border-border text-xs text-content-secondary hover:bg-surface-secondary">
          Cancel
        </button>
        <button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}
          className="h-8 px-3 rounded-md bg-accent text-white text-xs hover:opacity-90 disabled:opacity-50">
          Create
        </button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Story Detail Dialog ──────────────────────────────────────────────────────

function StoryDialog({ story, onClose, epics, agents, sprints, project }: {
  story: Story; onClose: () => void;
  epics: Epic[]; agents: Agent[]; sprints: Sprint[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"story" | "tasks" | "qa" | "activity">("story");
  const [reportingDefect, setReportingDefect] = useState(false);

  const { data: existingTasks = [] } = useQuery({
    queryKey: ["tasks", story.id],
    queryFn: () => api.tasks.list(story.id),
    enabled: reportingDefect,
  });

  const update = (patch: Partial<Story>) =>
    api.stories.update(story.id, patch)
      .then(() => qc.invalidateQueries({ queryKey: ["stories"] }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to update";
        toast.error(msg.replace(/^\d{3}\s/, ""));
      });

  const deleteMutation = useMutation({
    mutationFn: () => api.stories.delete(story.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stories"] }); onClose(); toast.success("Story deleted"); },
  });

  const TypeIcon = TYPE_ICONS[story.type] ?? ListTodo;
  const assignedAgent = agents.find((a) => a.id === story.assigned_agent_id);

  const TABS = [
    { id: "story",    label: "Story",    icon: FileText },
    { id: "tasks",    label: "Tasks",    icon: Network },
    { id: "qa",       label: "QA",       icon: ShieldCheck },
    { id: "activity", label: "Activity", icon: MessageSquare },
  ] as const;

  return (
    <Dialog open onClose={onClose} className="max-w-5xl max-h-[92vh] overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <TypeIcon size={13} style={{ color: TYPE_COLORS[story.type] }} />
          <span className="font-mono text-[11px] text-content-tertiary">{story.key}</span>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
          <span className="text-[10px] text-content-tertiary">{PRIORITY_LABELS[story.priority]}</span>
          {story.mode === "auto" && (
            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-accent bg-accent/10 border border-accent/20 rounded-full px-1.5 py-0.5">
              <Sparkles size={8} />auto
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { if (confirm("Delete this story?")) deleteMutation.mutate(); }}
            className="p-1.5 text-content-tertiary hover:text-error transition-colors rounded">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="grid overflow-hidden" style={{ gridTemplateColumns: "1fr 300px", maxHeight: "calc(92vh - 56px)" }}>

        {/* Left — tabbed content */}
        <div className="flex flex-col min-h-0 border-r border-border">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-4 pt-2.5 pb-0 border-b border-border shrink-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors",
                  tab === id
                    ? "border-accent text-accent"
                    : "border-transparent text-content-tertiary hover:text-content-secondary"
                )}>
                <Icon size={11} />{label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto scrollbar-column p-5">

            {/* ── Story tab ── */}
            {tab === "story" && (
              <div className="flex flex-col gap-5">
                <Input
                  defaultValue={story.title}
                  onBlur={(e) => { if (e.target.value && e.target.value !== story.title) update({ title: e.target.value }); }}
                  className="text-xl font-bold text-content-primary bg-transparent border-transparent hover:border-border focus:border-border px-1 h-auto py-2 leading-tight"
                />
                <div className="rounded-lg border border-border bg-surface-secondary p-3.5 flex flex-col gap-2.5">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">User Story</p>
                  {[
                    { key: "as_a",    label: "As a",    value: story.as_a,    placeholder: "product owner / developer..." },
                    { key: "i_want",  label: "I want",  value: story.i_want,  placeholder: "to view a dashboard with..." },
                    { key: "so_that", label: "So that", value: story.so_that, placeholder: "I can track progress..." },
                  ].map(({ key, label, value, placeholder }) => (
                    <div key={key} className="flex gap-2 items-center">
                      <span className="text-[10px] text-content-tertiary w-14 shrink-0 text-right">{label}</span>
                      <Input defaultValue={value ?? ""}
                        onBlur={(e) => update({ [key]: e.target.value || null } as Partial<Story>)}
                        placeholder={placeholder} className="text-xs h-7 flex-1" />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Description</label>
                  <Textarea rows={4} defaultValue={story.description ?? ""}
                    onBlur={(e) => update({ description: e.target.value || null })}
                    placeholder="Additional technical context, mockup links..."
                    className="text-sm leading-relaxed" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Acceptance Criteria</label>
                  <ACChecklist value={story.acceptance_criteria ?? ""} onChange={(v) => update({ acceptance_criteria: v || null })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">
                    Definition of Done
                    {project.definition_of_done && !story.definition_of_done && (
                      <span className="ml-2 normal-case font-normal text-content-tertiary/60">(inherits from project)</span>
                    )}
                  </label>
                  <Textarea rows={3}
                    defaultValue={story.definition_of_done ?? project.definition_of_done ?? ""}
                    onBlur={(e) => update({ definition_of_done: e.target.value || null })}
                    placeholder={"- [ ] Tests written\n- [ ] PR reviewed"} className="text-xs" />
                </div>
              </div>
            )}

            {/* ── QA tab ── */}
            {tab === "qa" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
                    <ShieldCheck size={10} />QA Verification
                  </p>
                  <button onClick={() => setReportingDefect(true)}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-xs text-content-secondary hover:border-red-400 hover:text-red-600 transition-colors">
                    <Bug size={11} />Report defect
                  </button>
                </div>
                <QAStatusPanel story={story} onDone={() => qc.invalidateQueries({ queryKey: ["stories"] })} />
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
                    <ClipboardCheck size={10} />QA Test Cases
                  </label>
                  <ACChecklist value={story.qa_test_cases ?? ""} onChange={(v) => update({ qa_test_cases: v || null })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">QA Notes</label>
                  <Textarea rows={3} defaultValue={story.qa_notes ?? ""}
                    onBlur={(e) => update({ qa_notes: e.target.value || null })}
                    placeholder="Observations, edge cases found during QA..." className="text-xs" />
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
                    <UserCheck size={10} />Sign-off
                  </p>
                  {story.qa_signed_off_by ? (
                    <div className="flex items-center gap-1.5 rounded bg-green-50 border border-green-200 px-2 py-1.5">
                      <UserCheck size={12} className="text-green-600 shrink-0" />
                      <span className="text-[11px] text-green-700 flex-1">
                        Signed off by <strong>{story.qa_signed_off_by}</strong>
                      </span>
                      <span className="font-mono text-[9px] text-green-600">
                        {story.qa_signed_off_at ? dayjs(story.qa_signed_off_at).format("MMM D") : ""}
                      </span>
                    </div>
                  ) : (
                    <QASignOffButton storyId={story.id} onUpdate={() => update({})} qc={qc} />
                  )}
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
                    <Rocket size={10} />Rollout
                  </p>
                  {([
                    { label: "Staging", field: "staging_url",  placeholder: "https://staging.example.com", link: story.staging_url },
                    { label: "URL",     field: "deploy_url",   placeholder: "https://example.com",         link: story.deploy_url },
                    { label: "Commit",  field: "commit_hash",  placeholder: "abc1234",                     link: null },
                  ] as { label: string; field: keyof Story; placeholder: string; link: string | null }[]).map(({ label, field, placeholder, link }) => (
                    <div key={field} className="flex flex-col gap-1">
                      <div className="grid grid-cols-[56px_1fr] items-center gap-2">
                        <span className="text-[10px] text-content-tertiary text-right">{label}</span>
                        <Input defaultValue={(story[field] as string) ?? ""}
                          onBlur={(e) => update({ [field]: e.target.value || null } as Partial<Story>)}
                          placeholder={placeholder} className="h-7 text-xs font-mono" />
                      </div>
                      {link && (
                        <div className="pl-[64px]">
                          <a href={link} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                            <ExternalLink size={10} />Open
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="grid grid-cols-[56px_1fr] items-center gap-2">
                    <span className="text-[10px] text-content-tertiary text-right">Env</span>
                    <Select defaultValue={story.deploy_env ?? ""} onChange={(e) => update({ deploy_env: e.target.value || null })}>
                      <option value="">— select —</option>
                      <option value="staging">Staging</option>
                      <option value="production">Production</option>
                    </Select>
                  </div>
                  {story.deployed_at && (
                    <p className="text-[10px] text-content-tertiary font-mono pl-[64px]">
                      Deployed {dayjs(story.deployed_at).format("MMM D, HH:mm")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Tasks tab ── */}
            {tab === "tasks" && (
              <TasksTab
                storyId={story.id}
                storyKey={story.key}
                agents={agents}
                onRefresh={() => {
                  qc.invalidateQueries({ queryKey: ["tasks", story.id] });
                  qc.invalidateQueries({ queryKey: ["stories"] });
                }}
              />
            )}

            {/* ── Activity tab ── */}
            {tab === "activity" && (
              <div className="flex flex-col gap-5">
                <RunsPanel storyId={story.id} />
                <ActivitiesFeed storyId={story.id} />
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — always visible */}
        <div className="overflow-y-auto scrollbar-column p-4 flex flex-col gap-4 bg-surface-secondary/40">

          {/* Design review gate — agent proposed a plan; human approves before implementation */}
          {story.status === "design_review" && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 flex flex-col gap-2">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-violet-700 flex items-center gap-1.5">
                <ClipboardCheck size={10} />Design Review — approve to start dev
              </p>
              <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-surface-card p-2 text-xs text-content-secondary whitespace-pre-wrap leading-relaxed">
                {story.design || "(no design produced)"}
              </div>
              <div className="flex gap-2">
                <Button variant="accent" size="sm" className="flex-1" onClick={() => update({ status: "in_progress" })}>
                  <Play size={12} />Approve &amp; Implement
                </Button>
                <Button variant="ghost" size="sm" onClick={() => update({ status: "todo", design: null })}>
                  <RotateCw size={12} />Redesign
                </Button>
              </div>
            </div>
          )}

          {/* Execute panel (manual mode) */}
          {story.mode !== "auto" && (
            <ExecutePanel
              story={story}
              canExecute={story.status === "in_progress" && !!story.branch_name && (story.pipeline_mode === 1 || !!story.assigned_agent_id)}
              showPlan={assignedAgent?.role === "techlead" && story.status === "in_progress"}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["stories"] });
                qc.invalidateQueries({ queryKey: ["tasks", story.id] });
              }}
            />
          )}

          {/* Agent */}
          <div className="rounded-lg border border-border bg-surface-card p-3 flex flex-col gap-2">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-accent flex items-center gap-1.5">
              <Bot size={10} />Lead Agent
            </p>
            <Select defaultValue={story.assigned_agent_id ?? ""}
              onChange={(e) => update({ assigned_agent_id: e.target.value || null })}>
              <option value="">— Unassigned —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role ?? a.provider})</option>)}
            </Select>
            {assignedAgent && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-accent-soft border border-accent/20">
                <Bot size={11} className="text-accent shrink-0" />
                <span className="text-xs text-accent font-medium truncate">{assignedAgent.name}</span>
                <span className="font-mono text-[9px] text-accent/70 ml-1 shrink-0">{assignedAgent.role ?? assignedAgent.provider}</span>
              </div>
            )}
            <TaskPipelineView storyId={story.id} onTaskDone={() => qc.invalidateQueries({ queryKey: ["stories"] })} />
          </div>

          {/* Properties */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Properties</p>
            {([
              { label: "Status", control: (
                <Select defaultValue={story.status} onChange={(e) => update({ status: e.target.value as StoryStatus })}>
                  {(Object.keys(STATUS_LABELS) as StoryStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </Select>
              )},
              { label: "Priority", control: (
                <Select defaultValue={story.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
                  <option value="low">Low</option><option value="medium">Medium</option>
                  <option value="high">High</option><option value="urgent">Urgent</option>
                </Select>
              )},
              { label: "Points", control: (
                <Input type="number" min={0} defaultValue={story.story_points ?? ""}
                  onBlur={(e) => update({ story_points: e.target.value ? Number(e.target.value) : null })}
                  placeholder="—" className="h-7 text-xs" />
              )},
              { label: "Type", control: (
                <Select defaultValue={story.type} onChange={(e) => update({ type: e.target.value as StoryType })}>
                  <option value="story">User Story</option><option value="bug">Bug</option>
                  <option value="task">Task</option><option value="spike">Spike</option>
                </Select>
              )},
              { label: "Epic", control: (
                <Select defaultValue={story.epic_id ?? ""} onChange={(e) => update({ epic_id: e.target.value || null })}>
                  <option value="">No epic</option>
                  {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </Select>
              )},
              { label: "Sprint", control: (
                <Select defaultValue={story.sprint_id ?? ""} onChange={(e) => update({ sprint_id: e.target.value || null })}>
                  <option value="">Backlog</option>
                  {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )},
            ] as { label: string; control: React.ReactNode }[]).map(({ label, control }) => (
              <div key={label} className="grid grid-cols-[64px_1fr] items-center gap-2">
                <span className="text-[10px] text-content-tertiary text-right">{label}</span>
                {control}
              </div>
            ))}
          </div>

          {/* Dev */}
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
              <GitBranch size={10} />Development
            </p>
            {story.branch_name ? (
              <div className="flex items-center gap-1.5 rounded bg-surface-secondary px-2 py-1 border border-border">
                <GitBranch size={10} className="text-accent shrink-0" />
                <span className="font-mono text-[10px] text-accent flex-1 truncate">{story.branch_name}</span>
                <button onClick={() => navigator.clipboard.writeText(story.branch_name!)}
                  className="text-content-tertiary hover:text-content-primary transition-colors p-0.5">
                  <Copy size={10} />
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-content-tertiary italic">No branch yet</p>
            )}
            <div className="grid grid-cols-[40px_1fr] items-center gap-2">
              <span className="text-[10px] text-content-tertiary text-right">PR</span>
              <Input defaultValue={story.pr_url ?? ""}
                onBlur={(e) => update({ pr_url: e.target.value || null })}
                placeholder="https://github.com/…/pull/42" className="h-7 text-[10px] font-mono" />
            </div>
            {story.pr_url && (
              <a href={story.pr_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline pl-[48px]">
                <ExternalLink size={10} />Open PR
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Defect-from-QA flow */}
      {reportingDefect && (
        <AddTaskDialog
          storyId={story.id}
          type="defect"
          agents={agents}
          nextSeq={(existingTasks[existingTasks.length - 1]?.seq ?? 0) + 1}
          onClose={() => setReportingDefect(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["tasks", story.id] });
            setReportingDefect(false);
            setTab("tasks");
            toast.success("Defect logged — see Tasks tab");
          }}
        />
      )}
    </Dialog>
  );
}

// ─── Create Story Dialog ──────────────────────────────────────────────────────

function CreateStoryDialog({ open, onClose, projectId, epics, sprints, defaultSprintId }: {
  open: boolean; onClose: () => void; projectId: string;
  epics: Epic[]; sprints: Sprint[]; defaultSprintId?: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: "story" as StoryType, mode: "auto" as StoryMode,
    title: "", as_a: "", i_want: "", so_that: "",
    description: "", acceptance_criteria: "", story_points: "",
    priority: "medium" as Priority, epic_id: "", sprint_id: defaultSprintId ?? "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.stories.create({
      project_id: projectId, type: form.type, mode: form.mode,
      title: form.title || `As a ${form.as_a}, I want ${form.i_want}`,
      as_a: form.as_a || undefined, i_want: form.i_want || undefined,
      so_that: form.so_that || undefined, description: form.description || undefined,
      acceptance_criteria: form.acceptance_criteria || undefined,
      story_points: form.story_points ? Number(form.story_points) : undefined,
      priority: form.priority, epic_id: form.epic_id || undefined,
      sprint_id: form.sprint_id || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
      toast.success(form.mode === "auto" ? "Story created — auto workflow started" : "Story created");
      onClose();
      setForm({ type: "story", mode: "manual", title: "", as_a: "", i_want: "", so_that: "", description: "", acceptance_criteria: "", story_points: "", priority: "medium", epic_id: "", sprint_id: defaultSprintId ?? "" });
    },
    onError: () => toast.error("Failed to create story"),
  });

  const isUserStory = form.type === "story";
  const canSubmit = form.title || (isUserStory && form.as_a && form.i_want);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl max-h-[90vh] overflow-y-auto">
      <div className="mb-3 flex items-center gap-1.5">
        {(["story", "bug", "task", "spike"] as StoryType[]).map((t) => {
          const Icon = TYPE_ICONS[t];
          return (
            <button key={t} onClick={() => set("type", t)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                form.type === t ? "bg-surface-tertiary text-content-primary" : "text-content-tertiary hover:bg-surface-secondary"
              )}>
              <Icon size={12} style={{ color: form.type === t ? TYPE_COLORS[t] : undefined }} />
              {t}
            </button>
          );
        })}
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-1">
        {(["manual", "auto"] as StoryMode[]).map((m) => (
          <button
            key={m}
            onClick={() => set("mode", m)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all border",
              form.mode === m
                ? m === "auto"
                  ? "bg-accent text-white border-accent"
                  : "bg-surface-tertiary text-content-primary border-border"
                : "text-content-tertiary border-transparent hover:border-border"
            )}
          >
            {m === "auto" ? <><Sparkles size={10} />Auto</> : <><Wrench size={10} />Manual</>}
          </button>
        ))}
        {form.mode === "auto" && (
          <span className="text-[10px] text-content-tertiary italic ml-1">
            Tech Lead plans &amp; delegates automatically
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Title {!isUserStory && "*"}</Label>
          <Input placeholder={isUserStory ? "Optional — auto-generated from user story" : "Title *"}
            value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>

        {isUserStory && (
          <div className="rounded-lg border border-border bg-surface-secondary p-4 flex flex-col gap-3">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">User Story</p>
            {[
              { key: "as_a", label: "As a", placeholder: "role / persona..." },
              { key: "i_want", label: "I want", placeholder: "feature or action..." },
              { key: "so_that", label: "So that", placeholder: "benefit or outcome..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="flex gap-2 items-center">
                <span className="text-xs text-content-tertiary w-14 shrink-0">{label}</span>
                <Input value={(form as Record<string, string>)[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Story Points</Label>
            <Input type="number" min={0} placeholder="—" value={form.story_points} onChange={(e) => set("story_points", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Epic</Label>
            <Select value={form.epic_id} onChange={(e) => set("epic_id", e.target.value)}>
              <option value="">No epic</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Sprint</Label>
            <Select value={form.sprint_id} onChange={(e) => set("sprint_id", e.target.value)}>
              <option value="">Backlog</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Acceptance Criteria</Label>
          <Textarea rows={4} value={form.acceptance_criteria} onChange={(e) => set("acceptance_criteria", e.target.value)}
            placeholder={"- [ ] Given... When... Then...\n- [ ] ..."} className="font-mono text-xs" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Board Tab ────────────────────────────────────────────────────────────────

function BoardTab({ projectId, activeSprint, epics, agents, sprints, project }: {
  projectId: string; activeSprint?: Sprint; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "board", activeSprint?.id ?? "none"],
    queryFn: () => activeSprint
      ? api.stories.list({ sprint_id: activeSprint.id })
      : Promise.resolve([]),
    refetchInterval: 10_000,
  });

  const { data: backlogStories = [] } = useQuery({
    queryKey: ["stories", "board-backlog", projectId],
    queryFn: () => api.stories.list({ project_id: projectId, sprint_id: null }),
    refetchInterval: 15_000,
  });

  const addToSprint = useMutation({
    mutationFn: (storyId: string) =>
      api.stories.update(storyId, { sprint_id: activeSprint!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
      toast.success("Added to sprint");
    },
    onError: () => toast.error("Failed to move story"),
  });

  return (
    <>
      {/* Sprint header — shown only when a sprint is active */}
      {activeSprint ? (
        <div className="shrink-0 border-b border-border px-5 py-2.5 flex items-center gap-4 bg-surface-secondary/50">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-green-500 animate-pulse-dot" />
            <span className="text-xs font-semibold text-content-primary">{activeSprint.name}</span>
            {activeSprint.goal && (
              <span className="text-xs text-content-tertiary italic truncate max-w-64">&ldquo;{activeSprint.goal}&rdquo;</span>
            )}
          </div>
          {activeSprint.end_date && (
            <span className="ml-auto font-mono text-[10px] text-content-tertiary shrink-0">
              ends {dayjs(activeSprint.end_date).format("MMM D")}
            </span>
          )}
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1 h-6 px-2.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 shrink-0">
            <Plus size={11} />New
          </button>
        </div>
      ) : (
        <div className="shrink-0 border-b border-border px-5 py-2 flex items-center gap-3 bg-surface-secondary/30">
          <Rocket size={12} className="text-content-tertiary/60 shrink-0" />
          <span className="text-xs text-content-tertiary italic flex-1">No active sprint — backlog stories are shown below. Start a sprint from Sprint Cycles.</span>
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1 h-6 px-2.5 rounded-md border border-border text-xs text-content-secondary hover:bg-surface-tertiary shrink-0">
            <Plus size={11} />New
          </button>
        </div>
      )}

      {/* Kanban columns */}
      <div className="hidden md:grid flex-1 overflow-hidden"
        style={{ gridTemplateColumns: `220px repeat(${BOARD_COLUMNS.length}, minmax(0, 1fr))` }}>

        {/* Backlog column — stories not in any sprint */}
        <div className="flex flex-col border-r border-dashed border-border/70 bg-surface-secondary/30 min-h-0">
          <div className="flex items-center justify-between shrink-0 px-4 pt-3 pb-2.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-tertiary">
              <Layers size={11} strokeWidth={2} className="text-content-tertiary/60" />
              Backlog
            </span>
            <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
              {backlogStories.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-column px-3 pb-3">
            <LayoutGroup>
              <AnimatePresence initial={false} mode="popLayout">
                {backlogStories.map((story) => (
                  <motion.div key={story.id} layout
                    initial={{ opacity: 0, scale: 0.95, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25, layout: { duration: 0.3 } }}
                    className="mb-2 group relative"
                  >
                    <StoryCard story={story} onClick={() => setSelectedStory(story)} />
                    {activeSprint && (
                      <button
                        onClick={(e) => { e.stopPropagation(); addToSprint.mutate(story.id); }}
                        disabled={addToSprint.isPending}
                        title="Add to current sprint"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 h-5 px-1.5 rounded bg-accent text-white text-[10px] font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        <Plus size={9} />Sprint
                      </button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </LayoutGroup>
            {backlogStories.length === 0 && (
              <p className="text-[11px] text-content-tertiary/50 italic text-center pt-4">No backlog items</p>
            )}
          </div>
        </div>

        {/* Active sprint columns */}
        {BOARD_COLUMNS.map(({ status, label, icon: Icon, color }) => {
          const cards = stories.filter((s) => s.status === status);
          const pts = cards.reduce((a, s) => a + (s.story_points ?? 0), 0);
          return (
            <div key={status} className="flex flex-col border-r border-border last:border-r-0 min-h-0">
              <div className="flex items-center justify-between shrink-0 px-4 pt-3 pb-2.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-tertiary">
                  <Icon size={11} strokeWidth={2} style={{ color: activeSprint ? color : undefined }} className={!activeSprint ? "text-content-tertiary/30" : ""} />
                  {label}
                </span>
                <div className="flex items-center gap-1.5">
                  {pts > 0 && <span className="font-mono text-[9px] text-content-tertiary">{pts}p</span>}
                  <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{cards.length}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-column px-3 pb-3">
                {!activeSprint && (
                  <p className="text-[10px] text-content-tertiary/40 italic text-center pt-4">Start a sprint</p>
                )}
                <LayoutGroup>
                  <AnimatePresence initial={false} mode="popLayout">
                    {cards.map((story) => (
                      <motion.div key={story.id} layout
                        initial={{ opacity: 0, scale: 0.95, y: -8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.25, layout: { duration: 0.3 } }}
                        className="mb-2"
                      >
                        <StoryCard story={story} onClick={() => setSelectedStory(story)} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </LayoutGroup>
              </div>
            </div>
          );
        })}
      </div>

      {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} project={project} />}
      <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} defaultSprintId={activeSprint?.id} />
    </>
  );
}

// ─── Backlog Tab — 3 sections ─────────────────────────────────────────────────

function BacklogTab({ projectId, epics, agents, sprints, project }: {
  projectId: string; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: allStories = [] } = useQuery({
    queryKey: ["stories", "project", projectId],
    queryFn: () => api.stories.list({ project_id: projectId }),
  });

  const moveSprint = useMutation({
    mutationFn: ({ storyId, sprintId }: { storyId: string; sprintId: string | null }) =>
      api.stories.update(storyId, { sprint_id: sprintId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stories"] }); },
  });

  const filtered = typeFilter === "all" ? allStories : allStories.filter((s) => s.type === typeFilter);

  const activeSprint = sprints.find((s) => s.status === "active");
  const planningSprints = sprints.filter((s) => s.status === "planning");

  const activeSprintStories = activeSprint ? filtered.filter((s) => s.sprint_id === activeSprint.id) : [];

  const backlogStories = filtered.filter((s) => !s.sprint_id);

  const renderSection = (title: string, stories: (Story & { _sprintName?: string })[], badge?: { label: string; cls: string }) => (
    stories.length > 0 && (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 py-1.5 sticky top-0 bg-surface-primary z-10">
          <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">{title}</span>
          {badge && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>}
          <span className="font-mono text-[10px] text-content-tertiary ml-1">({stories.length})</span>
        </div>
        <div className="flex flex-col gap-1">
          {stories.map((s) => (
            <StoryRow
              key={s.id}
              story={s}
              sprints={sprints}
              onClick={() => setSelectedStory(s)}
              onSprintChange={(sprintId) => moveSprint.mutate({ storyId: s.id, sprintId })}
            />
          ))}
        </div>
      </div>
    )
  );

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-5xl px-5 py-5">
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {(["all", "story", "bug", "task", "spike"] as const).map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={cn("px-2.5 py-1 rounded-md text-xs transition-colors capitalize",
                  typeFilter === t ? "bg-surface-tertiary text-content-primary font-medium" : "text-content-tertiary hover:bg-surface-secondary"
                )}>
                {t}
              </button>
            ))}
          </div>
          <span className="font-mono text-[10px] text-content-tertiary ml-1">{filtered.length} stories</span>
          <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90">
            <Plus size={12} />Add Story
          </button>
        </div>

        <div className="flex flex-col gap-6">
          {renderSection(
            activeSprint ? `Active Sprint — ${activeSprint.name}` : "Active Sprint",
            activeSprintStories,
            { label: "active", cls: "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" }
          )}
          {planningSprints.map((sp) => {
            const sts = filtered.filter((s) => s.sprint_id === sp.id);
            return sts.length > 0 && (
              <div key={sp.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 py-1.5 sticky top-0 bg-surface-primary z-10">
                  <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">{sp.name}</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary border border-border">planning</span>
                  <span className="font-mono text-[10px] text-content-tertiary ml-1">({sts.length})</span>
                </div>
                <div className="flex flex-col gap-1">
                  {sts.map((s) => (
                    <StoryRow key={s.id} story={s} sprints={sprints} onClick={() => setSelectedStory(s)}
                      onSprintChange={(sprintId) => moveSprint.mutate({ storyId: s.id, sprintId })} />
                  ))}
                </div>
              </div>
            );
          })}
          {renderSection("True Backlog", backlogStories)}
          {filtered.length === 0 && (
            <div className="py-16 text-center">
              <ListTodo size={28} className="mx-auto text-content-tertiary mb-3" />
              <p className="text-sm text-content-tertiary">No stories yet</p>
            </div>
          )}
        </div>
      </div>

      {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} project={project} />}
      <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} />
    </div>
  );
}

// ─── Sprints Tab ──────────────────────────────────────────────────────────────

function SprintsTab({ projectId, sprints, epics, agents, project }: {
  projectId: string; sprints: Sprint[]; epics: Epic[]; agents: Agent[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createStorySprintId, setCreateStorySprintId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", goal: "", start_date: "", end_date: "", capacity: "" });
  const { data: allStories = [] } = useQuery({ queryKey: ["stories", "project", projectId], queryFn: () => api.stories.list({ project_id: projectId }) });

  const createSprint = useMutation({
    mutationFn: () => api.sprints.create({
      project_id: projectId, name: form.name, goal: form.goal || undefined,
      start_date: form.start_date || undefined, end_date: form.end_date || undefined,
      capacity: form.capacity ? Number(form.capacity) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints"] });
      toast.success("Sprint created");
      setIsCreating(false);
      setForm({ name: "", goal: "", start_date: "", end_date: "", capacity: "" });
    },
  });
  const startSprint = useMutation({ mutationFn: (id: string) => api.sprints.update(id, { status: "active" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); toast.success("Sprint started!"); } });
  const completeSprint = useMutation({ mutationFn: (id: string) => api.sprints.update(id, { status: "completed" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); toast.success("Sprint completed"); } });
  const deleteSprint = useMutation({ mutationFn: (id: string) => api.sprints.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); } });

  const activeSprint = sprints.find((s) => s.status === "active");

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-content-primary">Sprint Cycles</h2>
            <p className="text-xs text-content-secondary mt-0.5">Setup timeboxes, goal milestones, and dispatch backlogs to active queues.</p>
          </div>
          {!isCreating && (
            <button onClick={() => setIsCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-white hover:opacity-90">
              <Plus size={13} />Define New Sprint
            </button>
          )}
        </div>

        {/* Inline sprint creation form */}
        {isCreating && (
          <div className="mb-5 rounded-xl border border-border bg-surface-card p-5 space-y-4 max-w-xl">
            <div className="flex items-center gap-2 border-b border-border pb-2.5">
              <CalendarDays size={14} className="text-accent" />
              <span className="text-xs font-bold font-mono uppercase tracking-wide text-accent">Configure Sprint</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-content-secondary">Sprint Name *</label>
                <Input placeholder="e.g. Sprint 3: Auth Integrations" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-content-secondary">Story Points Capacity</label>
                <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="12" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-content-secondary">Goal</label>
                <Input placeholder="Sprint goal..." value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-content-secondary font-mono">Start</label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-content-secondary font-mono">End</label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1 border-t border-border/60">
              <button onClick={() => setIsCreating(false)} className="h-7 px-3 text-xs border border-border rounded-md text-content-secondary hover:bg-surface-secondary">Cancel</button>
              <button onClick={() => createSprint.mutate()} disabled={!form.name || createSprint.isPending}
                className="h-7 px-4 text-xs font-bold bg-accent text-white rounded-md hover:opacity-95 disabled:opacity-50">
                Add Sprint
              </button>
            </div>
          </div>
        )}

        {sprints.length === 0 && !isCreating && (
          <div className="py-16 text-center"><CalendarDays size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">No sprints yet</p></div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sprints.map((sprint) => {
            const sts = allStories.filter((s) => s.sprint_id === sprint.id);
            const done = sts.filter((s) => s.status === "done").length;
            const pts = sts.reduce((a, s) => a + (s.story_points ?? 0), 0);
            const pct = sts.length ? Math.round((done / sts.length) * 100) : 0;

            return (
              <div key={sprint.id} className="bg-surface-card border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-content-primary">{sprint.name}</span>
                  <Badge variant={sprint.status === "active" ? "accent" : sprint.status === "completed" ? "success" : "default"}>
                    {sprint.status}
                  </Badge>
                </div>

                {sprint.goal && (
                  <p className="text-xs text-content-secondary italic leading-relaxed line-clamp-2">
                    &ldquo;{sprint.goal}&rdquo;
                  </p>
                )}

                <div className="grid grid-cols-2 gap-1 font-mono text-[10px] text-content-tertiary">
                  <span>Start: <strong>{sprint.start_date || "—"}</strong></span>
                  <span>End: <strong>{sprint.end_date || "—"}</strong></span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between font-mono text-[10px] text-content-secondary">
                    <span>Points: {pts}{sprint.capacity ? `/${sprint.capacity}` : ""}</span>
                    <span>{done}/{sts.length} done ({pct}%)</span>
                  </div>
                  <div className="w-full bg-surface-tertiary h-1.5 rounded-full overflow-hidden">
                    <div className="h-full bg-accent transition-all rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-content-tertiary">{sts.length} tickets</span>
                  <div className="flex items-center gap-1.5">
                    {sprint.status === "planning" && !activeSprint && (
                      <button onClick={() => startSprint.mutate(sprint.id)} className="inline-flex items-center gap-1 h-7 px-3 bg-accent text-white text-xs font-semibold rounded-md hover:opacity-90">
                        <Play size={10} className="fill-current" />Start Sprint
                      </button>
                    )}
                    {sprint.status === "active" && (
                      <button onClick={() => completeSprint.mutate(sprint.id)} className="inline-flex items-center gap-1 h-7 px-3 border border-border text-xs text-content-secondary rounded-md hover:bg-surface-secondary">
                        <CheckCircle2 size={11} />Complete
                      </button>
                    )}
                    {sprint.status !== "active" && (
                      <button onClick={() => deleteSprint.mutate(sprint.id)} className="p-1.5 text-content-tertiary hover:text-error transition-colors rounded">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} project={project} />}
        <CreateStoryDialog open={createStorySprintId !== null} onClose={() => setCreateStorySprintId(null)} projectId={projectId} epics={epics} sprints={sprints} defaultSprintId={createStorySprintId ?? undefined} />
      </div>
    </div>
  );
}

// ─── Epics Tab ────────────────────────────────────────────────────────────────

function CreateEpicDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const COLORS = ["#8B5CF6", "#06b6d4", "#F59E0B", "#22C55E", "#EF4444", "#EC4899"];
  const [form, setForm] = useState({ title: "", description: "", color: "#8B5CF6" });
  const mutation = useMutation({ mutationFn: () => api.epics.create({ project_id: projectId, ...form }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["epics"] }); toast.success("Epic created"); onClose(); setForm({ title: "", description: "", color: "#8B5CF6" }); } });
  return (
    <Dialog open={open} onClose={onClose} title="New Epic">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5"><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>Color</Label><div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))} className="size-6 rounded-full hover:scale-110 transition-transform" style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: "2px" }} />)}</div></div>
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.title || mutation.isPending}>Create</Button></DialogFooter>
    </Dialog>
  );
}

function EpicsTab({ projectId, epics }: { projectId: string; epics: Epic[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-content-tertiary">{epics.length} epics</span>
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90"><Plus size={12} />New Epic</button>
        </div>
        {epics.length === 0 && <div className="py-16 text-center"><Layers size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">No epics yet</p></div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {epics.map((e) => (
            <div key={e.id} className="overflow-hidden rounded-xl border border-border bg-surface-card transition-all hover:-translate-y-px hover:border-border/80">
              <div className="h-[3px]" style={{ background: e.color }} />
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-content-primary">{e.title}</span>
                  <Badge variant={e.status === "open" ? "accent" : "default"} className="ml-auto">{e.status}</Badge>
                </div>
                {e.description && <p className="mt-2 text-xs text-content-secondary line-clamp-2 leading-5">{e.description}</p>}
              </div>
            </div>
          ))}
        </div>
        <CreateEpicDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
      </div>
    </div>
  );
}

// ─── Context Tab ──────────────────────────────────────────────────────────────

function ContextTab({ projectId, localPath }: { projectId: string; localPath: string | null }) {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genLines, setGenLines] = useState<ExecLine[]>([]);
  const [genAgentId, setGenAgentId] = useState("");

  const { data: contexts = [] } = useQuery({
    queryKey: ["contexts", projectId],
    queryFn: () => api.contexts.list(projectId),
    refetchInterval: generating ? 3_000 : false,
  });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });
  const docsAgents = [...agents.filter((a) => a.role === "docs"), ...agents.filter((a) => a.role !== "docs")];

  const saveContext = useMutation({
    mutationFn: ({ section, content }: { section: string; content: string }) =>
      api.contexts.update(projectId, section, { content, updated_by: "human" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contexts", projectId] }); setEditingSection(null); toast.success("Saved"); },
    onError: () => toast.error("Failed to save"),
  });

  const scan = async () => {
    if (!localPath) { toast.error("Set a local path in Settings first"); return; }
    setScanning(true);
    try {
      const result = await api.contexts.scan(projectId);
      qc.invalidateQueries({ queryKey: ["contexts", projectId] });
      toast.success(result.message);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally { setScanning(false); }
  };

  const appendGen = (line: ExecLine) =>
    setGenLines((prev) => {
      if (line.type === "text" && prev.length > 0 && prev[prev.length - 1].type === "text") {
        const up = [...prev];
        up[up.length - 1] = { ...up[up.length - 1], content: up[up.length - 1].content + line.content };
        return up;
      }
      return [...prev, line];
    });

  const generate = async () => {
    if (!genAgentId) { toast.error("Select an agent first"); return; }
    if (!localPath) { toast.error("Set a local path in Settings first"); return; }
    setGenerating(true);
    setGenLines([]);
    try {
      const res = await api.projects.generateContext(projectId, genAgentId);
      if (!res.ok) { appendGen({ type: "error", content: `HTTP ${res.status}` }); setGenerating(false); return; }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim(); if (!json) continue;
          try {
            const evt = JSON.parse(json) as { type: ExecLine["type"]; content?: string; tool?: string };
            appendGen({ type: evt.type, content: evt.content ?? "", tool: evt.tool });
            if (evt.type === "done") {
              qc.invalidateQueries({ queryKey: ["contexts", projectId] });
              toast.success("Context generated");
              setGenerating(false);
              return;
            }
            if (evt.type === "error") { setGenerating(false); return; }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      appendGen({ type: "error", content: e instanceof Error ? e.message : String(e) });
    } finally { setGenerating(false); }
  };

  const sectionMap = new Map(contexts.map((c) => [c.section, c]));
  const orderedSections = [
    ...contexts,
    ...Object.keys(CONTEXT_SECTION_META)
      .filter((k) => !sectionMap.has(k))
      .map((k, i) => ({ id: "", project_id: projectId, section: k, title: CONTEXT_SECTION_META[k].label, content: null, sort_order: contexts.length + i, updated_at: "", updated_by: "" } as ProjectContext)),
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-content-primary">Project Context</h2>
            <p className="mt-0.5 text-xs text-content-tertiary">Knowledge base — agents read this when working on stories</p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* AI generation controls */}
            <select
              value={genAgentId}
              onChange={(e) => setGenAgentId(e.target.value)}
              className="h-8 rounded border border-border bg-surface-secondary text-xs text-content-primary px-2 outline-none focus:border-accent"
            >
              <option value="">— Select agent —</option>
              {docsAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.role === "docs" ? "📚" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={generate}
              disabled={generating || !genAgentId}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Sparkles size={13} className={generating ? "animate-spin" : ""} />
              {generating ? "Generating…" : "Generate with AI"}
            </button>
            <button
              onClick={scan}
              disabled={scanning}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-content-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              <ScanLine size={13} className={scanning ? "animate-spin" : ""} />
              {scanning ? "Scanning…" : "Scan from repo"}
            </button>
          </div>
        </div>

        {/* AI generation output */}
        {genLines.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3 flex flex-col gap-1.5">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5 mb-1">
              <Sparkles size={10} />Documentation Agent
            </p>
            <div className="max-h-40 overflow-y-auto scrollbar-column flex flex-col gap-0.5 font-mono text-[11px]">
              {genLines.map((line, i) => (
                <div key={i} className={
                  line.type === "tool_result" ? "text-amber-800 font-medium" :
                  line.type === "error"       ? "text-red-600" :
                  line.type === "done"        ? "text-green-700 font-medium" :
                  "text-content-secondary"
                }>
                  {line.type === "tool_result" && <span className="mr-1">✓</span>}
                  {line.content}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {orderedSections.map((ctx) => {
            const meta = CONTEXT_SECTION_META[ctx.section];
            const isEditing = editingSection === ctx.section;
            const hasContent = !!ctx.content;

            return (
              <div key={ctx.section} className="overflow-hidden rounded-xl border border-border bg-surface-card">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <FileText size={12} className="text-content-tertiary" />
                    <span className="text-xs font-semibold text-content-primary">{ctx.title}</span>
                    {hasContent && (
                      <span className="font-mono text-[9px] text-content-tertiary">
                        · {ctx.updated_by === "scan" ? "scanned" : "edited"}{ctx.updated_at ? ` ${dayjs(ctx.updated_at).format("MMM D")}` : ""}
                      </span>
                    )}
                  </div>
                  <button onClick={() => { if (isEditing) { setEditingSection(null); } else { setEditContent(ctx.content ?? ""); setEditingSection(ctx.section); } }}
                    className="p-1.5 text-content-tertiary hover:text-accent transition-colors rounded">
                    <Pencil size={12} />
                  </button>
                </div>

                {isEditing ? (
                  <div className="p-4 flex flex-col gap-3">
                    <Textarea rows={12} className="font-mono text-xs leading-relaxed" value={editContent}
                      onChange={(e) => setEditContent(e.target.value)} placeholder={meta?.placeholder ?? "Enter content..."} />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingSection(null)}>Cancel</Button>
                      <Button variant="accent" size="sm"
                        onClick={() => saveContext.mutate({ section: ctx.section, content: editContent })}
                        disabled={saveContext.isPending}>
                        <Save size={12} />Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    {hasContent ? (
                      <div className="markdown-body max-h-40 overflow-y-auto scrollbar-column">
                        <pre className="text-xs text-content-secondary leading-relaxed whitespace-pre-wrap font-mono">
                          {ctx.content}
                        </pre>
                      </div>
                    ) : (
                      <button onClick={() => { setEditContent(""); setEditingSection(ctx.section); }}
                        className="flex items-center gap-2 text-xs text-content-tertiary hover:text-accent transition-colors py-2">
                        <Plus size={12} />Add {meta?.label.toLowerCase() ?? ctx.section}…
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ project }: { project: {
  id: string; name: string; key: string; description: string | null;
  color: string; local_path: string | null; github_url: string | null;
  tech_stack: string | null; definition_of_done: string | null;
}}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    name: project.name, description: project.description ?? "",
    local_path: project.local_path ?? "", github_url: project.github_url ?? "",
    tech_stack: project.tech_stack ?? "", definition_of_done: project.definition_of_done ?? "",
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.projects.delete(project.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project deleted"); navigate("/"); },
    onError: () => toast.error("Failed to delete project"),
  });

  const mutation = useMutation({
    mutationFn: () => api.projects.update(project.id, {
      name: form.name, description: form.description || undefined,
      local_path: form.local_path || undefined, github_url: form.github_url || undefined,
      tech_stack: form.tech_stack || undefined, definition_of_done: form.definition_of_done || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", project.id] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Settings saved"); },
    onError: () => toast.error("Failed to save"),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-2xl px-5 py-7">
        <h2 className="mb-5 text-sm font-bold text-content-primary">Project Settings</h2>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Basic Info</p>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 w-28"><Label>Key</Label><Input value={project.key} disabled className="opacity-40" /></div>
              <div className="flex flex-col gap-1.5 flex-1"><Label>Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this project about?" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tech Stack <span className="font-normal text-content-tertiary">(comma-separated)</span></Label>
              <Input value={form.tech_stack} onChange={(e) => set("tech_stack", e.target.value)} placeholder="React, TypeScript, Node.js..." />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Repository Connection</p>
            <div className="flex flex-col gap-1.5">
              <Label><FolderOpen size={13} />Local Path</Label>
              <Input value={form.local_path} onChange={(e) => set("local_path", e.target.value)} placeholder="/Users/you/projects/my-project" />
              <p className="text-[11px] text-content-tertiary">Used for scanning project files into Context sections</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label><ExternalLink size={13} />GitHub URL</Label>
              <Input value={form.github_url} onChange={(e) => set("github_url", e.target.value)} placeholder="https://github.com/org/repo" />
            </div>
            {form.github_url && (
              <a href={form.github_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                <ExternalLink size={11} />Open on GitHub
              </a>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">Definition of Done</p>
            <p className="text-xs text-content-tertiary">Applied to all stories unless overridden per story</p>
            <Textarea rows={5} value={form.definition_of_done} onChange={(e) => set("definition_of_done", e.target.value)}
              placeholder={"- [ ] Tests written and passing\n- [ ] Code reviewed\n- [ ] Deployed to staging"} className="font-mono text-xs" />
          </section>

          <div className="flex justify-end border-t border-border pt-4">
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              <Save size={13} />{mutation.isPending ? "Saving…" : "Save Settings"}
            </button>
          </div>

          <section className="flex flex-col gap-3 rounded-xl border border-error/30 p-4">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-error/80">Danger Zone</p>
            {confirmDelete ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-content-secondary">
                  Permanently delete <span className="font-semibold text-content-primary">{project.name}</span> and all its stories, epics, and sprints. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs text-content-secondary hover:text-content-primary">Cancel</button>
                  <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
                    className="flex-1 rounded-md bg-error px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {deleteMutation.isPending ? "Deleting…" : "Yes, delete project"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-xs text-content-secondary">Permanently delete this project and all its data.</p>
                <button onClick={() => setConfirmDelete(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-error/40 px-3 text-xs text-error hover:bg-error/10 transition-colors">
                  <Trash2 size={12} />Delete project
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Project View Page ────────────────────────────────────────────────────────

export function ProjectViewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.projects.get(projectId!), enabled: !!projectId });
  const { data: epics = [] } = useQuery({ queryKey: ["epics", projectId], queryFn: () => api.epics.list(projectId!), enabled: !!projectId });
  const { data: sprints = [] } = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.sprints.list(projectId!), enabled: !!projectId });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  const activeSprint = sprints.find((s) => s.status === "active");

  if (!project || !projectId) return null;

  const path = location.pathname;
  const tab = path.includes("/backlog") ? "backlog"
    : path.includes("/sprints") ? "sprints"
    : path.includes("/epics") ? "epics"
    : path.includes("/context") ? "context"
    : path.includes("/settings") ? "settings"
    : "board";

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {tab === "board" && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <BoardTab projectId={projectId} activeSprint={activeSprint} epics={epics} agents={agents} sprints={sprints} project={project} />
        </div>
      )}
      {tab === "backlog"  && <BacklogTab  projectId={projectId} epics={epics} agents={agents} sprints={sprints} project={project} />}
      {tab === "sprints"  && <SprintsTab  projectId={projectId} sprints={sprints} epics={epics} agents={agents} project={project} />}
      {tab === "epics"    && <EpicsTab    projectId={projectId} epics={epics} />}
      {tab === "context"  && <ContextTab  projectId={projectId} localPath={project.local_path} />}
      {tab === "settings" && <SettingsTab project={project} />}
    </div>
  );
}
