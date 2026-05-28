import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Bot, CalendarDays, CheckCircle2, Circle,
  Clock3, Layers, ListTodo, Plus, Rocket, RotateCw, Trash2,
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
import type { Agent, Epic, Priority, Sprint, Story, StoryStatus } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#A1A1AA", medium: "#71717A", high: "#F59E0B", urgent: "#EF4444",
};

const BOARD_COLUMNS: { status: StoryStatus; label: string; icon: React.ElementType }[] = [
  { status: "todo",        label: "Todo",       icon: Circle },
  { status: "in_progress", label: "In Progress", icon: RotateCw },
  { status: "in_review",   label: "In Review",   icon: Clock3 },
  { status: "done",        label: "Done",        icon: CheckCircle2 },
];

const STATUS_LABELS: Record<StoryStatus, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress",
  in_review: "In Review", done: "Done",
};

// ─── Story Card ───────────────────────────────────────────────────────────────

function StoryCard({ story, onClick }: { story: Story; onClick: () => void }) {
  const isActive = story.status === "in_progress" && !!story.assigned_agent_id;

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
        <span className="font-mono text-[11px] leading-snug text-content-tertiary shrink-0">{story.key}</span>
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-content-primary flex-1 min-w-0">
          {story.title}
        </p>
      </div>

      {story.epic_title && (
        <div className="mt-1.5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px]"
            style={{ backgroundColor: `${story.epic_color}15`, color: story.epic_color ?? "var(--accent)" }}
          >
            {story.epic_title}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
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
            <span className="font-mono text-[11px] truncate max-w-[6rem]">{story.agent_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function CreateStoryDialog({ open, onClose, projectId, epics, sprints, defaultSprintId }: {
  open: boolean; onClose: () => void; projectId: string;
  epics: Epic[]; sprints: Sprint[]; defaultSprintId?: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: "", description: "", acceptance_criteria: "", story_points: "",
    priority: "medium", epic_id: "", sprint_id: defaultSprintId ?? "",
  });
  const mutation = useMutation({
    mutationFn: () => api.stories.create({
      project_id: projectId, title: form.title,
      description: form.description || undefined,
      acceptance_criteria: form.acceptance_criteria || undefined,
      story_points: form.story_points ? Number(form.story_points) : undefined,
      priority: form.priority,
      epic_id: form.epic_id || undefined,
      sprint_id: form.sprint_id || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] }); toast.success("Story created"); onClose();
      setForm({ title: "", description: "", acceptance_criteria: "", story_points: "", priority: "medium", epic_id: "", sprint_id: defaultSprintId ?? "" });
    },
    onError: () => toast.error("Failed to create story"),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New User Story" className="max-w-xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Title *</Label>
          <Input placeholder="As a user, I want to..." value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Story Points</Label>
            <Input type="number" min={0} placeholder="—" value={form.story_points} onChange={(e) => setForm((f) => ({ ...f, story_points: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Epic</Label>
            <Select value={form.epic_id} onChange={(e) => setForm((f) => ({ ...f, epic_id: e.target.value }))}>
              <option value="">No epic</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Sprint</Label>
            <Select value={form.sprint_id} onChange={(e) => setForm((f) => ({ ...f, sprint_id: e.target.value }))}>
              <option value="">Backlog</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Acceptance Criteria</Label>
          <Textarea rows={3} placeholder="Given... When... Then..." value={form.acceptance_criteria} onChange={(e) => setForm((f) => ({ ...f, acceptance_criteria: e.target.value }))} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.title || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

function StoryDialog({ story, onClose, epics, agents, sprints }: {
  story: Story; onClose: () => void; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const qc = useQueryClient();
  const update = (patch: Partial<Story>) =>
    api.stories.update(story.id, patch).then(() => qc.invalidateQueries({ queryKey: ["stories"] }));

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-content-tertiary">{story.key}</span>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
        </div>
        <h2 className="text-base font-semibold text-content-primary">{story.title}</h2>
        <div className="grid grid-cols-2 gap-4">
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
            <Input type="number" min={0} defaultValue={story.story_points ?? ""} onBlur={(e) => update({ story_points: e.target.value ? Number(e.target.value) : null })} placeholder="—" />
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
          <div className="flex flex-col gap-1.5">
            <Label>Assigned Agent</Label>
            <Select defaultValue={story.assigned_agent_id ?? ""} onChange={(e) => update({ assigned_agent_id: e.target.value || null })}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea rows={4} defaultValue={story.description ?? ""} onBlur={(e) => update({ description: e.target.value })} placeholder="Describe the user story..." />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Acceptance Criteria</Label>
          <Textarea rows={4} defaultValue={story.acceptance_criteria ?? ""} onBlur={(e) => update({ acceptance_criteria: e.target.value })} placeholder="Given... When... Then..." />
        </div>
      </div>
      <DialogFooter className="border-t border-border mt-5 pt-4">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Board Tab ────────────────────────────────────────────────────────────────

function BoardTab({ projectId, activeSprint, epics, agents, sprints }: {
  projectId: string; activeSprint?: Sprint; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
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
      {/* Desktop 4-column Kanban grid — exactly like reference project */}
      <div
        className="hidden md:grid flex-1 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(0, 1fr))` }}
      >
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
                  <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
                    {cards.length}
                  </span>
                  {status === "todo" && (
                    <button
                      onClick={() => setCreateCol(status)}
                      className="ml-1 text-content-tertiary hover:text-accent transition-colors"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-column px-4 pb-4">
                <LayoutGroup>
                  <AnimatePresence initial={false} mode="popLayout">
                    {cards.map((story) => (
                      <motion.div
                        key={story.id}
                        layout
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

      {/* Mobile tab switcher */}
      <div className="md:hidden flex-1 overflow-hidden flex flex-col">
        {/* simplified mobile view — just show all cards */}
        <div className="overflow-y-auto p-4 flex flex-col gap-2">
          {stories.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
        </div>
      </div>

      {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />}
      <CreateStoryDialog open={createCol !== null} onClose={() => setCreateCol(null)} projectId={projectId} epics={epics} sprints={sprints} defaultSprintId={activeSprint.id} />
    </>
  );
}

// ─── Backlog Tab ──────────────────────────────────────────────────────────────

function BacklogTab({ projectId, epics, agents, sprints }: { projectId: string; epics: Epic[]; agents: Agent[]; sprints: Sprint[] }) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "backlog", projectId],
    queryFn: () => api.stories.list({ project_id: projectId, sprint_id: null }),
  });

  const noEpic = stories.filter((s) => !s.epic_id);
  const byEpic = epics.map((e) => ({ epic: e, sts: stories.filter((s) => s.epic_id === e.id) })).filter((g) => g.sts.length > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-content-tertiary">{stories.length} stories in backlog</span>
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90">
            <Plus size={12} />Add Story
          </button>
        </div>
        {stories.length === 0 && (
          <div className="py-16 text-center">
            <ListTodo size={28} className="mx-auto text-content-tertiary mb-3" />
            <p className="text-sm text-content-tertiary">Backlog is empty</p>
          </div>
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
        {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />}
        <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} />
      </div>
    </div>
  );
}

// ─── Sprints Tab ──────────────────────────────────────────────────────────────

function CreateSprintDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", goal: "", start_date: "", end_date: "" });
  const mutation = useMutation({
    mutationFn: () => api.sprints.create({ project_id: projectId, ...form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); toast.success("Sprint created"); onClose(); setForm({ name: "", goal: "", start_date: "", end_date: "" }); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="New Sprint">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5"><Label>Name *</Label><Input placeholder="Sprint 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>Goal</Label><Input placeholder="Sprint goal..." value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><Label>Start</Label><Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label>End</Label><Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

function SprintsTab({ projectId, sprints, epics, agents }: { projectId: string; sprints: Sprint[]; epics: Epic[]; agents: Agent[] }) {
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
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-surface-primary hover:opacity-90">
            <Plus size={12} />New Sprint
          </button>
        </div>
        {sprints.length === 0 && (
          <div className="py-16 text-center"><CalendarDays size={28} className="mx-auto text-content-tertiary mb-3" /><p className="text-sm text-content-tertiary">No sprints yet</p></div>
        )}
        <div className="flex flex-col gap-4">
          {sprints.map((sprint) => {
            const sts = allStories.filter((s) => s.sprint_id === sprint.id);
            const done = sts.filter((s) => s.status === "done").length;
            const pts = sts.reduce((a, s) => a + (s.story_points ?? 0), 0);
            return (
              <div key={sprint.id} className="overflow-hidden rounded-lg border border-border bg-surface-secondary">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <Badge variant={sprint.status === "active" ? "accent" : sprint.status === "completed" ? "success" : "default"}>{sprint.status}</Badge>
                    <span className="font-medium text-sm text-content-primary">{sprint.name}</span>
                    {sprint.goal && <span className="text-xs text-content-secondary truncate max-w-48">— {sprint.goal}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-content-tertiary">{done}/{sts.length} done · {pts}p</span>
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
        {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />}
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
            <div key={e.id} className="overflow-hidden rounded-lg border border-border bg-surface-secondary">
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

// ─── Project View Page ────────────────────────────────────────────────────────

type Tab = "board" | "backlog" | "sprints" | "epics";

export function ProjectViewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("board");

  const { data: epics = [] } = useQuery({ queryKey: ["epics", projectId], queryFn: () => api.epics.list(projectId!), enabled: !!projectId });
  const { data: sprints = [] } = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.sprints.list(projectId!), enabled: !!projectId });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  const activeSprint = sprints.find((s) => s.status === "active");

  if (!projectId) return null;

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {/* Sub-nav */}
      <div className="border-b border-border bg-surface-secondary px-5 py-0 shrink-0 flex items-center gap-1">
        {(["board", "backlog", "sprints", "epics"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2.5 text-xs capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-accent text-accent font-medium"
                : "border-transparent text-content-tertiary hover:text-content-secondary"
            )}
          >
            {t}
            {t === "board" && activeSprint && <span className="ml-1 text-accent">●</span>}
          </button>
        ))}
        {tab === "board" && activeSprint && (
          <div className="ml-auto flex items-center gap-3 pr-1">
            <span className="text-xs text-content-secondary font-medium">{activeSprint.name}</span>
            {activeSprint.end_date && (
              <span className="font-mono text-[10px] text-content-tertiary">ends {dayjs(activeSprint.end_date).format("MMM D")}</span>
            )}
          </div>
        )}
      </div>

      {/* Tab content */}
      {tab === "board" && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <BoardTab projectId={projectId} activeSprint={activeSprint} epics={epics} agents={agents} sprints={sprints} />
        </div>
      )}
      {tab === "backlog"  && <BacklogTab projectId={projectId} epics={epics} agents={agents} sprints={sprints} />}
      {tab === "sprints"  && <SprintsTab projectId={projectId} sprints={sprints} epics={epics} agents={agents} />}
      {tab === "epics"    && <EpicsTab projectId={projectId} epics={epics} />}
    </div>
  );
}
