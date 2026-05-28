import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  ArrowRight, Bot, CalendarDays, Circle, CircleCheck,
  CircleDot, Layers, ListTodo, Plus, Rocket, Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#71717A", medium: "#A1A1AA", high: "#F59E0B", urgent: "#EF4444",
};

const STATUS_ICONS: Record<StoryStatus, React.ElementType> = {
  backlog: Circle, todo: ListTodo, in_progress: CircleDot, in_review: Layers, done: CircleCheck,
};

const STATUS_LABELS: Record<StoryStatus, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done",
};

const STATUS_COLORS: Record<StoryStatus, string> = {
  backlog: "var(--text-tertiary)", todo: "var(--text-secondary)",
  in_progress: "var(--accent)", in_review: "#F59E0B", done: "#22C55E",
};

function PriorityDot({ priority }: { priority: Priority }) {
  return <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLORS[priority] }} />;
}

// ─── Story Card (shared) ──────────────────────────────────────────────────────

function StoryCard({ story, onClick }: { story: Story; onClick: () => void }) {
  const Icon = STATUS_ICONS[story.status];
  return (
    <div
      className="group cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 transition-colors hover:border-[var(--accent)]/30"
      onClick={onClick}
      style={story.assigned_agent_id ? { boxShadow: "0 0 12px rgba(34,211,238,0.06)" } : undefined}
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className="mt-0.5 shrink-0" style={{ color: STATUS_COLORS[story.status] }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--text-primary)] leading-snug">{story.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{story.key}</span>
            {story.story_points != null && (
              <span className="rounded-full bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                {story.story_points}p
              </span>
            )}
            {story.epic_title && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[11px]"
                style={{ backgroundColor: `${story.epic_color}20`, color: story.epic_color ?? "var(--accent)" }}
              >
                {story.epic_title}
              </span>
            )}
            <PriorityDot priority={story.priority} />
          </div>
          {story.agent_name && (
            <div className="mt-1.5 flex items-center gap-1">
              <Bot size={11} className="text-[var(--accent)]" />
              <span className="font-mono text-[11px] text-[var(--accent)]">{story.agent_name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Story Detail Dialog ──────────────────────────────────────────────────────

interface StoryDialogProps {
  story: Story | null;
  onClose: () => void;
  epics: Epic[];
  agents: Agent[];
  sprints: Sprint[];
}

function StoryDialog({ story, onClose, epics, agents, sprints }: StoryDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Story>>(story ?? {});

  if (!story) return null;

  const update = (patch: Partial<Story>) => {
    setForm((f) => ({ ...f, ...patch }));
    api.stories.update(story.id, patch).then(() => {
      qc.invalidateQueries({ queryKey: ["stories"] });
    });
  };

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{story.key}</span>
          <PriorityDot priority={form.priority as Priority ?? story.priority} />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{story.title}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={form.status ?? story.status} onChange={(e) => update({ status: e.target.value as StoryStatus })}>
              {(Object.keys(STATUS_LABELS) as StoryStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={form.priority ?? story.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>

          {/* Story Points */}
          <div className="flex flex-col gap-1.5">
            <Label>Story Points</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.story_points ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, story_points: e.target.value ? Number(e.target.value) : null }))}
              onBlur={() => update({ story_points: form.story_points ?? null })}
              placeholder="—"
            />
          </div>

          {/* Epic */}
          <div className="flex flex-col gap-1.5">
            <Label>Epic</Label>
            <Select value={form.epic_id ?? ""} onChange={(e) => update({ epic_id: e.target.value || null })}>
              <option value="">No epic</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </div>

          {/* Sprint */}
          <div className="flex flex-col gap-1.5">
            <Label>Sprint</Label>
            <Select value={form.sprint_id ?? ""} onChange={(e) => update({ sprint_id: e.target.value || null })}>
              <option value="">Backlog</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>

          {/* Agent */}
          <div className="flex flex-col gap-1.5">
            <Label>Assigned Agent</Label>
            <Select
              value={form.assigned_agent_id ?? ""}
              onChange={(e) => update({ assigned_agent_id: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}
            </Select>
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea
            rows={4}
            defaultValue={story.description ?? ""}
            onBlur={(e) => update({ description: e.target.value })}
            placeholder="Describe the user story..."
          />
        </div>

        {/* Acceptance Criteria */}
        <div className="flex flex-col gap-1.5">
          <Label>Acceptance Criteria</Label>
          <Textarea
            rows={4}
            defaultValue={story.acceptance_criteria ?? ""}
            onBlur={(e) => update({ acceptance_criteria: e.target.value })}
            placeholder="Given... When... Then..."
          />
        </div>
      </div>

      <DialogFooter className="border-t border-[var(--border)] mt-5 pt-4">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </DialogFooter>
    </Dialog>
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
          <Label htmlFor="stitle">Title *</Label>
          <Input id="stitle" placeholder="As a user, I want to..." value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
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
          <Textarea rows={3} placeholder="Describe the user story..." value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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

// ─── Board View ───────────────────────────────────────────────────────────────

const BOARD_COLUMNS: { status: StoryStatus; label: string }[] = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];

function BoardView({ projectId, activeSprint, epics, agents, sprints }: {
  projectId: string; activeSprint: Sprint | undefined;
  epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createInCol, setCreateInCol] = useState<string | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", { sprint_id: activeSprint?.id }],
    queryFn: () => activeSprint
      ? api.stories.list({ sprint_id: activeSprint.id })
      : api.stories.list({ project_id: projectId, sprint_id: null, status: "todo" }),
    enabled: true,
  });

  if (!activeSprint) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Rocket size={40} className="text-[var(--text-tertiary)]" />
        <p className="text-[var(--text-secondary)]">No active sprint</p>
        <p className="text-sm text-[var(--text-tertiary)]">Start a sprint from the Sprints tab</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">{activeSprint.name}</h2>
        {activeSprint.end_date && (
          <Badge variant="outline">
            <CalendarDays size={11} />
            Ends {dayjs(activeSprint.end_date).format("MMM D")}
          </Badge>
        )}
        {activeSprint.goal && (
          <span className="text-sm text-[var(--text-secondary)]">— {activeSprint.goal}</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 min-h-[60vh]">
        {BOARD_COLUMNS.map(({ status, label }) => {
          const col = stories.filter((s) => s.status === status);
          const Icon = STATUS_ICONS[status];
          return (
            <div key={status} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                  <Icon size={13} style={{ color: STATUS_COLORS[status] }} />
                  <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">{col.length}</span>
                </div>
                {status === "todo" && (
                  <button onClick={() => setCreateInCol(status)} className="text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors">
                    <Plus size={14} />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 scrollbar-thin overflow-y-auto max-h-[70vh]">
                {col.map((s) => (
                  <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedStory && (
        <StoryDialog
          story={selectedStory}
          onClose={() => setSelectedStory(null)}
          epics={epics}
          agents={agents}
          sprints={sprints}
        />
      )}

      <CreateStoryDialog
        open={createInCol !== null}
        onClose={() => setCreateInCol(null)}
        projectId={projectId}
        epics={epics}
        sprints={sprints}
        defaultSprintId={activeSprint.id}
      />
    </div>
  );
}

// ─── Backlog View ─────────────────────────────────────────────────────────────

function BacklogView({ projectId, epics, agents, sprints }: {
  projectId: string; epics: Epic[]; agents: Agent[]; sprints: Sprint[];
}) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: stories = [] } = useQuery({
    queryKey: ["stories", { project_id: projectId, sprint_id: null }],
    queryFn: () => api.stories.list({ project_id: projectId, sprint_id: null }),
  });

  const grouped = epics.reduce<Record<string, Story[]>>((acc, epic) => {
    acc[epic.id] = stories.filter((s) => s.epic_id === epic.id);
    return acc;
  }, {});
  const noEpic = stories.filter((s) => !s.epic_id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{stories.length} stories in backlog</p>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          Add Story
        </Button>
      </div>

      {epics.map((epic) => (
        grouped[epic.id]?.length > 0 && (
          <div key={epic.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: epic.color }} />
              <span className="text-xs font-medium text-[var(--text-secondary)]">{epic.title}</span>
              <span className="text-xs text-[var(--text-tertiary)]">({grouped[epic.id].length})</span>
            </div>
            <div className="flex flex-col gap-1.5 pl-4 border-l border-[var(--border)]">
              {grouped[epic.id].map((s) => (
                <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />
              ))}
            </div>
          </div>
        )
      ))}

      {noEpic.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-tertiary)]">No Epic</span>
            <span className="text-xs text-[var(--text-tertiary)]">({noEpic.length})</span>
          </div>
          <div className="flex flex-col gap-1.5 pl-4 border-l border-[var(--border)]">
            {noEpic.map((s) => (
              <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />
            ))}
          </div>
        </div>
      )}

      {stories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <ListTodo size={36} className="text-[var(--text-tertiary)]" />
          <p className="text-[var(--text-secondary)]">Backlog is empty</p>
          <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            Add Story
          </Button>
        </div>
      )}

      {selectedStory && (
        <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />
      )}
      <CreateStoryDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} epics={epics} sprints={sprints} />
    </div>
  );
}

// ─── Sprints View ─────────────────────────────────────────────────────────────

function CreateSprintDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", goal: "", start_date: "", end_date: "" });
  const mutation = useMutation({
    mutationFn: () => api.sprints.create({ project_id: projectId, ...form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints"] });
      toast.success("Sprint created");
      onClose();
      setForm({ name: "", goal: "", start_date: "", end_date: "" });
    },
    onError: () => toast.error("Failed to create sprint"),
  });
  return (
    <Dialog open={open} onClose={onClose} title="New Sprint">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Name *</Label>
          <Input placeholder="Sprint 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Goal</Label>
          <Input placeholder="What will we achieve?" value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Start Date</Label>
            <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>End Date</Label>
            <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

function SprintsView({ projectId, sprints, epics, agents }: {
  projectId: string; sprints: Sprint[]; epics: Epic[]; agents: Agent[];
}) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [createStorySprintId, setCreateStorySprintId] = useState<string | null>(null);

  const { data: allStories = [] } = useQuery({
    queryKey: ["stories", { project_id: projectId }],
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{sprints.length} sprints</p>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          New Sprint
        </Button>
      </div>

      {sprints.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <CalendarDays size={36} className="text-[var(--text-tertiary)]" />
          <p className="text-[var(--text-secondary)]">No sprints yet</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {sprints.map((sprint) => {
          const sprintStories = allStories.filter((s) => s.sprint_id === sprint.id);
          const done = sprintStories.filter((s) => s.status === "done").length;
          const total = sprintStories.length;
          const points = sprintStories.reduce((acc, s) => acc + (s.story_points ?? 0), 0);

          return (
            <div key={sprint.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
              {/* Sprint header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <Badge
                    variant={sprint.status === "active" ? "accent" : sprint.status === "completed" ? "success" : "default"}
                  >
                    {sprint.status}
                  </Badge>
                  <span className="font-medium text-[var(--text-primary)]">{sprint.name}</span>
                  {sprint.goal && <span className="text-sm text-[var(--text-secondary)]">— {sprint.goal}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-tertiary)] font-mono">{done}/{total} done · {points}p</span>
                  {sprint.start_date && (
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {dayjs(sprint.start_date).format("MMM D")} – {sprint.end_date ? dayjs(sprint.end_date).format("MMM D") : "?"}
                    </span>
                  )}
                  {sprint.status === "planning" && !activeSprint && (
                    <Button size="sm" variant="accent" onClick={() => startSprint.mutate(sprint.id)}>
                      <Rocket size={12} />
                      Start
                    </Button>
                  )}
                  {sprint.status === "active" && (
                    <Button size="sm" variant="outline" onClick={() => completeSprint.mutate(sprint.id)}>
                      <CircleCheck size={12} />
                      Complete
                    </Button>
                  )}
                  {sprint.status !== "active" && (
                    <Button size="icon-sm" variant="ghost" onClick={() => deleteSprint.mutate(sprint.id)}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Stories */}
              <div className="px-4 py-3 flex flex-col gap-1.5">
                {sprintStories.map((s) => (
                  <StoryCard key={s.id} story={s} onClick={() => setSelectedStory(s)} />
                ))}
                <button
                  onClick={() => setCreateStorySprintId(sprint.id)}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--text-tertiary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                >
                  <Plus size={13} />
                  Add story
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <CreateSprintDialog open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
      <CreateStoryDialog
        open={createStorySprintId !== null}
        onClose={() => setCreateStorySprintId(null)}
        projectId={projectId}
        epics={epics}
        sprints={sprints}
        defaultSprintId={createStorySprintId ?? undefined}
      />
      {selectedStory && (
        <StoryDialog story={selectedStory} onClose={() => setSelectedStory(null)} epics={epics} agents={agents} sprints={sprints} />
      )}
    </div>
  );
}

// ─── Epics Panel ──────────────────────────────────────────────────────────────

function CreateEpicDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const EPIC_COLORS = ["#8B5CF6", "#22D3EE", "#F59E0B", "#22C55E", "#EF4444", "#EC4899"];
  const [form, setForm] = useState({ title: "", description: "", color: "#8B5CF6" });
  const mutation = useMutation({
    mutationFn: () => api.epics.create({ project_id: projectId, ...form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["epics"] }); toast.success("Epic created"); onClose(); setForm({ title: "", description: "", color: "#8B5CF6" }); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="New Epic">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Title *</Label>
          <Input placeholder="Epic title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Color</Label>
          <div className="flex gap-2">
            {EPIC_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))}
                className="size-6 rounded-full hover:scale-110 transition-transform"
                style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: "2px" }}
              />
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.title || mutation.isPending}>Create</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Project View Page ────────────────────────────────────────────────────────

type Tab = "board" | "backlog" | "sprints" | "epics";

export function ProjectViewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("board");
  const [createEpicOpen, setCreateEpicOpen] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  const { data: epics = [] } = useQuery({
    queryKey: ["epics", projectId],
    queryFn: () => api.epics.list(projectId!),
    enabled: !!projectId,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", projectId],
    queryFn: () => api.sprints.list(projectId!),
    enabled: !!projectId,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
  });

  const activeSprint = sprints.find((s) => s.status === "active");

  if (!project || !projectId) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "board", label: "Board" },
    { id: "backlog", label: "Backlog" },
    { id: "sprints", label: "Sprints" },
    { id: "epics", label: "Epics" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Link to="/projects" className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
            Projects
          </Link>
          <ArrowRight size={13} className="text-[var(--text-tertiary)]" />
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ backgroundColor: project.color }} />
            <span className="text-sm font-medium text-[var(--text-primary)]">{project.name}</span>
            <span className="font-mono text-xs text-[var(--text-tertiary)]">{project.key}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg transition-colors",
                tab === id
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              )}
            >
              {label}
              {id === "board" && activeSprint && (
                <span className="ml-1.5 text-[11px] text-[var(--accent)] font-mono">●</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "board" && (
          <BoardView
            projectId={projectId}
            activeSprint={activeSprint}
            epics={epics}
            agents={agents}
            sprints={sprints}
          />
        )}
        {tab === "backlog" && (
          <BacklogView projectId={projectId} epics={epics} agents={agents} sprints={sprints} />
        )}
        {tab === "sprints" && (
          <SprintsView projectId={projectId} sprints={sprints} epics={epics} agents={agents} />
        )}
        {tab === "epics" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--text-secondary)]">{epics.length} epics</p>
              <Button variant="accent" size="sm" onClick={() => setCreateEpicOpen(true)}>
                <Plus size={14} />
                New Epic
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {epics.map((epic) => (
                <div key={epic.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: epic.color }} />
                    <span className="font-medium text-[var(--text-primary)]">{epic.title}</span>
                    <Badge variant={epic.status === "open" ? "accent" : "default"} className="ml-auto">
                      {epic.status}
                    </Badge>
                  </div>
                  {epic.description && <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{epic.description}</p>}
                </div>
              ))}
            </div>
            {epics.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Layers size={36} className="text-[var(--text-tertiary)]" />
                <p className="text-[var(--text-secondary)]">No epics yet</p>
              </div>
            )}
            <CreateEpicDialog open={createEpicOpen} onClose={() => setCreateEpicOpen(false)} projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
}
