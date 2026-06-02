import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Info, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Input } from "@/components/ui/input";

// ─── Section / type metadata ──────────────────────────────────────────────────

export const CONTEXT_SECTIONS = [
  "overview", "prd", "design_system", "data_model",
  "architecture", "conventions", "glossary",
] as const;
export type ContextSection = typeof CONTEXT_SECTIONS[number];

const SECTION_META: Record<ContextSection, { short: string; description: string }> = {
  overview:      { short: "Overview",      description: "Project goals, target users" },
  prd:           { short: "PRD",           description: "Product requirements, user flows" },
  design_system: { short: "Design",        description: "UI components, colors, patterns" },
  data_model:    { short: "Data Model",    description: "Schema, entities, relationships" },
  architecture:  { short: "Architecture",  description: "System design, tech stack" },
  conventions:   { short: "Conventions",   description: "Code style, naming, patterns" },
  glossary:      { short: "Glossary",      description: "Domain terms and definitions" },
};

export const STORY_TYPES = ["story", "bug", "task", "spike"] as const;
export type StoryType = typeof STORY_TYPES[number];

const STORY_TYPE_META: Record<StoryType, { label: string; emoji: string; description: string }> = {
  story: { label: "User Story", emoji: "📖", description: "New feature from user's perspective" },
  bug:   { label: "Bug",        emoji: "🐛", description: "Defect or unexpected behavior" },
  task:  { label: "Task",       emoji: "🔧", description: "Technical / operational work" },
  spike: { label: "Spike",      emoji: "⚡", description: "Research to reduce uncertainty" },
};

export const AGENT_ROLES = [
  "frontend", "backend", "fullstack", "qa",
  "devops", "techlead", "security", "custom",
] as const;
export type AgentRole = typeof AGENT_ROLES[number];

