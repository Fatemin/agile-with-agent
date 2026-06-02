import { useQuery } from "@tanstack/react-query";
import { Bot, CircleDot, FolderKanban, Layers, RotateCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Story } from "@/types";

const STATUS_STYLE: Record<string, string> = {
  in_dev: "bg-cyan-50 text-cyan-700 border border-cyan-200",
  in_qa:  "bg-amber-50 text-amber-700 border border-amber-200",
};

function StatCard({ label, value, icon: Icon, accent }: {
  label: string; value: number; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-accent/20 bg-accent-soft" : "border-border bg-surface-card"}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">{label}</span>
        <Icon size={13} className={accent ? "text-accent" : "text-content-tertiary"} />
      </div>
      <p className={`text-3xl font-bold tracking-tight ${accent ? "text-accent" : "text-content-primary"}`}>
        {value}
      </p>
    </div>
  );
}

function DispatchRow({ story, onNavigate }: { story: Story; onNavigate: (id: string) => void }) {
  return (
    <button
      onClick={() => onNavigate(story.project_id)}
      className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-tertiary transition-colors text-left"
    >
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] shrink-0 ${STATUS_STYLE[story.status] ?? ""}`}>
        {story.status.replace("_", " ")}
      </span>
      <span className="font-mono text-[10px] text-content-tertiary shrink-0">{story.key}</span>
      <span className="flex-1 text-xs text-content-primary truncate">{story.title}</span>
      {story.agent_name && (
        <span className="flex items-center gap-1 font-mono text-[10px] text-accent shrink-0">
          <Bot size={10} />
          {story.agent_name}
        </span>
      )}
    </button>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: projects = [], refetch: refetchProjects } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });
  const { data: activeStories = [], refetch: refetchStories, isFetching } = useQuery({
    queryKey: ["stories", "active"],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        api.stories.list({ status: "in_progress" }),
        api.stories.list({ status: "human_review" }),
      ]);
      return [...a, ...b];
    },
    refetchInterval: 15_000,
  });

  const handleRefresh = () => { refetchProjects(); refetchStories(); };
  const inProgress = activeStories.filter((s) => s.status === "in_progress").length;
  const inReview   = activeStories.filter((s) => s.status === "human_review").length;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-content-primary">Dashboard</h1>
            <p className="text-xs text-content-secondary mt-0.5">Workspace overview</p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
          >
            <RotateCw size={12} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Projects"    value={projects.length} icon={FolderKanban} />
          <StatCard label="Agents"      value={agents.length}   icon={Bot} />
          <StatCard label="In Progress" value={inProgress}      icon={CircleDot} accent />
          <StatCard label="In Review"   value={inReview}        icon={Layers} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

          {/* Active dispatch board */}
          <div className="rounded-xl border border-border bg-surface-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold text-content-primary">Active Dispatch</span>
              <span className="font-mono text-[10px] text-content-tertiary">{activeStories.length} tickets</span>
            </div>
            {activeStories.length === 0 ? (
              <div className="py-14 text-center">
                <CircleDot size={24} className="mx-auto text-content-tertiary mb-2" />
                <p className="text-xs text-content-tertiary">No active work</p>
              </div>
            ) : (
              <div>
                {activeStories.map((s) => (
                  <DispatchRow key={s.id} story={s} onNavigate={(id) => navigate(`/projects/${id}/board`)} />
                ))}
              </div>
            )}
          </div>

          {/* Projects sidebar */}
          <div className="rounded-xl border border-border bg-surface-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold text-content-primary">Workspaces</span>
            </div>
            {projects.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-content-tertiary">No projects yet</p>
              </div>
            ) : (
              <div>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}/board`)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-tertiary transition-colors text-left"
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="flex-1 text-xs text-content-primary truncate">{p.name}</span>
                    <span className="font-mono text-[9px] text-content-tertiary shrink-0">{p.key}</span>
                    {(p.active_count ?? 0) > 0 && (
                      <span className="font-mono text-[9px] text-accent">{p.active_count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
