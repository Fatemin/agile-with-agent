import { useQuery } from "@tanstack/react-query";
import { Bot, CircleDot, ClipboardCheck, Cpu, FolderKanban, RotateCw, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/storyStatus";
import type { Story } from "@/types";

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function StatCard({ label, value, icon: Icon, accent }: {
  label: string; value: number; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-4", accent ? "border-accent/20 bg-accent-soft" : "border-border bg-surface-card")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">{label}</span>
        <Icon size={13} className={accent ? "text-accent" : "text-content-tertiary"} />
      </div>
      <p className={cn("text-3xl font-bold tracking-tight", accent ? "text-accent" : "text-content-primary")}>{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const goToStory = (s: Pick<Story, "project_id">) => navigate(`/projects/${s.project_id}/board`);

  const { data: projects = [], refetch: refetchProjects } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  const { data: stories = [], refetch: refetchStories, isFetching } = useQuery({
    queryKey: ["stories", "dashboard"],
    queryFn: async () => {
      const [a, b, c] = await Promise.all([
        api.stories.list({ status: "in_progress" }),
        api.stories.list({ status: "design_review" }),
        api.stories.list({ status: "human_review" }),
      ]);
      return [...a, ...b, ...c];
    },
  });

  const { data: snapshot } = useQuery({ queryKey: ["snapshot"], queryFn: () => api.snapshot.get(), refetchInterval: 3_000 });

  const storyById = new Map(stories.map((s) => [s.id, s]));
  const inProgress = stories.filter((s) => s.status === "in_progress");
  const awaiting = stories.filter((s) => s.status === "design_review" || s.status === "human_review");
  const running = snapshot?.running ?? [];

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-content-primary">Dashboard</h1>
            <p className="text-xs text-content-secondary mt-0.5">What's happening right now</p>
          </div>
          <button onClick={() => { refetchProjects(); refetchStories(); }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors">
            <RotateCw size={12} className={isFetching ? "animate-spin" : ""} />Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Projects"    value={projects.length} icon={FolderKanban} />
          <StatCard label="Agents"      value={agents.length}   icon={Bot} />
          <StatCard label="Running now" value={running.length}  icon={Cpu} accent />
          <StatCard label="Awaiting you" value={awaiting.length} icon={UserCheck} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
          <div className="flex flex-col gap-5">

            {/* Now running — live agent sessions from the orchestrator */}
            <section className="rounded-xl border border-border bg-surface-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs font-semibold text-content-primary flex items-center gap-1.5">
                  <Cpu size={13} className="text-accent" />Now Running
                </span>
                <span className="font-mono text-[10px] text-content-tertiary">{running.length} active</span>
              </div>
              {running.length === 0 ? (
                <div className="py-10 text-center">
                  <CircleDot size={22} className="mx-auto text-content-tertiary mb-2" />
                  <p className="text-xs text-content-tertiary">No agents running</p>
                </div>
              ) : running.map((r) => {
                const s = storyById.get(r.storyId);
                return (
                  <button key={r.storyId} onClick={() => s && goToStory(s)} disabled={!s}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-tertiary transition-colors text-left disabled:cursor-default">
                    <span className="size-1.5 rounded-full bg-accent animate-pulse-dot shrink-0" />
                    <span className="font-mono text-[11px] text-accent shrink-0">{r.identifier}</span>
                    <span className="flex-1 text-xs text-content-primary truncate">{s?.title ?? ""}</span>
                    <span className="font-mono text-[10px] text-content-tertiary shrink-0 hidden sm:inline">
                      {r.turnCount}t · {fmtTokens(r.tokenIn + r.tokenOut)} tok
                    </span>
                    <span className="font-mono text-[10px] text-content-secondary bg-surface-secondary rounded px-1.5 py-0.5 shrink-0">
                      {fmtDuration(r.elapsedSec)}
                    </span>
                  </button>
                );
              })}
            </section>

            {/* Awaiting you — human gates (design review / human review) */}
            <section className="rounded-xl border border-border bg-surface-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs font-semibold text-content-primary flex items-center gap-1.5">
                  <UserCheck size={13} className="text-amber-600" />Awaiting You
                </span>
                <span className="font-mono text-[10px] text-content-tertiary">{awaiting.length} to action</span>
              </div>
              {awaiting.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-xs text-content-tertiary">Nothing waiting on you</p>
                </div>
              ) : awaiting.map((s) => {
                const meta = statusMeta(s.status);
                const action = s.status === "design_review" ? "Approve design" : "Review & close";
                const Icon = s.status === "design_review" ? ClipboardCheck : UserCheck;
                return (
                  <button key={s.id} onClick={() => goToStory(s)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-tertiary transition-colors text-left">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] shrink-0", meta.badge)}>
                      <Icon size={9} />{meta.label}
                    </span>
                    <span className="font-mono text-[10px] text-content-tertiary shrink-0">{s.key}</span>
                    <span className="flex-1 text-xs text-content-primary truncate">{s.title}</span>
                    <span className="font-mono text-[10px] text-accent shrink-0 hidden sm:inline">{action} →</span>
                  </button>
                );
              })}
            </section>
          </div>

          {/* Workspaces */}
          <div className="rounded-xl border border-border bg-surface-card overflow-hidden self-start">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold text-content-primary">Workspaces</span>
            </div>
            {projects.length === 0 ? (
              <div className="py-10 text-center"><p className="text-xs text-content-tertiary">No projects yet</p></div>
            ) : projects.map((p) => {
              const active = inProgress.filter((s) => s.project_id === p.id).length;
              return (
                <button key={p.id} onClick={() => navigate(`/projects/${p.id}/board`)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-tertiary transition-colors text-left">
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="flex-1 text-xs text-content-primary truncate">{p.name}</span>
                  <span className="font-mono text-[9px] text-content-tertiary shrink-0">{p.key}</span>
                  {active > 0 && <span className="font-mono text-[9px] text-accent shrink-0">{active} running</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
