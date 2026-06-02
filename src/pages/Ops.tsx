import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Activity, AlertCircle, AlertTriangle, Bot, Clock, Coins, Cpu, Info, Play, RotateCw, ZapOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { SystemEvent } from "@/types";

/**
 * Operations Dashboard — Symphony §13.3 / §13.4 status surface.
 *
 * Live view of orchestrator state:
 *   - Running sessions (per-story elapsed, turn count, token usage)
 *   - Retry queue (next attempt due)
 *   - Aggregate totals (tokens, runtime, completed count)
 *   - System events stream (orchestrator startup, recovery, workflow reloads)
 */

const LEVEL_META: Record<SystemEvent["level"], { cls: string; icon: typeof Info }> = {
  debug: { cls: "text-content-tertiary",                       icon: Info },
  info:  { cls: "text-cyan-700",                               icon: Info },
  warn:  { cls: "text-amber-700",                              icon: AlertTriangle },
  error: { cls: "text-red-700",                                icon: AlertCircle },
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function OpsPage() {
  const qc = useQueryClient();

  const { data: snapshot, isLoading: snapLoading } = useQuery({
    queryKey: ["snapshot"],
    queryFn: () => api.snapshot.get(),
    refetchInterval: 3_000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["system-events"],
    queryFn: () => api.systemEvents.list(80),
    refetchInterval: 5_000,
  });

  const kick = useMutation({
    mutationFn: () => api.snapshot.kick(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      toast.success("Tick requested");
    },
  });

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-content-primary flex items-center gap-2">
              <Activity size={18} className="text-accent" />
              Operations
            </h1>
            <p className="text-xs text-content-secondary mt-1">
              Orchestrator state · WIP {snapshot?.wipLimit ?? "?"} · polling every {snapshot ? Math.round(snapshot.pollIntervalMs / 1000) : "?"}s
            </p>
          </div>
          <button
            onClick={() => kick.mutate()}
            disabled={kick.isPending}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90"
          >
            <Play size={11} />Tick now
          </button>
        </div>

        {/* Totals row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric icon={Cpu}      label="Running"   value={snapshot?.totals.runningCount ?? 0} accent />
          <Metric icon={Clock}    label="Retrying"  value={snapshot?.totals.retryingCount ?? 0} />
          <Metric icon={Bot}      label="Completed" value={snapshot?.totals.completedCount ?? 0} />
          <Metric icon={Coins}    label="Tokens"
            value={`${formatTokens(snapshot?.totals.tokenIn ?? 0)} / ${formatTokens(snapshot?.totals.tokenOut ?? 0)}`}
            sub="in / out" />
          <Metric icon={Clock}    label="Runtime"
            value={formatDuration(snapshot?.totals.secondsRunning ?? 0)} sub="aggregate" />
        </div>

        {/* Running sessions */}
        <section className="rounded-xl border border-border bg-surface-card">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-content-primary flex items-center gap-1.5">
              <Cpu size={11} />Running ({snapshot?.running.length ?? 0})
            </p>
          </div>
          {snapLoading ? (
            <p className="px-4 py-5 text-xs text-content-tertiary">Loading…</p>
          ) : !snapshot?.running.length ? (
            <p className="px-4 py-5 text-xs text-content-tertiary text-center">
              No active runs. Move an auto-mode story to In Progress to dispatch one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {snapshot.running.map((r) => (
                <div key={r.storyId} className="px-4 py-3 flex items-center gap-3">
                  <span className="font-mono text-[11px] text-accent shrink-0">{r.identifier}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-content-secondary">
                      <span className="font-mono">attempt {r.attempt}</span>
                      <span className="text-content-tertiary">·</span>
                      <span className="font-mono">{r.turnCount} turns</span>
                      <span className="text-content-tertiary">·</span>
                      <span className="font-mono">{formatTokens(r.tokenIn)}+{formatTokens(r.tokenOut)} tok</span>
                    </div>
                    <p className="text-[10px] text-content-tertiary mt-0.5 font-mono">
                      started {dayjs(r.startedAt).format("HH:mm:ss")} · last event {dayjs(r.lastEventAt).fromNow?.() ?? dayjs(r.lastEventAt).format("HH:mm:ss")}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-content-secondary bg-surface-secondary rounded px-2 py-0.5 shrink-0">
                    {formatDuration(r.elapsedSec)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Retry queue */}
        {snapshot && snapshot.retrying.length > 0 && (
          <section className="rounded-xl border border-border bg-surface-card">
            <div className="px-4 py-2.5 border-b border-border">
              <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-content-primary flex items-center gap-1.5">
                <RotateCw size={11} />Retry Queue ({snapshot.retrying.length})
              </p>
            </div>
            <div className="divide-y divide-border">
              {snapshot.retrying.map((r) => (
                <div key={r.storyId} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="font-mono text-[11px] text-accent shrink-0">{r.identifier}</span>
                  <span className="text-[11px] text-content-secondary flex-1 min-w-0 truncate">
                    {r.error ?? "continuation"}
                  </span>
                  <span className="font-mono text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 shrink-0">
                    attempt {r.attempt} · in {r.dueInSec}s
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* System event log */}
        <section className="rounded-xl border border-border bg-surface-card">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-content-primary flex items-center gap-1.5">
              <ZapOff size={11} />System Events
            </p>
          </div>
          {events.length === 0 ? (
            <p className="px-4 py-5 text-xs text-content-tertiary text-center">No system events yet.</p>
          ) : (
            <div className="divide-y divide-border max-h-[440px] overflow-y-auto scrollbar-column">
              {events.map((e) => {
                const meta = LEVEL_META[e.level] ?? LEVEL_META.info;
                const Icon = meta.icon;
                return (
                  <div key={e.id} className="px-4 py-2 flex items-start gap-2">
                    <Icon size={11} className={cn("mt-0.5 shrink-0", meta.cls)} />
                    <span className="font-mono text-[9px] text-content-tertiary shrink-0 w-[60px]">
                      {dayjs(e.created_at).format("HH:mm:ss")}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-content-tertiary shrink-0 w-[80px]">
                      {e.type}
                    </span>
                    <span className={cn("text-[11px] flex-1 leading-snug whitespace-pre-wrap", meta.cls)}>
                      {e.content}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, accent = false }: {
  icon: typeof Info;
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3", accent ? "border-accent/30 bg-accent-soft" : "border-border bg-surface-card")}>
      <div className="flex items-center justify-between mb-1">
        <Icon size={12} className={accent ? "text-accent" : "text-content-tertiary"} />
        <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">{label}</span>
      </div>
      <p className="text-base font-bold tracking-tight text-content-primary font-mono">{value}</p>
      {sub && <p className="text-[10px] text-content-tertiary mt-0.5">{sub}</p>}
    </div>
  );
}
