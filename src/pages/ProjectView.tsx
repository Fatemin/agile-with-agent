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
  { status: "todo", label: "Todo", icon: Circle },
  { status: "in_progress", label: "In Progress", icon: RotateCw },
  { status: "in_review", label: "In Review", icon: Clock3 },
  { status: "done", label: "Done", icon: CheckCircle2 },
];

const STATUS_LABELS: Record<StoryStatus, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done",
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
        "w-full text-left bg-[var(--bg-card)] border rounded-lg p-3 cursor-pointer outline-none",
        "transition-[border-color,box-shadow] duration-150",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
        isActive
          ? "border-[var(--accent)]/25 shadow-[0_0_16px_var(--accent-glow)]"
          : "border-[var(--border)] hover:border-[var(--text-tertiary)]"
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="font-mono text-[11px] leading-snug text-[var(--text-tertiary)] shrink-0">{story.key}</span>
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--text-primary)] flex-1 min-w-0">
          {story.title}
        </p>
      </div>

      {story.epic_title && (
        <div className="mt-1.5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: `${story.epic_color}15`, color: story.epic_color ?? "var(--accent)" }}
          >
            {story.epic_title}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: PRIORITY_COLORS[story.priority] }}
          />
          {story.story_points != null && (
            <span className="font-mono text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] rounded px-1">
              {story.story_points}p
            </span>
          )}
        </div>

        {story.agent_name && (
          <div className={cn("flex items-center gap-1", isActive ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]")}>
            {isActive && <span className="size-1.5 rounded-full bg-[var(--accent)] animate-[pulse-dot_2s_ease-in-out_infinite]" />}
            <Bot size={11} />
            <span className="font-mono text-[11px] truncate max-w-24">{story.agent_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Story Dialog ──────────────────────────────────────────────────────

function CreateStoryDialog({
  open, onClose, projectId, epics, sprints, defaultSprintId,
}: {
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
      project_id: projectId,
      title: form.title,
      description: form.description || undefined,
      acceptance_criteria: form.acceptance_criteria || undefined,
      story_points: form.story_points ? Number(form.story_points) : undefined,
      priority: form.priority,
      epic_id: form.epic_id || undefined,
      sprint_id: form.sprint_id || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
      toast.success("Story created");
      onClose();
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
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
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

// ─── Story Detail Dialog ──────────────────────────────────────────────────────

function StoryDialog({ story, onClose, epics, agents, sprints }: {
  story: Story; onClose: () => void; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const qc = useQueryClient();

  const update = (patch: Partial<Story>) => {
    api.stories.update(story.id, patch).then(() => qc.invalidateQueries({ queryKey: ["stories"] }));
  };

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{story.key}</span>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[story.priority] }} />
        </div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{story.title}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select defaultValue={story.status} onChange={(e) => update({ status: e.target.value as StoryStatus })}>
              {(Object.keys(STATUS_LABELS) as StoryStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select defaultValue={story.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
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
      <DialogFooter className="border-t border-[var(--border)] mt-5 pt-4">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Board Tab (full-height Kanban) ──────────────────────────────────────────

function BoardTab({ projectId, activeSprint, epics, agents, sprints }: {
  projectId: string; activeSprint?: Sprint; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createCol, setCreateCol] = useState<StoryStatus | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "board", activeSprint?.id ?? null],
    queryFn: () => activeSprint
      ? api.stories.list({ sprint_id: activeSprint.id })
      : api.stories.list({ project_id: projectId, sprint_id: null }),
    refetchInterval: 10_000,
  });

  if (!activeSprint) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-tertiary)]">
        <Rocket size={36} />
        <p className="text-sm text-[var(--text-secondary)]">No active sprint — start one from the Sprints tab</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:grid flex-1 overflow-hidden" style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(0,1fr))` }}>
        {BOARD_COLUMNS.map(({ status, label, icon: Icon }) => {
          const cards = stories.filter((s) => s.status === status);
          return (
            <div key={status} className="flex flex-col border-r border-[var(--border)] last:border-r-0 min-h-0">
              {/* Column header */}
              <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  <Icon size={13} strokeWidth={2} />
                  {label}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">
                    {cards.length}
                  </span>
                  {status === "todo" && (
                    <button
                      onClick={() => setCreateCol(status)}
                      className="ml-1 text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto scrollbar-column px-4 pb-4">
                <LayoutGroup>
                  <AnimatePresence initial={false} mode="popLayout">
                    {cards.map((story) => (
                      <motion.div
                        key={story.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2, layout: { duration: 0.25 } }}
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

      {selectedStory && (
        <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />
      )}
      <CreateStoryDialog
        open={createCol !== null}
        onClose={() => setCreateCol(null)}
        projectId={projectId}
        epics={epics}
        sprints={sprints}
        defaultSprintId={activeSprint.id}
      />
    </>
  );
}

// ─── Backlog Tab ──────────────────────────────────────────────────────────────

function BacklogTab({ projectId, epics, agents, sprints }: {
  projectId: string; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", "backlog", projectId],
    queryFn: () => api.stories.list({ project_id: projectId, sprint_id: null }),
  });

  const noEpic = stories.filter((s) => !s.epic_id);
  const byEpic = epics.map((e) => ({ epic: e, stories: stories.filter((s) => s.epic_id === e.id) })).filter((g) => g.stories.length > 0);

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{stories.length} stories in backlog</p>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={13} />
          Add Story
        </Button>
      </div>

      {stories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--text-tertiary)]">
          <ListTodo size={36} />
          <p className="text-sm text-[var(--text-secondary)]">Backlog is empty</p>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {byEpic.map(({ epic, stories: sts }) => (
          <div key={epic.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: epic.color }} />
              <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{epic.title}</span>
              <span className="text-xs text-[var(--text-tertiary)]">({sts.length})</span>
            </div>
            <div className="flex flex-col gap-1.5 pl-4 border-l-2" style={{ borderColor: `${epic.color}40` }}>
              {sts.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
            </div>
          </div>
        ))}
        {noEpic.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">No Epic</span>
              <span className="text-xs text-[var(--text-tertiary)]">({noEpic.length})</span>
            </div>
            <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-[var(--border)]">
              {noEpic.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
            </div>
          </div>
        )}
      </div>

      {selectedStory && <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />}
      <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} />
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

function SprintsTab({ projectId, sprints, epics, agents }: {
  projectId: string; sprints: Sprint[]; epics: Epic[]; agents: Agent[];
}) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createStorySprintId, setCreateStorySprintId] = useState<string | null>(null);

  const { data: allStories = [] } = useQuery({
    queryKey: ["stories", "project", projectId],
    queryFn: () => api.stories.list({ project_id: projectId }),
  });

  const startSprint = useMutation({
    mutationFn: (id: string) => api.sprints.update(id, { status: "active" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); toast.success("Sprint started!"); },
  });
  const completeSprint = useMutation({
    mutationFn: (id: string) => api.sprints.update(id, { status: "completed" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); toast.success("Sprint completed"); },
  });
  const deleteSprint = useMutation({
    mutationFn: (id: string) => api.sprints.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sprints"] }); qc.invalidateQueries({ queryKey: ["stories"] }); },
  });

  const activeSprint = sprints.find((s) => s.status === "active");

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{sprints.length} sprints</p>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}><Plus size={13} />New Sprint</Button>
      </div>

      {sprints.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--text-tertiary)]">
          <CalendarDays size={36} />
          <p className="text-sm text-[var(--text-secondary)]">No sprints yet</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {sprints.map((sprint) => {
          const sts = allStories.filter((s) => s.sprint_id === sprint.id);
          const done = sts.filter((s) => s.status === "done").length;
          const pts = sts.reduce((a, s) => a + (s.story_points ?? 0), 0);

          return (
            <div key={sprint.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <Badge variant={sprint.status === "active" ? "accent" : sprint.status === "completed" ? "success" : "default"}>
                    {sprint.status}
                  </Badge>
                  <span className="font-medium text-[var(--text-primary)]">{sprint.name}</span>
                  {sprint.goal && <span className="text-sm text-[var(--text-secondary)]">— {sprint.goal}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[var(--text-tertiary)]">{done}/{sts.length} · {pts}p</span>
                  {sprint.start_date && (
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {dayjs(sprint.start_date).format("MMM D")}–{sprint.end_date ? dayjs(sprint.end_date).format("MMM D") : "?"}
                    </span>
                  )}
                  {sprint.status === "planning" && !activeSprint && (
                    <Button size="sm" variant="accent" onClick={() => startSprint.mutate(sprint.id)}><Rocket size={12} />Start</Button>
                  )}
                  {sprint.status === "active" && (
                    <Button size="sm" variant="outline" onClick={() => completeSprint.mutate(sprint.id)}><CheckCircle2 size={12} />Complete</Button>
                  )}
                  {sprint.status !== "active" && (
                    <Button size="icon-sm" variant="ghost" onClick={() => deleteSprint.mutate(sprint.id)}><Trash2 size={13} /></Button>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 flex flex-col gap-1.5">
                {sts.map((s) => <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />)}
                <button
                  onClick={() => setCreateStorySprintId(sprint.id)}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-tertiary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                >
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
  );
}

// ─── Epics Tab ────────────────────────────────────────────────────────────────

function CreateEpicDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const COLORS = ["#8B5CF6", "#0891B2", "#F59E0B", "#22C55E", "#EF4444", "#EC4899"];
  const [form, setForm] = useState({ title: "", description: "", color: "#8B5CF6" });
  const mutation = useMutation({
    mutationFn: () => api.epics.create({ project_id: projectId, ...form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["epics"] }); toast.success("Epic created"); onClose(); setForm({ title: "", description: "", color: "#8B5CF6" }); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="New Epic">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5"><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5">
          <Label>Color</Label>
          <div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))} className="size-6 rounded-full hover:scale-110 transition-transform" style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: "2px" }} />)}</div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.title || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

function EpicsTab({ projectId, epics }: { projectId: string; epics: Epic[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{epics.length} epics</p>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}><Plus size={13} />New Epic</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {epics.map((e) => (
          <div key={e.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="size-3 rounded-full" style={{ backgroundColor: e.color }} />
              <span className="font-medium text-[var(--text-primary)]">{e.title}</span>
              <Badge variant={e.status === "open" ? "accent" : "default"} className="ml-auto">{e.status}</Badge>
            </div>
            {e.description && <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{e.description}</p>}
          </div>
        ))}
      </div>
      {epics.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--text-tertiary)]"><Layers size={36} /><p className="text-sm text-[var(--text-secondary)]">No epics yet</p></div>
      )}
      <CreateEpicDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
    </div>
  );
}

// ─── Project View Page ────────────────────────────────────────────────────────

type Tab = "board" | "backlog" | "sprints" | "epics";

export function ProjectViewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("board");

  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.projects.get(projectId!), enabled: !!projectId });
  const { data: epics = [] } = useQuery({ queryKey: ["epics", projectId], queryFn: () => api.epics.list(projectId!), enabled: !!projectId });
  const { data: sprints = [] } = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.sprints.list(projectId!), enabled: !!projectId });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  const activeSprint = sprints.find((s) => s.status === "active");

  if (!project || !projectId) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "board", label: "Board" },
    { id: "backlog", label: "Backlog" },
    { id: "sprints", label: "Sprints" },
    { id: "epics", label: "Epics" },
  ];

  const isBoard = tab === "board";

  return (
    <div className={cn("flex flex-col", isBoard ? "h-full overflow-hidden" : "")}>
      {/* Sub-nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-2 shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg transition-colors",
                tab === id
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              )}
            >
              {label}
              {id === "board" && activeSprint && (
                <span className="ml-1.5 text-[10px] text-[var(--accent)]">●</span>
              )}
            </button>
          ))}
          {activeSprint && tab === "board" && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{activeSprint.name}</span>
              {activeSprint.end_date && (
                <span className="text-xs text-[var(--text-tertiary)]">ends {dayjs(activeSprint.end_date).format("MMM D")}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {isBoard ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <BoardTab projectId={projectId} activeSprint={activeSprint} epics={epics} agents={agents} sprints={sprints} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tab === "backlog" && <BacklogTab projectId={projectId} epics={epics} agents={agents} sprints={sprints} />}
          {tab === "sprints" && <SprintsTab projectId={projectId} sprints={sprints} epics={epics} agents={agents} />}
          {tab === "epics" && <EpicsTab projectId={projectId} epics={epics} />}
        </div>
      )}
    </div>
  );
}