const AGENT_ROLE_META: Record<AgentRole, { label: string; emoji: string; description: string }> = {
  frontend:  { label: "Frontend",    emoji: "🎨", description: "UI, React, CSS, accessibility" },
  backend:   { label: "Backend",     emoji: "⚙️", description: "API, database, server-side" },
  fullstack: { label: "Full Stack",  emoji: "⚡", description: "End-to-end implementation" },
  qa:        { label: "QA",          emoji: "🧪", description: "Testing, quality assurance" },
  devops:    { label: "DevOps",      emoji: "🚀", description: "CI/CD, infrastructure" },
  techlead:  { label: "Tech Lead",   emoji: "🏗️", description: "Architecture, standards, review" },
  security:  { label: "Security",    emoji: "🔒", description: "Auth, vulnerabilities, compliance" },
  custom:    { label: "Custom",      emoji: "✏️", description: "User-defined role" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type StoryTypeRules = Record<StoryType, ContextSection[]>;
export type AgentRoleRules = Record<AgentRole, ContextSection[]>;
export interface KeywordRule {
  keywords: string[];
  sections: ContextSection[];
}

export const DEFAULT_STORY_TYPE_RULES: StoryTypeRules = {
  story: ["overview", "prd", "design_system", "conventions"],
  bug:   ["overview", "data_model", "conventions"],
  task:  ["overview", "architecture", "conventions"],
  spike: ["overview", "architecture", "data_model", "conventions"],
};

export const DEFAULT_AGENT_ROLE_RULES: AgentRoleRules = {
  frontend:  ["overview", "design_system", "conventions"],
  backend:   ["overview", "architecture", "data_model", "conventions"],
  fullstack: ["overview", "architecture", "data_model", "design_system", "conventions"],
  qa:        ["overview", "prd", "conventions"],
  devops:    ["overview", "architecture", "conventions"],
  techlead:  ["overview", "prd", "architecture", "data_model", "conventions"],
  security:  ["overview", "architecture", "data_model", "conventions"],
  custom:    ["overview", "conventions"],
};

export const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
  { keywords: ["api", "endpoint", "rest", "graphql", "route"],             sections: ["architecture"] },
  { keywords: ["database", "schema", "migration", "model", "sql"],         sections: ["data_model"] },
  { keywords: ["ui", "component", "style", "css", "layout", "design"],     sections: ["design_system"] },
  { keywords: ["auth", "login", "permission", "role", "token", "jwt"],     sections: ["architecture", "data_model"] },
  { keywords: ["test", "spec", "unit", "e2e", "qa"],                       sections: ["conventions"] },
  { keywords: ["deploy", "ci", "cd", "pipeline", "docker"],                sections: ["architecture"] },
];

// ─── Shared: Matrix component ─────────────────────────────────────────────────

function Matrix<R extends string>({
  rows,
  rowMeta,
  rules,
  onChange,
}: {
  rows: readonly R[];
  rowMeta: Record<R, { label: string; emoji: string; description: string }>;
  rules: Record<R, ContextSection[]>;
  onChange: (next: Record<R, ContextSection[]>) => void;
}) {
  const toggle = (row: R, section: ContextSection) => {
    const current = rules[row] ?? [];
    const next = current.includes(section)
      ? current.filter((s) => s !== section)
      : [...current, section];
    onChange({ ...rules, [row]: next });
  };

  const isChecked = (row: R, section: ContextSection) =>
    (rules[row] ?? []).includes(section);

  const sectionCount = (section: ContextSection) =>
    rows.filter((r) => isChecked(r, section)).length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            <th className="w-44 pb-3 pr-4" />
            {CONTEXT_SECTIONS.map((section) => {
              const meta = SECTION_META[section];
              const count = sectionCount(section);
              return (
                <th key={section} className="pb-3 px-2 min-w-[80px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-content-primary">{meta.short}</span>
                    <span className={`text-[10px] font-mono ${count === rows.length ? "text-accent" : count > 0 ? "text-content-tertiary" : "text-content-tertiary/30"}`}>
                      {count}/{rows.length}
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const meta = rowMeta[row];
            return (
              <tr key={row} className="hover:bg-surface-secondary/50 transition-colors">
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{meta.emoji}</span>
                    <div>
                      <p className="text-xs font-semibold text-content-primary">{meta.label}</p>
                      <p className="text-[10px] text-content-tertiary leading-tight mt-0.5">{meta.description}</p>
                    </div>
                  </div>
                </td>
                {CONTEXT_SECTIONS.map((section) => {
                  const checked = isChecked(row, section);
                  return (
                    <td key={section} className="py-3 px-2">
                      <button
                        type="button"
                        onClick={() => toggle(row, section)}
                        title={`${checked ? "Remove" : "Add"} ${SECTION_META[section].short}`}
                        className={`flex items-center justify-center size-7 rounded-lg border transition-all ${
                          checked
                            ? "bg-accent border-accent text-white"
                            : "border-border bg-surface-card text-content-tertiary hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                        }`}
                      >
                        {checked ? (
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                            <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Keyword Rules editor ─────────────────────────────────────────────────────

function KeywordRulesEditor({
  rules,
  onChange,
}: {
  rules: KeywordRule[];
  onChange: (next: KeywordRule[]) => void;
}) {
  const updateKeywords = (idx: number, raw: string) => {
    const keywords = raw.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    onChange(rules.map((r, i) => i === idx ? { ...r, keywords } : r));
  };

  const toggleSection = (idx: number, section: ContextSection) => {
    const current = rules[idx].sections;
    const next = current.includes(section)
      ? current.filter((s) => s !== section)
      : [...current, section];
    onChange(rules.map((r, i) => i === idx ? { ...r, sections: next } : r));
  };

  const addRow = () => {
    onChange([...rules, { keywords: [], sections: [] }]);
  };

  const removeRow = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-2">
      {rules.map((rule, idx) => (
        <div key={idx} className="grid items-center gap-3 rounded-lg border border-border bg-surface-card px-3 py-2.5"
          style={{ gridTemplateColumns: "1fr auto auto" }}>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-content-tertiary">Keywords (comma-separated)</label>
            <input
              value={rule.keywords.join(", ")}
              onChange={(e) => updateKeywords(idx, e.target.value)}
              placeholder="e.g. api, endpoint, route"
              className="h-7 rounded border border-border bg-surface-secondary px-2 text-xs font-mono text-content-primary outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-content-tertiary">Add sections</label>
            <div className="flex flex-wrap gap-1">
              {CONTEXT_SECTIONS.map((s) => {
                const active = rule.sections.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSection(idx, s)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                      active
                        ? "bg-accent border-accent text-white"
                        : "border-border text-content-tertiary hover:border-accent/50 hover:text-accent"
                    }`}
                  >
                    {SECTION_META[s].short}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={() => removeRow(idx)}
            className="p-1.5 text-content-tertiary hover:text-error transition-colors self-center mt-3"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-dashed border-border text-xs text-content-tertiary hover:border-accent/50 hover:text-accent transition-colors self-start"
      >
        <Plus size={12} />Add keyword rule
      </button>
    </div>
  );
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function CombinedPreview({
  storyRules,
  roleRules,
}: {
  storyRules: StoryTypeRules;
  roleRules: AgentRoleRules;
}) {
  // Show a sample: user story + frontend engineer
  const samplePairs: Array<{ storyType: StoryType; role: AgentRole; label: string }> = [
    { storyType: "story", role: "frontend", label: "User Story · Frontend" },
    { storyType: "story", role: "backend",  label: "User Story · Backend" },
    { storyType: "bug",   role: "qa",       label: "Bug · QA" },
    { storyType: "spike", role: "techlead", label: "Spike · Tech Lead" },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Info size={13} className="text-content-tertiary" />
        <span className="text-xs font-semibold text-content-primary">Combined preview — sections included per story + agent combination</span>
        <span className="ml-auto text-[10px] text-content-tertiary font-mono">= union(story type + agent role + keywords)</span>
      </div>
      <div className="divide-y divide-border">
        {samplePairs.map(({ storyType, role, label }) => {
          const fromStory = new Set(storyRules[storyType] ?? []);
          const fromRole  = new Set(roleRules[role] ?? []);
          const all = new Set([...fromStory, ...fromRole]);
          const sections = CONTEXT_SECTIONS.filter((s) => all.has(s));

          return (
            <div key={label} className="px-4 py-3 flex items-start gap-4">
              <div className="w-36 shrink-0 pt-0.5">
                <p className="text-xs font-medium text-content-primary">{label}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 flex-1">
                {sections.map((s) => {
                  const fromSt = fromStory.has(s);
                  const fromRl = fromRole.has(s);
                  const both = fromSt && fromRl;
                  return (
                    <span
                      key={s}
                      title={both ? "from story type + agent role" : fromSt ? "from story type" : "from agent role"}
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                        both
                          ? "border-accent bg-accent text-white"
                          : fromSt
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-purple-300 bg-purple-50 text-purple-700"
                      }`}
                    >
                      {SECTION_META[s].short}
                    </span>
                  );
                })}
                {sections.length === 0 && <span className="text-xs text-content-tertiary italic">No sections</span>}
              </div>
              <span className="font-mono text-[10px] text-content-tertiary shrink-0 pt-0.5">{sections.length} sections</span>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 bg-surface-secondary/40">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-content-tertiary">
          <span className="size-2.5 rounded-full bg-accent inline-block" />Both layers
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-content-tertiary">
          <span className="size-2.5 rounded-full bg-accent-soft border border-accent/40 inline-block" />Story type only
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-content-tertiary">
          <span className="size-2.5 rounded-full bg-purple-100 border border-purple-300 inline-block" />Agent role only
        </span>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function SettingSection({
  title,
  description,
  dirty,
  onSave,
  onReset,
  saving,
  children,
}: {
  title: string;
  description: string;
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-content-primary">{title}</h2>
          <p className="text-xs text-content-secondary mt-1 max-w-xl">{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onReset}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            <RotateCcw size={11} />Reset
          </button>
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Save size={11} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {dirty && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-1.5 text-xs text-warning">
          <span className="size-1.5 rounded-full bg-warning" />Unsaved changes
        </div>
      )}
      <div className="rounded-xl border border-border bg-surface-card p-5">
        {children}
      </div>
    </section>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

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

export function SettingsPage() {
  const qc = useQueryClient();

  // Story type rules
  const storyQuery = useQuery({
    queryKey: ["settings", "execution_context_rules"],
    queryFn: () => api.settings.get<StoryTypeRules>("execution_context_rules"),
  });
  const [storyRules, setStoryRules] = useState<StoryTypeRules>(DEFAULT_STORY_TYPE_RULES);
  const [storyDirty, setStoryDirty] = useState(false);

  // Agent role rules
  const roleQuery = useQuery({
    queryKey: ["settings", "agent_role_context_rules"],
    queryFn: () => api.settings.get<AgentRoleRules>("agent_role_context_rules"),
  });
  const [roleRules, setRoleRules] = useState<AgentRoleRules>(DEFAULT_AGENT_ROLE_RULES);
  const [roleDirty, setRoleDirty] = useState(false);

  // Keyword rules
  const kwQuery = useQuery({
    queryKey: ["settings", "keyword_context_rules"],
    queryFn: () => api.settings.get<KeywordRule[]>("keyword_context_rules"),
  });
  const [kwRules, setKwRules] = useState<KeywordRule[]>(DEFAULT_KEYWORD_RULES);
  const [kwDirty, setKwDirty] = useState(false);

  useEffect(() => { if (storyQuery.data?.value) { setStoryRules(storyQuery.data.value); setStoryDirty(false); } }, [storyQuery.data]);
  useEffect(() => { if (roleQuery.data?.value)  { setRoleRules(roleQuery.data.value);   setRoleDirty(false); } }, [roleQuery.data]);
  useEffect(() => { if (kwQuery.data?.value)    { setKwRules(kwQuery.data.value);       setKwDirty(false); }  }, [kwQuery.data]);

  const storySave = useMutation({
    mutationFn: () => api.settings.put("execution_context_rules", storyRules),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "execution_context_rules"] }); setStoryDirty(false); toast.success("Story type rules saved"); },
  });
  const roleSave = useMutation({
    mutationFn: () => api.settings.put("agent_role_context_rules", roleRules),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "agent_role_context_rules"] }); setRoleDirty(false); toast.success("Agent role rules saved"); },
  });
  const kwSave = useMutation({
    mutationFn: () => api.settings.put("keyword_context_rules", kwRules),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "keyword_context_rules"] }); setKwDirty(false); toast.success("Keyword rules saved"); },
  });

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8">

        <div className="mb-7">
          <h1 className="text-xl font-bold tracking-tight text-content-primary">Settings</h1>
          <p className="text-xs text-content-secondary mt-1">
            Configure which project context sections are included when an agent executes a story.
            The final set is the <span className="font-mono text-accent">union</span> of all three layers.
          </p>
        </div>

        <div className="flex flex-col gap-8">

          {/* Agent runtime — claude-code config */}
          <AgentRuntimeSection />

          {/* API Keys */}
          <EnvVarsSection />

          {/* Layer 1: Story type */}
          <SettingSection
            title="Layer 1 — By Story Type"
            description="Context sections included based on what kind of work the story represents."
            dirty={storyDirty}
            onSave={() => storySave.mutate()}
            onReset={() => { setStoryRules(DEFAULT_STORY_TYPE_RULES); setStoryDirty(true); }}
            saving={storySave.isPending}
          >
            <Matrix
              rows={STORY_TYPES}
              rowMeta={STORY_TYPE_META}
              rules={storyRules}
              onChange={(r) => { setStoryRules(r as StoryTypeRules); setStoryDirty(true); }}
            />
          </SettingSection>

          {/* Layer 2: Agent role */}
          <SettingSection
            title="Layer 2 — By Agent Role"
            description="Additional context sections added based on the specialization of the assigned agent. These are merged (union) with the story type layer."
            dirty={roleDirty}
            onSave={() => roleSave.mutate()}
            onReset={() => { setRoleRules(DEFAULT_AGENT_ROLE_RULES); setRoleDirty(true); }}
            saving={roleSave.isPending}
          >
            <Matrix
              rows={AGENT_ROLES}
              rowMeta={AGENT_ROLE_META}
              rules={roleRules}
              onChange={(r) => { setRoleRules(r as AgentRoleRules); setRoleDirty(true); }}
            />
          </SettingSection>

          {/* Layer 3: Keywords */}
          <SettingSection
            title="Layer 3 — By Keyword Match"
            description="If the story title or description contains any of these keywords, the listed sections are added automatically. Applied on top of layers 1 and 2."
            dirty={kwDirty}
            onSave={() => kwSave.mutate()}
            onReset={() => { setKwRules(DEFAULT_KEYWORD_RULES); setKwDirty(true); }}
            saving={kwSave.isPending}
          >
            <KeywordRulesEditor
              rules={kwRules}
              onChange={(r) => { setKwRules(r); setKwDirty(true); }}
            />
          </SettingSection>

          {/* Combined preview */}
          <CombinedPreview
            storyRules={storyRules}
            roleRules={roleRules}
          />

          {/* How it works */}
          <div className="rounded-xl border border-border bg-surface-card p-4 text-xs text-content-secondary space-y-2">
            <p className="font-semibold text-content-primary text-[11px] uppercase tracking-wider font-mono">How the three layers combine</p>
            <p>
              <span className="font-mono text-accent">Layer 1</span> answers "what kind of story is this?"
              A bug needs the data model; a spike needs architecture.
            </p>
            <p>
              <span className="font-mono text-accent">Layer 2</span> answers "who is implementing it?"
              A frontend engineer needs the design system regardless of story type.
            </p>
            <p>
              <span className="font-mono text-accent">Layer 3</span> catches specifics that type and role don't cover —
              a backend story titled "Add JWT refresh token" should include the data model even if the agent role doesn't normally need it.
            </p>
            <p className="text-content-tertiary">
              Sections with no content in the project are automatically skipped. Future: per-project overrides.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
