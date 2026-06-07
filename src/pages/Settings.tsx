import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Info, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Input } from "@/components/ui/input";

// ─── Env vars ─────────────────────────────────────────────────────────────────

const ENV_VAR_GROUPS = [
  {
    label: "Claude API",
    vars: [
      { key: "ANTHROPIC_API_KEY", label: "API Key", placeholder: "sk-ant-…", secret: true },
    ],
  },
  {
    label: "Claude Code / CLI (local)",
    vars: [
      { key: "CLAUDE_LOCAL_CLI",      label: "Binary path",  placeholder: "claude  (or full path)", secret: false },
      { key: "CLAUDE_LOCAL_ENDPOINT", label: "HTTP endpoint",placeholder: "http://localhost:8080",   secret: false },
      { key: "CLAUDE_LOCAL_CLI_ARGS", label: "Extra args",   placeholder: "--dangerously-skip-permissions", secret: false },
    ],
  },
  {
    label: "Gemini API",
    vars: [
      { key: "GEMINI_API_KEY", label: "API Key", placeholder: "AIza…", secret: true },
    ],
  },
  {
    label: "OpenAI / Codex API",
    vars: [
      { key: "OPENAI_API_KEY", label: "API Key",           placeholder: "sk-…",                         secret: true  },
      { key: "OPENAI_API_URL", label: "Custom endpoint",   placeholder: "https://api.openai.com/v1/…",  secret: false },
    ],
  },
  {
    label: "Codex CLI (local)",
    vars: [
      { key: "CODEX_LOCAL_CLI",      label: "Binary path",  placeholder: "codex", secret: false },
      { key: "CODEX_LOCAL_ENDPOINT", label: "HTTP endpoint",placeholder: "http://localhost:8081", secret: false },
      { key: "CODEX_LOCAL_CLI_ARGS", label: "Extra args",   placeholder: "--quiet", secret: false },
    ],
  },
];

function EnvVarsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "env_vars"],
    queryFn: () => api.settings.get<Record<string, string>>("env_vars").catch(() => ({ key: "env_vars", value: {} as Record<string, string> })),
  });
  const [vars, setVars] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.value) { setVars(data.value); setDirty(false); }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.settings.put("env_vars", vars),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "env_vars"] }); setDirty(false); toast.success("Environment variables saved"); },
    onError: () => toast.error("Failed to save"),
  });

  const set = (key: string, val: string) => {
    setVars((v) => ({ ...v, [key]: val }));
    setDirty(true);
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-content-primary">API Keys &amp; Local Providers</p>
          <p className="text-xs text-content-tertiary mt-0.5">
            Stored in the local database. Values here override shell environment variables.
          </p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Save size={11} />{save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      {ENV_VAR_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary">{group.label}</p>
          {group.vars.map(({ key, label, placeholder, secret }) => (
            <div key={key} className="grid grid-cols-[160px_1fr] items-center gap-3">
              <span className="text-xs text-content-secondary text-right truncate">{label}</span>
              <div className="relative flex items-center">
                <Input
                  type={secret && !revealed[key] ? "password" : "text"}
                  value={vars[key] ?? ""}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={placeholder}
                  className="h-7 text-xs font-mono pr-8"
                />
                {secret && (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [key]: !r[key] }))}
                    className="absolute right-2 text-content-tertiary hover:text-content-secondary transition-colors"
                  >
                    {revealed[key] ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Agent runtime ────────────────────────────────────────────────────────────

interface AgentRuntimeConfig {
  enabled: boolean;
  cli_path: string;
  permission_mode: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  model: string;
  timeout_minutes: number;
}

const DEFAULT_RUNTIME: AgentRuntimeConfig = {
  enabled: true,
  cli_path: navigator.platform.toLowerCase().includes("win") ? "claude.cmd" : "claude",
  permission_mode: "acceptEdits",
  model: "claude-sonnet-4-5",
  timeout_minutes: 15,
};

function AgentRuntimeSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "agent_runtime_config"],
    queryFn: () => api.settings.get<AgentRuntimeConfig>("agent_runtime_config").catch(() => ({ key: "agent_runtime_config", value: DEFAULT_RUNTIME })),
  });
  const [cfg, setCfg] = useState<AgentRuntimeConfig>(DEFAULT_RUNTIME);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.value) { setCfg({ ...DEFAULT_RUNTIME, ...data.value }); setDirty(false); }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.settings.put("agent_runtime_config", cfg),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "agent_runtime_config"] }); setDirty(false); toast.success("Runtime config saved"); },
    onError: () => toast.error("Failed to save"),
  });

  const update = <K extends keyof AgentRuntimeConfig>(k: K, v: AgentRuntimeConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setDirty(true);
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-content-primary">Agent Runtime</p>
          <p className="text-xs text-content-tertiary mt-0.5">
            Controls how tasks invoke <span className="font-mono">claude-code</span> (the Claude Code CLI).
            Disable to run in dry-mode (tasks halt with a warning instead of executing).
          </p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Save size={11} />{save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="grid grid-cols-[180px_1fr] items-center gap-3">
        <span className="text-xs text-content-secondary text-right">Enabled</span>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
            className="size-4 accent-accent"
          />
          <span className="text-xs text-content-secondary">
            {cfg.enabled ? "Real agent calls (claude-code is invoked per task)" : "Dry mode (tasks halt with a warning)"}
          </span>
        </label>

        <span className="text-xs text-content-secondary text-right">CLI path</span>
        <Input
          value={cfg.cli_path}
          onChange={(e) => update("cli_path", e.target.value)}
          placeholder="claude"
          className="h-7 text-xs font-mono"
        />

        <span className="text-xs text-content-secondary text-right">Permission mode</span>
        <select
          value={cfg.permission_mode}
          onChange={(e) => update("permission_mode", e.target.value as AgentRuntimeConfig["permission_mode"])}
          className="h-7 text-xs rounded-md border border-border bg-surface-secondary px-2 outline-none focus:border-accent"
        >
          <option value="default">default (prompts on each action)</option>
          <option value="acceptEdits">acceptEdits (auto-accept file edits)</option>
          <option value="bypassPermissions">bypassPermissions (no prompts at all)</option>
          <option value="plan">plan (read-only planning mode)</option>
        </select>

        <span className="text-xs text-content-secondary text-right">Default model</span>
        <select
          value={cfg.model}
          onChange={(e) => update("model", e.target.value)}
          className="h-7 text-xs rounded-md border border-border bg-surface-secondary px-2 outline-none focus:border-accent"
        >
          <option value="claude-sonnet-4-5">Sonnet 4.5</option>
          <option value="claude-opus-4-5">Opus 4.5</option>
          <option value="claude-haiku-4-5">Haiku 4.5</option>
          <option value="sonnet">sonnet (latest alias)</option>
          <option value="opus">opus (latest alias)</option>
          <option value="haiku">haiku (latest alias)</option>
        </select>

        <span className="text-xs text-content-secondary text-right">Timeout (minutes)</span>
        <Input
          type="number" min={1} max={120}
          value={cfg.timeout_minutes}
          onChange={(e) => update("timeout_minutes", Number(e.target.value) || 15)}
          className="h-7 text-xs font-mono w-24"
        />
      </div>

      <div className="rounded bg-surface-secondary border border-border px-3 py-2 text-[11px] text-content-tertiary flex gap-2">
        <Info size={12} className="shrink-0 mt-0.5" />
        <span>
          The runner spawns the CLI inside the project's <span className="font-mono">local_path</span> with the task prompt fed via stdin.
          Per-agent <span className="font-mono">model</span> overrides this default when set on the agent.
        </span>
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

export function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8">

        <div className="mb-7">
          <h1 className="text-xl font-bold tracking-tight text-content-primary">Settings</h1>
          <p className="text-xs text-content-secondary mt-1">
            Runtime and provider configuration. Which project-context sections an agent sees is now
            selected automatically by relevance to the task (see <span className="font-mono">CONTEXT.md</span>),
            so there are no manual context rules to configure.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          <AgentRuntimeSection />
          <EnvVarsSection />
        </div>
      </div>
    </div>
  );
}
