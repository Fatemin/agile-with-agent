import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Bot, Bug, CalendarDays, CheckCircle2, Circle,
  Clock3, ExternalLink, FileText, FolderOpen, Layers,
  Lightbulb, ListTodo, Pencil, Plus, Rocket, RotateCw,
  Save, ScanLine, Settings, Trash2, Wrench,
} from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
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
import type {
  Agent, Epic, Priority,
  ProjectContext, Sprint, Story, StoryStatus, StoryType,
} from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#A1A1AA", medium: "#71717A", high: "#F59E0B", urgent: "#EF4444",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};

const TYPE_ICONS: Record<StoryType, React.ElementType> = {
  story: ListTodo, bug: Bug, task: Wrench, spike: Lightbulb,
};

const TYPE_COLORS: Record<StoryType, string> = {
  story: "#0891B2", bug: "#EF4444", task: "#8B5CF6", spike: "#F59E0B",
};

const BOARD_COLUMNS: { status: StoryStatus; label: string; icon: React.ElementType }[] = [
  { status: "todo",        label: "Todo",        icon: Circle },
  { status: "in_progress", label: "In Progress",  icon: RotateCw },
  { status: "in_review",   label: "In Review",    icon: Clock3 },
  { status: "done",        label: "Done",         icon: CheckCircle2 },
];

const STATUS_LABELS: Record<StoryStatus, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress",
  in_review: "In Review", done: "Done",
};

const CONTEXT_SECTION_META: Record<string, { label: string; placeholder: string }> = {
  overview:      { label: "Project Overview",       placeholder: "Describe what this project is, its goals, and target users..." },
  prd:           { label: "Product Requirements",   placeholder: "Features, user flows, acceptance criteria at the product level..." },
  design_system: { label: "Design System",          placeholder: "Colors, typography, component patterns, layout rules..." },
  data_model:    { label: "Data Model",             placeholder: "Database schema, entities, relationships..." },
  architecture:  { label: "Architecture & Tech Stack", placeholder: "System design, tech choices, infrastructure..." },
  conventions:   { label: "Coding Conventions",     placeholder: "Code style, patterns, file structure, naming rules..." },
  glossary:      { label: "Domain Glossary",        placeholder: "Key terms and definitions used in this project..." },
};

// ─── Story Card ───────────────────────────────────────────────────────────────

