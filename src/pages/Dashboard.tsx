import { useQuery } from "@tanstack/react-query";
import { Bot, CircleDot, FolderKanban, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { Story } from "@/types";

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: React.ElementType; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-secondary p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">{label}</span>
        <Icon size={14} className={accent ? "text-accent" : "text-content-tertiary"} />
      </div>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${accent ? "text-accent" : "text-content-primary"}`}>
        {value}
      </p>
    </div>
  );
}

function ActiveStoryRow({ story }: { story: Story }) {
  return (
    <Link
      to={`/projects/${story.project_id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface-card px-4 py-3 transition-all hover:-translate-y-px hover:border-accent/35"
    >
      <CircleDot size={14} className="text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-content-primary truncate">{story.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[11px] text-content-tertiary">{story.key}</span>
          {story.agent_name && (
            <span className="font-mono text-[11px] text-accent flex items-center gap-1">
              <Bot size={10} />
              {story.agent_name}
            </span>
          )}
        </div>
      </div>
      <span className={`
        inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]
        ${story.status === "in_progress" ? "bg-accent-soft text-accent" : "bg-surface-tertiary text-content-tertiary"}
      `}>
        {story.status.replace("_", " ")}
      </span>
    </Link>
  );
}

export function DashboardPage() {
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });
  const { data: activeStories = [] } = useQuery({
    queryKey: ["stories", "active"],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        api.stories.list({ status: "in_progress" }),
        api.stories.list({ status: "in_review" }),
      ]);
      return [...a, ...b];
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-bold text-content-primary">Dashboard</h1>
          <p className="text-sm text-content-secondary">Overview of your agile workspace</p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Projects" value={projects.length} icon={FolderKanban} />
          <StatCard label="Agents" value={agents.length} icon={Bot} />
          <StatCard label="In Progress" value={activeStories.filter((s) => s.status === "in_progress").length} icon={CircleDot} accent />
          <StatCard label="In Review" value={activeStories.filter((s) => s.status === "in_review").length} icon={Layers} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-content-primary">Active Work</h2>
            <span className="font-mono text-xs text-content-tertiary">{activeStories.length}</span>
          </div>
          {activeStories.length === 0 ? (
            <div className="py-16 text-center">
              <CircleDot size={28} className="mx-auto text-content-tertiary mb-3" />
              <p className="text-sm text-content-tertiary">No stories in progress</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeStories.map((s) => <ActiveStoryRow key={s.id} story={s} />)}
            </div>
          )}
        </div>

        {projects.length > 0 && (
          <div className="mt-8 space-y-3">
            <h2 className="text-sm font-semibold text-content-primary">Projects</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-secondary px-4 py-3 transition-all hover:-translate-y-px hover:border-accent/35"
                >
                  <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-sm font-medium text-content-primary truncate">{p.name}</span>
                  {(p.active_count ?? 0) > 0 && (
                    <span className="ml-auto font-mono text-[10px] text-accent shrink-0">{p.active_count} active</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
