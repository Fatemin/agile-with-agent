import { useQuery } from "@tanstack/react-query";
import { Bot, CircleDot, FolderKanban, Layers, ListTodo } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import type { Story } from "@/types";

function StatCard({ label, value, icon: Icon, accent }: {
  label: string; value: number; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{label}</span>
        <Icon size={15} style={{ color: accent ? "var(--accent)" : "var(--text-tertiary)" }} />
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight" style={{ color: accent ? "var(--accent)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function ActiveStoryRow({ story }: { story: Story }) {
  return (
    <Link
      to={`/projects/${story.project_id}`}
      className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 transition-colors hover:border-[var(--accent)]/30"
    >
      <CircleDot size={14} style={{ color: "var(--accent)" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)] truncate">{story.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{story.key}</span>
          {story.agent_name && (
            <span className="font-mono text-[11px] text-[var(--accent)] flex items-center gap-1">
              <Bot size={10} />
              {story.agent_name}
            </span>
          )}
        </div>
      </div>
      <Badge variant={story.status === "in_progress" ? "accent" : story.status === "in_review" ? "warning" : "default"}>
        {story.status.replace("_", " ")}
      </Badge>
    </Link>
  );
}

export function DashboardPage() {
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });
  const { data: activeStories = [] } = useQuery({
    queryKey: ["stories", { status: "in_progress" }],
    queryFn: async () => {
      const [inProgress, inReview] = await Promise.all([
        api.stories.list({ status: "in_progress" }),
        api.stories.list({ status: "in_review" }),
      ]);
      return [...inProgress, ...inReview];
    },
    refetchInterval: 15_000,
  });
  const { data: allStories = [] } = useQuery({
    queryKey: ["stories", "all"],
    queryFn: () => api.stories.list({}),
  });

  const doneToday = allStories.filter(
    (s) => s.status === "done" && s.updated_at.startsWith(new Date().toISOString().slice(0, 10))
  ).length;

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Dashboard</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Overview of your agile workspace</p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Projects" value={projects.length} icon={FolderKanban} />
        <StatCard label="Agents" value={agents.length} icon={Bot} />
        <StatCard label="In Progress" value={activeStories.filter((s) => s.status === "in_progress").length} icon={CircleDot} accent />
        <StatCard label="Done Today" value={doneToday} icon={Layers} />
      </div>

      {/* Active work */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Active Work</h2>
          <span className="text-xs text-[var(--text-tertiary)]">{activeStories.length} stories</span>
        </div>

        {activeStories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed border-[var(--border)]">
            <ListTodo size={32} className="text-[var(--text-tertiary)]" />
            <p className="text-sm text-[var(--text-secondary)]">No stories in progress</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeStories.map((s) => <ActiveStoryRow key={s.id} story={s} />)}
          </div>
        )}
      </div>

      {/* Projects quick nav */}
      {projects.length > 0 && (
        <div className="mt-6 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Projects</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 transition-colors hover:border-[var(--accent)]/30"
              >
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-sm font-medium text-[var(--text-primary)] truncate">{p.name}</span>
                {(p.active_count ?? 0) > 0 && (
                  <span className="ml-auto text-xs text-[var(--accent)] font-mono shrink-0">{p.active_count} active</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