function StoryCard({ story, onClick }: { story: Story; onClick: () => void }) {
  const isActive = story.status === "in_progress" && !!story.assigned_agent_id;
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
          ? "border-accent/25 shadow-[0_0_16px_var(--accent-glow)]"
          : "border-border hover:border-content-tertiary"
      )}
    >
      <div className="flex items-start gap-1.5">
        <TypeIcon size={12} className="mt-0.5 shrink-0" style={{ color: TYPE_COLORS[story.type] }} />
        <span className="font-mono text-[11px] leading-snug text-content-tertiary shrink-0">{story.key}</span>
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-content-primary flex-1 min-w-0">
          {story.title}
        </p>
      </div>

      {story.epic_title && (
        <div className="mt-1.5 pl-5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px]"
            style={{ backgroundColor: `${story.epic_color}15`, color: story.epic_color ?? "#0891B2" }}
          >
            {story.epic_title}
          </span>
        </div>
      )}

      <div className="mt-2 pl-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
          {story.story_points != null && (
            <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary rounded px-1">
              {story.story_points}p
            </span>
          )}
        </div>
        {story.agent_name && (
          <div className={cn("flex items-center gap-1", isActive ? "text-accent" : "text-content-tertiary")}>
            {isActive && <span className="size-1.5 rounded-full bg-accent animate-[pulse-dot_2s_ease-in-out_infinite]" />}
            <Bot size={11} />
            <span className="font-mono text-[11px] truncate max-w-[7rem]">{story.agent_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Story Detail Dialog ──────────────────────────────────────────────────────

function StoryDialog({ story, onClose, epics, agents, sprints, project }: {
  story: Story; onClose: () => void;
  epics: Epic[]; agents: Agent[]; sprints: Sprint[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const update = (patch: Partial<Story>) =>
    api.stories.update(story.id, patch)
      .then(() => qc.invalidateQueries({ queryKey: ["stories"] }))
      .catch(() => toast.error("Failed to update"));

  const TypeIcon = TYPE_ICONS[story.type] ?? ListTodo;

  return (
    <Dialog open onClose={onClose} className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex flex-col gap-5">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <TypeIcon size={14} style={{ color: TYPE_COLORS[story.type] }} />
          <span className="font-mono text-[11px] text-content-tertiary">{story.key}</span>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
          <span className="text-xs text-content-tertiary">{PRIORITY_LABELS[story.priority]}</span>
        </div>

        <h2 className="text-base font-semibold text-content-primary">{story.title}</h2>

        {/* Metadata grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select defaultValue={story.type} onChange={(e) => update({ type: e.target.value as StoryType })}>
              <option value="story">User Story</option>
              <option value="bug">Bug</option>
              <option value="task">Task</option>
              <option value="spike">Spike</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select defaultValue={story.status} onChange={(e) => update({ status: e.target.value as StoryStatus })}>
              {(Object.keys(STATUS_LABELS) as StoryStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select defaultValue={story.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Story Points</Label>
            <Input type="number" min={0} defaultValue={story.story_points ?? ""}
              onBlur={(e) => update({ story_points: e.target.value ? Number(e.target.value) : null })} placeholder="—" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Epic</Label>
            <Select defaultValue={story.epic_id ?? ""} onChange={(e) => update({ epic_id: e.target.value || null })}>
              <option value="">No epic</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Sprint</Label>
            <Select defaultValue={story.sprint_id ?? ""} onChange={(e) => update({ sprint_id: e.target.value || null })}>
              <option value="">Backlog</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 col-span-3">
            <Label>Assigned Agent</Label>
            <Select defaultValue={story.assigned_agent_id ?? ""} onChange={(e) => update({ assigned_agent_id: e.target.value || null })}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}
            </Select>
          </div>
        </div>

        {/* User Story format */}
        <div className="rounded-lg border border-border bg-surface-secondary p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">User Story</p>
          <div className="flex gap-2 items-start">
            <span className="text-xs font-medium text-content-tertiary w-16 pt-1.5 shrink-0">As a</span>
            <Input defaultValue={story.as_a ?? ""}
              onBlur={(e) => update({ as_a: e.target.value || null })} placeholder="product owner / developer / user..." />
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-xs font-medium text-content-tertiary w-16 pt-1.5 shrink-0">I want</span>
            <Input defaultValue={story.i_want ?? ""}
              onBlur={(e) => update({ i_want: e.target.value || null })} placeholder="to view a dashboard with..." />
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-xs font-medium text-content-tertiary w-16 pt-1.5 shrink-0">So that</span>
            <Input defaultValue={story.so_that ?? ""}
              onBlur={(e) => update({ so_that: e.target.value || null })} placeholder="I can track progress without..." />
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea rows={3} defaultValue={story.description ?? ""}
            onBlur={(e) => update({ description: e.target.value || null })}
            placeholder="Additional technical context, mockup links, implementation notes..." />
        </div>

        {/* Acceptance Criteria */}
        <div className="flex flex-col gap-1.5">
          <Label>Acceptance Criteria</Label>
          <Textarea rows={5} defaultValue={story.acceptance_criteria ?? ""}
            onBlur={(e) => update({ acceptance_criteria: e.target.value || null })}
            placeholder={"- [ ] Given... When... Then...\n- [ ] Given... When... Then..."} />
        </div>

        {/* Definition of Done */}
        <div className="flex flex-col gap-1.5">
          <Label>
            Definition of Done
            {project.definition_of_done && !story.definition_of_done && (
              <span className="ml-2 text-[10px] text-content-tertiary font-normal">(inherits from project)</span>
            )}
          </Label>
          <Textarea rows={3}
            defaultValue={story.definition_of_done ?? project.definition_of_done ?? ""}
            onBlur={(e) => update({ definition_of_done: e.target.value || null })}
            placeholder={"- [ ] Tests written and passing\n- [ ] PR reviewed\n- [ ] Deployed to staging"} />
        </div>
      </div>
      <DialogFooter className="border-t border-border mt-5 pt-4">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </DialogFooter>
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
    type: "story" as StoryType, title: "", as_a: "", i_want: "", so_that: "",
    description: "", acceptance_criteria: "", story_points: "",
    priority: "medium" as Priority, epic_id: "", sprint_id: defaultSprintId ?? "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.stories.create({
      project_id: projectId, type: form.type,
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
      toast.success("Story created");
      onClose();
      setForm({ type: "story", title: "", as_a: "", i_want: "", so_that: "", description: "", acceptance_criteria: "", story_points: "", priority: "medium", epic_id: "", sprint_id: defaultSprintId ?? "" });
    },
    onError: () => toast.error("Failed to create story"),
  });

  const isUserStory = form.type === "story";
  const canSubmit = form.title || (isUserStory && form.as_a && form.i_want);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl max-h-[90vh] overflow-y-auto">
      <div className="mb-3 flex items-center gap-2">
        {(["story", "bug", "task", "spike"] as StoryType[]).map((t) => {
          const Icon = TYPE_ICONS[t];
          return (
            <button key={t} onClick={() => set("type", t)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                form.type === t ? "bg-surface-tertiary text-content-primary" : "text-content-tertiary hover:bg-surface-secondary"
              )}
            >
              <Icon size={12} style={{ color: form.type === t ? TYPE_COLORS[t] : undefined }} />
              {t}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Title {!isUserStory && "*"}</Label>
          <Input placeholder={isUserStory ? "Optional — auto-generated from user story" : "Title *"}
            value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>

        {isUserStory && (
          <div className="rounded-lg border border-border bg-surface-secondary p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">User Story</p>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-content-tertiary w-16 shrink-0">As a</span>
              <Input value={form.as_a} onChange={(e) => set("as_a", e.target.value)} placeholder="role / persona..." />
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-content-tertiary w-16 shrink-0">I want</span>
              <Input value={form.i_want} onChange={(e) => set("i_want", e.target.value)} placeholder="feature or action..." />
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-content-tertiary w-16 shrink-0">So that</span>
              <Input value={form.so_that} onChange={(e) => set("so_that", e.target.value)} placeholder="benefit or outcome..." />
            </div>
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
            placeholder={"- [ ] Given... When... Then...\n- [ ] ..."} />
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
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createCol, setCreateCol] = useState<StoryStatus | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "board", activeSprint?.id ?? "none"],
    queryFn: () => activeSprint
      ? api.stories.list({ sprint_id: activeSprint.id })
      : api.stories.list({ project_id: projectId, sprint_id: null }),
    refetchInterval: 10_000,
  });

  if (!activeSprint) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-content-tertiary">
        <Rocket size={32} />
        <p className="text-sm text-content-secondary">No active sprint — start one from the Sprints tab</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:grid flex-1 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(0, 1fr))` }}>
        {BOARD_COLUMNS.map(({ status, label, icon: Icon }) => {
          const cards = stories.filter((s) => s.status === status);
          return (
            <div key={status} className="flex flex-col border-r border-border last:border-r-0 min-h-0">
              <div className="flex items-center justify-between shrink-0 px-4 pt-4 pb-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
                  <Icon size={13} strokeWidth={2} />
                  {label}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{cards.length}</span>
                  {status === "todo" && (
                    <button onClick={() => setCreateCol(status)} className="ml-1 text-content-tertiary hover:text-accent transition-colors">
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-column px-4 pb-4">
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
      <CreateStoryDialog open={createCol !== null} onClose={() => setCreateCol(null)} projectId={projectId} epics={epics} sprints={sprints} defaultSprintId={activeSprint.id} />
    </>
  );
}

// ─── Backlog Tab ──────────────────────────────────────────────────────────────

function BacklogTab({ projectId, epics, agents, sprints, project }: {
  projectId: string; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
  project: { definition_of_done: string | null };
}) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "backlog", projectId],
    queryFn: () => api.stories.list({ project_id: projectId, sprint_id: null }),
  });

  const filtered = typeFilter === "all" ? stories : stories.filter((s) => s.type === typeFilter);
  const noEpic = filtered.filter((s) => !s.epic_id);
  const byEpic = epics.map((e) => ({ epic: e, sts: filtered.filter((s) => s.epic_id === e.id) })).filter((g) => g.sts.length > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-xs text-content-tertiary">{stories.length} stories in backlog</span>
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
          <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90">
            <Plus size={12} />Add Story
          </button>
        </div>

        {filtered.length === 0 && (
          <div className="py-16 text-center"><ListTodo size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">Backlog is empty</p></div>
        )}

        <div className="flex flex-col gap-5">
          {byEpic.map(({ epic, sts }) => (
            <div key={epic.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: epic.color }} />
                <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">{epic.title}</span>
                <span className="font-mono text-[10px] text-content-tertiary">({sts.length})</span>
              </div>
              <div className="flex flex-col gap-1.5 pl-4" style={{ borderLeft: `2px solid ${epic.color}30` }}>
                {sts.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
              </div>
            </div>
          ))}
          {noEpic.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">No Epic</span>
                <span className="font-mono text-[10px] text-content-tertiary">({noEpic.length})</span>
              </div>
              <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-border">
                {noEpic.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
              </div>
            </div>
          )}
        </div>

        {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} project={project} />}
        <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} />
      </div>
    </div>
  );
}

// ─── Sprints Tab ──────────────────────────────────────────────────────────────

function CreateSprintDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", goal: "", start_date: "", end_date: "", capacity: "" });
  const mutation = useMutation({
    mutationFn: () => api.sprints.create({ project_id: projectId, name: form.name, goal: form.goal || undefined, start_date: form.start_date || undefined, end_date: form.end_date || undefined, capacity: form.capacity ? Number(form.capacity) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); toast.success("Sprint created"); onClose(); setForm({ name: "", goal: "", start_date: "", end_date: "", capacity: "" }); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="New Sprint">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5"><Label>Name *</Label><Input placeholder="Sprint 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>Goal</Label><Input placeholder="Sprint goal..." value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5"><Label>Start</Label><Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label>End</Label><Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label>Capacity (pts)</Label><Input type="number" min={0} placeholder="—" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

function SprintsTab({ projectId, sprints, epics, agents, project }: {
  projectId: string; sprints: Sprint[]; epics: Epic[]; agents: Agent[];
  project: { definition_of_done: string | null };
}) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createStorySprintId, setCreateStorySprintId] = useState<string | null>(null);
  const { data: allStories = [] } = useQuery({ queryKey: ["stories", "project", projectId], queryFn: () => api.stories.list({ project_id: projectId }) });

  const startSprint = useMutation({ mutationFn: (id: string) => api.sprints.update(id, { status: "active" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); toast.success("Sprint started!"); } });
  const completeSprint = useMutation({ mutationFn: (id: string) => api.sprints.update(id, { status: "completed" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); toast.success("Sprint completed"); } });
  const deleteSprint = useMutation({ mutationFn: (id: string) => api.sprints.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); } });

  const activeSprint = sprints.find((s) => s.status === "active");

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-content-tertiary">{sprints.length} sprints</span>
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90"><Plus size={12} />New Sprint</button>
        </div>
        {sprints.length === 0 && (
          <div className="py-16 text-center"><CalendarDays size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">No sprints yet</p></div>
        )}
        <div className="flex flex-col gap-4">
          {sprints.map((sprint) => {
            const sts = allStories.filter((s) => s.sprint_id === sprint.id);
            const done = sts.filter((s) => s.status === "done").length;
            const pts = sts.reduce((a, s) => a + (s.story_points ?? 0), 0);
            const pct = sprint.capacity ? Math.min(100, Math.round((done / sts.length || 0) * 100)) : null;
            return (
              <div key={sprint.id} className="overflow-hidden rounded-lg border border-border bg-surface-secondary">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <Badge variant={sprint.status === "active" ? "accent" : sprint.status === "completed" ? "success" : "default"}>{sprint.status}</Badge>
                    <span className="font-medium text-sm text-content-primary">{sprint.name}</span>
                    {sprint.goal && <span className="text-xs text-content-secondary truncate max-w-48">— {sprint.goal}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-content-tertiary">{done}/{sts.length} done · {pts}{sprint.capacity ? `/${sprint.capacity}` : ""}p</span>
                    {sprint.start_date && <span className="font-mono text-[10px] text-content-tertiary">{dayjs(sprint.start_date).format("MMM D")}–{sprint.end_date ? dayjs(sprint.end_date).format("MMM D") : "?"}</span>}
                    {sprint.status === "planning" && !activeSprint && (
                      <button onClick={() => startSprint.mutate(sprint.id)} className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-xs font-medium text-surface-primary hover:opacity-90"><Rocket size={10} />Start</button>
                    )}
                    {sprint.status === "active" && (
                      <button onClick={() => completeSprint.mutate(sprint.id)} className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-xs text-content-secondary hover:bg-surface-tertiary"><CheckCircle2 size={10} />Complete</button>
                    )}
                    {sprint.status !== "active" && (
                      <button onClick={() => deleteSprint.mutate(sprint.id)} className="p-1 text-content-tertiary hover:text-error transition-colors"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
                {pct !== null && <div className="h-0.5 bg-surface-tertiary"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
                <div className="px-4 py-3 flex flex-col gap-1.5">
                  {sts.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
                  <button onClick={() => setCreateStorySprintId(sprint.id)} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-content-tertiary hover:border-accent/40 hover:text-accent transition-colors">
                    <Plus size={12} />Add story
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <CreateSprintDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
        <CreateStoryDialog open={createStorySprintId !== null} onClose={() => setCreateStorySprintId(null)} projectId={projectId} epics={epics} sprints={sprints} defaultSprintId={createStorySprintId ?? undefined} />
        {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} project={project} />}
      </div>
    </div>
  );
}

// ─── Epics Tab ────────────────────────────────────────────────────────────────

function CreateEpicDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const COLORS = ["#8B5CF6", "#0891B2", "#F59E0B", "#22C55E", "#EF4444", "#EC4899"];
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
      <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-content-tertiary">{epics.length} epics</span>
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90"><Plus size={12} />New Epic</button>
        </div>
        {epics.length === 0 && <div className="py-16 text-center"><Layers size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">No epics yet</p></div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {epics.map((e) => (
            <div key={e.id} className="overflow-hidden rounded-lg border border-border bg-surface-secondary transition-all hover:-translate-y-px">
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

  const { data: contexts = [] } = useQuery({
    queryKey: ["contexts", projectId],
    queryFn: () => api.contexts.list(projectId),
  });

  const saveContext = useMutation({
    mutationFn: ({ section, content }: { section: string; content: string }) =>
      api.contexts.update(projectId, section, { content, updated_by: "human" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts", projectId] });
      setEditingSection(null);
      toast.success("Saved");
    },
    onError: () => toast.error("Failed to save"),
  });

  const scan = async () => {
    if (!localPath) {
      toast.error("Set a local path in Settings first");
      return;
    }
    setScanning(true);
    try {
      const result = await api.contexts.scan(projectId);
      qc.invalidateQueries({ queryKey: ["contexts", projectId] });
      toast.success(result.message);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  // Build a section map, preserving order and filling in any missing from CONTEXT_SECTION_META
  const sectionMap = new Map(contexts.map((c) => [c.section, c]));
  const orderedSections = [
    ...contexts,
    ...Object.keys(CONTEXT_SECTION_META)
      .filter((k) => !sectionMap.has(k))
      .map((k, i) => ({ id: "", project_id: projectId, section: k, title: CONTEXT_SECTION_META[k].label, content: null, sort_order: contexts.length + i, updated_at: "", updated_by: "" } as ProjectContext)),
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-content-primary">Project Context</h2>
            <p className="mt-0.5 text-xs text-content-tertiary">
              Project knowledge base — agents read this when working on stories
            </p>
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-content-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
          >
            <ScanLine size={13} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : "Scan from repo"}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {orderedSections.map((ctx) => {
            const meta = CONTEXT_SECTION_META[ctx.section];
            const isEditing = editingSection === ctx.section;
            const hasContent = !!ctx.content;

            return (
              <div key={ctx.section} className="overflow-hidden rounded-lg border border-border bg-surface-secondary">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <FileText size={13} className="text-content-tertiary" />
                    <span className="text-sm font-medium text-content-primary">{ctx.title}</span>
                    {hasContent && (
                      <span className="font-mono text-[10px] text-content-tertiary">
                        · updated {ctx.updated_by === "scan" ? "by scan" : "manually"}
                        {ctx.updated_at ? ` ${dayjs(ctx.updated_at).format("MMM D")}` : ""}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (isEditing) {
                        setEditingSection(null);
                      } else {
                        setEditContent(ctx.content ?? "");
                        setEditingSection(ctx.section);
                      }
                    }}
                    className="p-1.5 text-content-tertiary hover:text-accent transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                </div>

                {isEditing ? (
                  <div className="p-4 flex flex-col gap-3">
                    <Textarea
                      rows={12}
                      className="font-mono text-xs leading-relaxed"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder={meta?.placeholder ?? "Enter content..."}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingSection(null)}>Cancel</Button>
                      <Button variant="accent" size="sm"
                        onClick={() => saveContext.mutate({ section: ctx.section, content: editContent })}
                        disabled={saveContext.isPending}
                      >
                        <Save size={12} />Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    {hasContent ? (
                      <pre className="text-xs text-content-secondary leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto scrollbar-column">
                        {ctx.content}
                      </pre>
                    ) : (
                      <button
                        onClick={() => { setEditContent(""); setEditingSection(ctx.section); }}
                        className="flex items-center gap-2 text-xs text-content-tertiary hover:text-accent transition-colors py-2"
                      >
                        <Plus size={12} />
                        Add {meta?.label.toLowerCase() ?? ctx.section}…
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
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    local_path: project.local_path ?? "",
    github_url: project.github_url ?? "",
    tech_stack: project.tech_stack ?? "",
    definition_of_done: project.definition_of_done ?? "",
  });

  const mutation = useMutation({
    mutationFn: () => api.projects.update(project.id, {
      name: form.name,
      description: form.description || undefined,
      local_path: form.local_path || undefined,
      github_url: form.github_url || undefined,
      tech_stack: form.tech_stack || undefined,
      definition_of_done: form.definition_of_done || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save"),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-2xl px-6 py-8 sm:px-8">
        <h2 className="mb-6 text-sm font-semibold text-content-primary">Project Settings</h2>

        <div className="flex flex-col gap-6">
          {/* Basic Info */}
          <section className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">Basic Info</p>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 w-28">
                <Label>Key</Label>
                <Input value={project.key} disabled className="opacity-50" />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this project about?" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tech Stack <span className="font-normal text-content-tertiary">(comma-separated tags)</span></Label>
              <Input value={form.tech_stack} onChange={(e) => set("tech_stack", e.target.value)} placeholder="React, TypeScript, Node.js, PostgreSQL..." />
            </div>
          </section>

          {/* Repository Connections */}
          <section className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">Repository Connection</p>
            <div className="flex flex-col gap-1.5">
              <Label><FolderOpen size={13} />Local Path</Label>
              <Input
                value={form.local_path}
                onChange={(e) => set("local_path", e.target.value)}
                placeholder="C:\Users\you\projects\my-project or /Users/you/projects/my-project"
              />
              <p className="text-[11px] text-content-tertiary">Used for scanning project files into Context sections</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label><ExternalLink size={13} />GitHub URL</Label>
              <Input
                value={form.github_url}
                onChange={(e) => set("github_url", e.target.value)}
                placeholder="https://github.com/org/repo"
              />
            </div>
            {form.github_url && (
              <a href={form.github_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                <ExternalLink size={11} />Open on GitHub
              </a>
            )}
          </section>

          {/* Definition of Done */}
          <section className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">Definition of Done</p>
            <p className="text-xs text-content-tertiary">Applied to all stories in this project unless overridden per story</p>
            <Textarea rows={5} value={form.definition_of_done} onChange={(e) => set("definition_of_done", e.target.value)}
              placeholder={"- [ ] Unit tests written and passing\n- [ ] Code reviewed\n- [ ] Documentation updated\n- [ ] Deployed to staging"} />
          </section>

          <div className="flex justify-end border-t border-border pt-4">
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-surface-primary hover:opacity-90 disabled:opacity-50"
            >
              <Save size={13} />
              {mutation.isPending ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Project View Page ────────────────────────────────────────────────────────

type Tab = "board" | "backlog" | "sprints" | "epics" | "context" | "settings";

const TABS: { id: Tab; label: string; icon?: React.ElementType }[] = [
  { id: "board",    label: "Board" },
  { id: "backlog",  label: "Backlog" },
  { id: "sprints",  label: "Sprints" },
  { id: "epics",    label: "Epics" },
  { id: "context",  label: "Context",  icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

export function ProjectViewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("board");

  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.projects.get(projectId!), enabled: !!projectId });
  const { data: epics = [] } = useQuery({ queryKey: ["epics", projectId], queryFn: () => api.epics.list(projectId!), enabled: !!projectId });
  const { data: sprints = [] } = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.sprints.list(projectId!), enabled: !!projectId });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  const activeSprint = sprints.find((s) => s.status === "active");

  if (!project || !projectId) return null;

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {/* Sub-nav */}
      <div className="border-b border-border bg-surface-secondary px-5 shrink-0 flex items-center gap-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-xs transition-colors border-b-2 -mb-px",
              tab === id
                ? "border-accent text-accent font-medium"
                : "border-transparent text-content-tertiary hover:text-content-secondary"
            )}
          >
            {Icon && <Icon size={12} />}
            {label}
            {id === "board" && activeSprint && <span className="ml-0.5 text-accent">●</span>}
          </button>
        ))}
        {tab === "board" && activeSprint && (
          <div className="ml-auto flex items-center gap-3 pr-1 shrink-0">
            <span className="text-xs text-content-secondary">{activeSprint.name}</span>
            {activeSprint.end_date && (
              <span className="font-mono text-[10px] text-content-tertiary">ends {dayjs(activeSprint.end_date).format("MMM D")}</span>
            )}
          </div>
        )}
      </div>

      {/* Tab content */}
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
