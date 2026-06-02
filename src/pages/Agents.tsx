import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Bot, Briefcase, Bug, ChevronRight,
  Clock, History, Lightbulb, ListTodo,
  Pencil, RotateCw, Sparkles, Trash2, Users, Wrench,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Agent, AgentRole, AgentRun, AgentStatus, AgentStory, Provider, StoryStatus, StoryType } from "@/types";

dayjs.extend(relativeTime);

// ─── Providers ────────────────────────────────────────────────────────────────

const PROVIDERS: { value: Provider; label: string; color: string; envVar: string }[] = [
  { value: "claude",      label: "Claude API",             color: "#F97316", envVar: "ANTHROPIC_API_KEY" },
  { value: "claude-code", label: "Claude Code (local)",    color: "#D946EF", envVar: "CLAUDE_LOCAL_CLI / CLAUDE_LOCAL_ENDPOINT" },
  { value: "gemini",      label: "Gemini API",             color: "#22C55E", envVar: "GEMINI_API_KEY" },
  { value: "codex",       label: "Codex / OpenAI",         color: "#0891B2", envVar: "OPENAI_API_KEY" },
  { value: "codex-cli",  label: "Codex CLI (local)",      color: "#06B6D4", envVar: "CODEX_LOCAL_CLI / CODEX_LOCAL_ENDPOINT" },
  { value: "custom",      label: "Custom",                 color: "#A1A1AA", envVar: "" },
];

// ─── Role Templates ───────────────────────────────────────────────────────────

interface RoleTemplate {
  id: AgentRole;
  title: string;
  emoji: string;
  tagline: string;
  color: string;
  system_prompt: string;
  prompt_template: string;
  defaultModel: string;
}

const PROMPT_TEMPLATE = `## Story: {{story_title}}

## Description
{{story_description}}

## Acceptance Criteria
{{acceptance_criteria}}`;

const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "frontend",
    title: "Frontend Engineer",
    emoji: "🎨",
    tagline: "React · TypeScript · CSS · Accessibility",
    color: "#0891B2",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a senior frontend engineer. You specialize in building clean, accessible, and performant user interfaces using React and TypeScript.

When implementing stories, you:
- Write well-structured, reusable React components with clear props interfaces
- Use semantic HTML and follow WCAG accessibility guidelines
- Apply responsive design patterns that work across breakpoints
- Handle loading, error, and empty states explicitly
- Keep components small and focused — split when a component exceeds ~150 lines
- Follow existing naming conventions and code style found in the project
- Write clean, idiomatic TypeScript — avoid "any", define precise types
- Do not add features or abstractions beyond what the story requires`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "backend",
    title: "Backend Engineer",
    emoji: "⚙️",
    tagline: "API · Database · Node.js · Performance",
    color: "#8B5CF6",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a senior backend engineer. You specialize in building robust, well-structured APIs and backend services.

When implementing stories, you:
- Design clean REST (or GraphQL) endpoints with consistent naming and status codes
- Write SQL/ORM queries that are efficient and safe from injection
- Validate all inputs at the boundary — never trust client data
- Handle errors with meaningful messages and appropriate HTTP codes
- Keep business logic out of route handlers — use service layers when warranted
- Write idempotent migrations that are safe to run on existing data
- Follow the project's existing conventions for file structure and naming
- Do not over-engineer — choose the simplest solution that satisfies the requirements`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "fullstack",
    title: "Full Stack Engineer",
    emoji: "⚡",
    tagline: "End-to-end · Frontend · Backend · Integration",
    color: "#F59E0B",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a full stack engineer comfortable working across the entire codebase. You implement features end-to-end — from database schema to API endpoint to UI component.

When implementing stories, you:
- Start from the data model, then build the API, then the UI
- Keep the frontend and backend contracts explicit (typed request/response shapes)
- Validate inputs on the server even if the client validates too
- Ensure UI states reflect real backend states (loading, error, success)
- Write minimal, focused changes — avoid touching code outside the scope of the story
- Follow existing project conventions at every layer
- Think about the full user journey, not just the happy path`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "qa",
    title: "QA Engineer",
    emoji: "🧪",
    tagline: "Testing · Quality · Bug Detection · Automation",
    color: "#22C55E",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a QA engineer responsible for ensuring features are correct, reliable, and edge-case-proof.

When working on stories, you:
- Write comprehensive test cases covering the happy path, edge cases, and error conditions
- Think from a user's perspective — what would go wrong in real usage?
- Write unit tests for logic, integration tests for API endpoints, E2E tests for critical flows
- Identify missing or ambiguous acceptance criteria and flag them
- Document test steps clearly so they can be run manually or automated
- Look for regressions — does this change break anything nearby?
- Prioritize test coverage for high-risk or frequently-broken areas
- Keep tests readable and maintainable — test behavior, not implementation`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "devops",
    title: "DevOps Engineer",
    emoji: "🚀",
    tagline: "CI/CD · Docker · Infrastructure · Deployment",
    color: "#EF4444",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a DevOps engineer focused on build, deployment, and infrastructure automation.

When implementing stories, you:
- Write clear, idempotent infrastructure-as-code (Dockerfile, CI/CD pipelines, scripts)
- Ensure deployments are zero-downtime and rollback-safe
- Follow the principle of least privilege for service accounts and credentials
- Make environment configs explicit through environment variables, never hardcoded
- Monitor deployment health — add readiness/health checks where appropriate
- Document runbooks for new services or non-obvious operations
- Keep pipelines fast — identify and parallelize where possible
- Never commit secrets — use secret managers or CI secret stores`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "techlead",
    title: "Tech Lead",
    emoji: "🏗️",
    tagline: "Architecture · Design · Code Review · Standards",
    color: "#64748b",
    defaultModel: "claude-opus-4-7",
    system_prompt:
`You are a tech lead responsible for code quality, architecture decisions, and engineering standards.

When reviewing or implementing stories, you:
- Evaluate architectural fit — does this approach scale? does it align with existing patterns?
- Identify technical debt being introduced and call it out explicitly
- Break complex stories into smaller, shippable units of work
- Write detailed technical design notes when the implementation approach isn't obvious
- Enforce consistency — naming, patterns, error handling, and testing standards
- Think about long-term maintainability, not just making the tests pass
- Ask the right questions when requirements are ambiguous rather than guessing
- Consider security, performance, and observability implications in every change`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "security",
    title: "Security Engineer",
    emoji: "🔒",
    tagline: "Security Review · Auth · Vulnerabilities · Compliance",
    color: "#EC4899",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a security engineer focused on identifying and preventing security vulnerabilities.

When reviewing or implementing stories, you:
- Check for OWASP Top 10 vulnerabilities: injection, XSS, broken auth, IDOR, etc.
- Review authentication and authorization logic carefully — ensure users can only access their own data
- Validate that all inputs are sanitized and outputs are encoded correctly
- Audit dependencies for known vulnerabilities
- Ensure sensitive data (passwords, tokens, PII) is handled, stored, and transmitted securely
- Review logging to ensure no sensitive data is leaked in logs
- Check for insecure direct object references when fetching resources by ID
- Flag security concerns with clear severity levels (critical, high, medium, low)`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "docs",
    title: "Documentation Engineer",
    emoji: "📚",
    tagline: "Context · Architecture Docs · Codebase Analysis",
    color: "#F59E0B",
    defaultModel: "claude-sonnet-4-6",
    system_prompt:
`You are a technical documentation engineer. You specialise in analysing software projects and writing clear, accurate documentation for developers.

When generating project context, you:
- Read the codebase carefully before writing anything
- Document only what you actually observe — never fabricate or guess
- Write concisely in Markdown: use headers, bullet points, and code blocks where appropriate
- Cover: project purpose, tech stack, architecture, data models, UI patterns, coding conventions, and domain terms
- Prioritise what a new developer would need to understand to be productive
- Skip sections where you genuinely lack enough information`,
    prompt_template: PROMPT_TEMPLATE,
  },
  {
    id: "custom",
    title: "Custom Role",
    emoji: "✏️",
    tagline: "Define your own specialization",
    color: "#A1A1AA",
    defaultModel: "",
    system_prompt:
`You are a software engineer assigned to implement user stories.
Your goal is to implement the requirements fully, write tests, and ensure all existing tests pass.
Follow the project's coding conventions and style.`,
    prompt_template: PROMPT_TEMPLATE,
  },
];

// Model options per provider (selectable). Keep lightweight list for UX.
const MODEL_OPTIONS: Record<string, string[]> = {
  claude:        ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  "claude-code": ["claude-sonnet-4-6", "claude-opus-4-7"],
  gemini:        ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  codex:         ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-4o", "o3", "o4-mini"],
  "codex-cli":   ["codex-mini-latest", "o4-mini", "gpt-4.1"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: StoryStatus[] = ["in_progress"];

function deriveStatus(agent: Agent): AgentStatus {
  if (!agent.active_count || agent.active_count === 0) return "idle";
  return "in_progress";
}

const STATUS_DOT: Record<AgentStatus, string> = {
  idle:        "bg-green-400",
  in_progress: "bg-cyan-400 animate-pulse-dot",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:        "Idle",
  in_progress: "In Progress",
};

const STORY_STATUS_META: Record<StoryStatus, { label: string; cls: string }> = {
  backlog:      { label: "Backlog",      cls: "bg-surface-tertiary text-content-tertiary" },
  todo:         { label: "Todo",         cls: "bg-surface-tertiary text-content-secondary" },
  in_progress:  { label: "In Progress",  cls: "bg-cyan-50 text-cyan-700 border border-cyan-200" },
  human_review: { label: "Human Review", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  done:         { label: "Done",         cls: "bg-green-50 text-green-700 border border-green-200" },
  cancelled:    { label: "Cancelled",    cls: "bg-red-50 text-red-700 border border-red-200" },
};

const TYPE_ICONS: Record<StoryType, React.ElementType> = {
  story: ListTodo, bug: Bug, task: Wrench, spike: Lightbulb,
};

const TYPE_COLORS: Record<StoryType, string> = {
  story: "#06b6d4", bug: "#EF4444", task: "#8B5CF6", spike: "#F59E0B",
};

// ─── Agent Runs Section ───────────────────────────────────────────────────────

const RUN_TYPE_META: Record<string, { label: string; cls: string }> = {
  plan:      { label: "Plan",    cls: "text-purple-600 bg-purple-50 border border-purple-200" },
  design:    { label: "Design",  cls: "text-amber-600 bg-amber-50 border border-amber-200" },
  implement: { label: "Impl",    cls: "text-cyan-600 bg-cyan-50 border border-cyan-200" },
  qa:        { label: "QA",      cls: "text-green-600 bg-green-50 border border-green-200" },
  execute:   { label: "Execute", cls: "text-accent bg-accent/10 border border-accent/20" },
  single:    { label: "Execute", cls: "text-accent bg-accent/10 border border-accent/20" },
};

function AgentRunsSection({ agentId }: { agentId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", "agent", agentId],
    queryFn: () => api.runs.list({ agent_id: agentId }),
    refetchInterval: 15_000,
  });

  if (runs.length === 0) return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
        <Sparkles size={10} />Execution Runs
      </h3>
      <p className="text-[11px] text-content-tertiary/60 italic">No runs recorded yet.</p>
    </section>
  );

  const totalTokens = runs.reduce((s, r) => s + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Sparkles size={10} />Execution Runs — {runs.length}</span>
        <span className="font-normal normal-case">
          {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tokens total
        </span>
      </h3>
      <div className="flex flex-col gap-1.5">
        {runs.map((run: AgentRun) => {
          const meta = RUN_TYPE_META[run.run_type] ?? RUN_TYPE_META.execute;
          const tokTotal = (run.tokens_in ?? 0) + (run.tokens_out ?? 0);
          const isExp = expanded === run.id;
          return (
            <div key={run.id} className="rounded-lg border border-border bg-surface-card overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-secondary/40 transition-colors"
                onClick={() => setExpanded(isExp ? null : run.id)}
              >
                <span className={cn("font-mono text-[9px] rounded px-1.5 py-0.5 shrink-0", meta.cls)}>{meta.label}</span>
                <span className="text-[11px] text-content-secondary flex-1 truncate font-mono">
                  {run.model?.split("-").slice(-2).join("-") ?? "—"}
                </span>
                <span className="font-mono text-[9px] text-content-tertiary shrink-0">
                  {tokTotal >= 1000 ? `${(tokTotal / 1000).toFixed(1)}k` : tokTotal}tok · {run.turns}t
                </span>
                <span className="font-mono text-[9px] text-content-tertiary/60 shrink-0">
                  {dayjs(run.created_at).format("MM-DD HH:mm")}
                </span>
              </div>
              {isExp && (
                <div className="border-t border-border p-3 bg-surface-secondary/30 flex flex-col gap-2.5">
                  <div className="flex gap-3 text-[10px] text-content-tertiary font-mono">
                    <span>↑ {run.tokens_in} in</span>
                    <span>↓ {run.tokens_out} out</span>
                    <span>{run.turns} turns</span>
                  </div>
                  {run.prompt_text && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Context</span>
                      <pre className="text-[10px] font-mono whitespace-pre-wrap text-content-secondary bg-surface-tertiary rounded p-2 max-h-36 overflow-y-auto">
                        {run.prompt_text}
                      </pre>
                    </div>
                  )}
                  {run.output_text && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-content-tertiary">Output</span>
                      <pre className="text-[10px] font-mono whitespace-pre-wrap text-content-secondary bg-surface-tertiary rounded p-2 max-h-36 overflow-y-auto">
                        {run.output_text}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Story Row (in detail dialog) ─────────────────────────────────────────────

function StoryHistoryRow({ s }: { s: AgentStory }) {
  const Icon = TYPE_ICONS[s.type] ?? ListTodo;
  const meta = STORY_STATUS_META[s.status];
  const isActive = ACTIVE_STATUSES.includes(s.status);

  return (
    <div className={cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 border transition-colors",
      isActive ? "border-accent/20 bg-accent/[0.03]" : "border-border/50 bg-surface-card"
    )}>
      <Icon size={11} style={{ color: TYPE_COLORS[s.type] }} className="shrink-0" />
      <span className="font-mono text-[10px] text-content-tertiary shrink-0">{s.key}</span>
      <span className="text-xs text-content-primary truncate flex-1">{s.title}</span>

      {s.qa_result && (
        <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0",
          s.qa_result === "pass"
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200"
        )}>
          {s.qa_result === "pass" ? "pass" : "fail"}
        </span>
      )}

      <span className={cn("shrink-0 inline-flex rounded-full px-2 py-0.5 font-mono text-[9px]", meta.cls)}>
        {meta.label}
      </span>

      <span className="font-mono text-[9px] text-content-tertiary shrink-0">
        {dayjs(s.updated_at).fromNow()}
      </span>
    </div>
  );
}

// ─── Agent Detail Dialog ──────────────────────────────────────────────────────

function AgentDetailDialog({ agent, onClose, onEdit }: {
  agent: Agent;
  onClose: () => void;
  onEdit: () => void;
}) {
  const role = ROLE_TEMPLATES.find((r) => r.id === agent.role) ?? ROLE_TEMPLATES.find((r) => r.id === "custom")!;
  const prov = PROVIDERS.find((p) => p.value === agent.provider);

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["agent-stories", agent.id],
    queryFn: () => api.agents.stories(agent.id),
    refetchInterval: 10_000,
  });

  const active  = stories.filter((s) => ACTIVE_STATUSES.includes(s.status));
  const past    = stories.filter((s) => !ACTIVE_STATUSES.includes(s.status));

  // Derive granular status from actual story statuses
  const agentStatus: AgentStatus =
    active.some((s) => s.status === "in_progress") ? "in_progress" :
    "idle";

  const passCount = past.filter((s) => s.qa_result === "pass").length;
  const failCount = past.filter((s) => s.qa_result === "fail").length;

  return (
    <Dialog open onClose={onClose} className="max-w-2xl max-h-[88vh] overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-border shrink-0">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-xl text-3xl leading-none border border-border bg-surface-secondary"
          style={{ boxShadow: `0 0 0 2px ${role.color}30` }}
        >
          {role.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-sm text-content-primary">{agent.name}</h2>
            {/* Status pill */}
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              agentStatus === "idle"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-cyan-50 text-cyan-700 border border-cyan-200"
            )}>
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[agentStatus])} />
              {STATUS_LABEL[agentStatus]}
            </span>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">{role.title}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px]"
              style={{ borderColor: `${prov?.color}40`, color: prov?.color, background: `${prov?.color}10` }}
            >
              {prov?.label}
            </span>
            {agent.model && (
              <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary rounded px-1.5 py-0.5 border border-border">
                {agent.model}
              </span>
            )}
            <span className="font-mono text-[10px] text-content-tertiary ml-auto">
              {stories.length} total · {active.length} active
              {(passCount + failCount) > 0 && ` · ${passCount} pass / ${failCount} fail`}
            </span>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-secondary rounded-lg transition-colors shrink-0"
        >
          <Pencil size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto scrollbar-column p-5 flex flex-col gap-5">
        {isLoading && (
          <div className="flex flex-col gap-2">
            {[0,1,2].map((i) => <div key={i} className="h-9 rounded-lg bg-surface-secondary animate-pulse" />)}
          </div>
        )}

        {/* Active tasks */}
        {active.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
              <Bot size={10} className="text-accent" />
              Active — {active.length}
            </h3>
            <div className="flex flex-col gap-1.5">
              {active.map((s) => <StoryHistoryRow key={s.id} s={s} />)}
            </div>
          </section>
        )}

        {agentStatus === "idle" && !isLoading && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5">
            <span className="size-2 rounded-full bg-green-400 shrink-0" />
            <span className="text-xs text-green-700 font-medium">Available — no active assignments</span>
          </div>
        )}

        {/* History */}
        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-content-tertiary flex items-center gap-1.5">
              <History size={10} />
              History — {past.length}
            </h3>
            <div className="flex flex-col gap-1.5">
              {past.map((s) => <StoryHistoryRow key={s.id} s={s} />)}
            </div>
          </section>
        )}

        {!isLoading && stories.length === 0 && (
          <div className="py-10 text-center text-content-tertiary">
            <Clock size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No stories assigned yet</p>
          </div>
        )}

        {/* Execution runs */}
        <AgentRunsSection agentId={agent.id} />
      </div>
    </Dialog>
  );
}

// ─── Hire Dialog ──────────────────────────────────────────────────────────────

interface HireForm {
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  prompt_template: string;
}

function HireDialog({ open, onClose, agent }: { open: boolean; onClose: () => void; agent?: Agent }) {
  const qc = useQueryClient();
  const existingRole = ROLE_TEMPLATES.find((r) => r.id === agent?.role) ?? null;

  const [selectedRole, setSelectedRole] = useState<RoleTemplate | null>(existingRole);
  const [form, setForm] = useState<HireForm>({
    name: agent?.name ?? "",
    provider: (agent?.provider as Provider) ?? "claude",
    model: agent?.model ?? existingRole?.defaultModel ?? "",
    system_prompt: agent?.system_prompt ?? existingRole?.system_prompt ?? "",
    prompt_template: agent?.prompt_template ?? existingRole?.prompt_template ?? PROMPT_TEMPLATE,
  });

  const isEditing = !!agent;
  const step = !isEditing && !selectedRole ? 1 : 2;

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        role: selectedRole?.id ?? "custom",
        provider: form.provider,
        model: form.model || null,
        system_prompt: form.system_prompt || null,
        prompt_template: form.prompt_template || null,
      };
      return agent ? api.agents.update(agent.id, payload) : api.agents.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success(agent ? `${form.name} updated` : `${form.name} hired!`);
      handleClose();
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleClose = () => {
    onClose();
    setSelectedRole(existingRole);
    setForm({
      name: agent?.name ?? "",
      provider: (agent?.provider as Provider) ?? "claude",
      model: agent?.model ?? existingRole?.defaultModel ?? "",
      system_prompt: agent?.system_prompt ?? existingRole?.system_prompt ?? "",
      prompt_template: agent?.prompt_template ?? existingRole?.prompt_template ?? PROMPT_TEMPLATE,
    });
  };

  const selectRole = (role: RoleTemplate) => {
    setSelectedRole(role);
        setForm((f) => ({
          ...f,
          model: role.defaultModel,
      system_prompt: role.system_prompt,
      prompt_template: role.prompt_template,
    }));
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={step === 1 ? "Hire a New Engineer" : isEditing ? `Edit ${agent?.name}` : `Hire ${selectedRole?.title}`}
      className="max-w-2xl"
    >
      {step === 1 ? (
        <>
          <p className="text-xs text-content-secondary mb-5">Choose a specialization for your new team member.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {ROLE_TEMPLATES.map((role) => (
              <button
                key={role.id}
                onClick={() => selectRole(role)}
                className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-all hover:border-accent/50 hover:bg-accent-soft hover:-translate-y-px focus:outline-none"
              >
                <span className="text-3xl leading-none">{role.emoji}</span>
                <span className="text-xs font-semibold text-content-primary leading-tight">{role.title}</span>
                <span className="text-[10px] text-content-tertiary leading-tight">{role.tagline}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          </DialogFooter>
        </>
      ) : (
        <>
          {selectedRole && (
            <div className="flex items-center gap-3 mb-5 p-3 rounded-lg border border-border bg-surface-secondary">
              <span className="text-2xl leading-none">{selectedRole.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-content-primary">{selectedRole.title}</p>
                <p className="text-[11px] text-content-tertiary">{selectedRole.tagline}</p>
              </div>
              {!isEditing && (
                <button onClick={() => setSelectedRole(null)} className="ml-auto text-[11px] text-accent hover:underline shrink-0">
                  Change role
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. Alice Chen"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Powered by</Label>
                <Select
                  value={form.provider}
                  onChange={(e) => {
                    const newProv = e.target.value as Provider;
                    // Reset model to provider default when switching providers
                    const providerDefault = MODEL_OPTIONS[newProv]?.[0] ?? "";
                    setForm((f) => ({ ...f, provider: newProv, model: providerDefault }));
                  }}
                >
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Model <span className="font-normal text-content-tertiary">(optional)</span></Label>
                {MODEL_OPTIONS[form.provider] ? (
                  <div className="flex gap-2">
                    <Select
                      value={MODEL_OPTIONS[form.provider].includes(form.model || "") ? form.model : "__custom"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__custom") setForm((f) => ({ ...f, model: "" }));
                        else setForm((f) => ({ ...f, model: v }));
                      }}
                    >
                      {MODEL_OPTIONS[form.provider].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value="__custom">Custom...</option>
                    </Select>
                    {(!MODEL_OPTIONS[form.provider].includes(form.model || "")) && (
                      <Input
                        placeholder="custom model id"
                        value={form.model}
                        onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    placeholder={
                      form.provider === "codex" ? "gpt-5.5" :
                      form.provider === "codex-cli" ? "codex-mini-latest" :
                      form.provider === "gemini" ? "gemini-3.5-flash" :
                      "model id"
                    }
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  />
                )}
                {/* Env var hint per provider */}
                {(() => {
                  const prov = PROVIDERS.find((p) => p.value === form.provider);
                  if (!prov?.envVar) return null;
                  const hints: Record<string, string> = {
                    "claude":      "Requires ANTHROPIC_API_KEY",
                    "claude-code": "Requires CLAUDE_LOCAL_CLI or CLAUDE_LOCAL_ENDPOINT on the server",
                    "gemini":      "Requires GEMINI_API_KEY",
                    "codex":       "Requires OPENAI_API_KEY — supports gpt-5.5, gpt-5.4, gpt-5.3-codex and other OpenAI models",
                    "codex-cli":   "Requires CODEX_LOCAL_CLI or CODEX_LOCAL_ENDPOINT on the server",
                  };
                  return (
                    <p className="text-[10px] text-content-tertiary">
                      {hints[form.provider] ?? `Requires ${prov.envVar}`}
                    </p>
                  );
                })()}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>System Instructions</Label>
                <span className="text-[10px] text-content-tertiary">Defines how this engineer works</span>
              </div>
              <Textarea
                rows={8}
                className="font-mono text-xs leading-relaxed"
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            {!isEditing && <Button variant="ghost" onClick={() => setSelectedRole(null)}>← Back</Button>}
            {isEditing && <Button variant="ghost" onClick={handleClose}>Cancel</Button>}
            <Button
              variant="accent"
              onClick={() => mutation.mutate()}
              disabled={!form.name || mutation.isPending}
            >
              {mutation.isPending
                ? (isEditing ? "Saving…" : "Hiring…")
                : (isEditing ? "Save Changes" : `Hire ${selectedRole?.title ?? "Engineer"}`)}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, onOpenDetail, onEdit }: {
  agent: Agent;
  onOpenDetail: () => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const role = ROLE_TEMPLATES.find((r) => r.id === agent.role) ?? ROLE_TEMPLATES.find((r) => r.id === "custom")!;
  const prov = PROVIDERS.find((p) => p.value === agent.provider);
  const active = agent.active_count ?? 0;
  const total  = agent.story_count ?? 0;
  const status = deriveStatus(agent);

  const deleteMutation = useMutation({
    mutationFn: () => api.agents.delete(agent.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); toast.success(`${agent.name} let go`); },
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenDetail(); }}
      className="group relative overflow-hidden rounded-xl border border-border bg-surface-card transition-all hover:-translate-y-px hover:shadow-sm hover:border-content-tertiary/40 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {/* Role color bar */}
      <div className="h-[3px]" style={{ background: role.color }} />

      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Avatar + status dot */}
          <div className="relative shrink-0">
            <div
              className="flex size-12 items-center justify-center rounded-xl text-2xl leading-none border border-border bg-surface-secondary"
              style={{ boxShadow: `0 0 0 1px ${role.color}25` }}
            >
              {role.emoji}
            </div>
            {/* Status indicator */}
            <span className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-card",
              STATUS_DOT[status]
            )} />
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-semibold text-sm text-content-primary truncate">{agent.name}</h2>
              <ChevronRight size={12} className="text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
            <p className="text-xs text-content-secondary mt-0.5">{role.title}</p>

            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span
                className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px]"
                style={{ borderColor: `${prov?.color}40`, color: prov?.color, background: `${prov?.color}10` }}
              >
                {prov?.label}
              </span>
              {agent.model && (
                <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary rounded px-1.5 py-0.5 border border-border truncate max-w-[120px]">
                  {agent.model}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div
            className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-secondary transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm(`Let go of ${agent.name}?`)) deleteMutation.mutate(); }}
              className="p-1.5 rounded text-content-tertiary hover:text-error hover:bg-surface-secondary transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* System prompt preview */}
        {agent.system_prompt && (
          <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-content-tertiary border-t border-border/60 pt-3">
            {agent.system_prompt}
          </p>
        )}
      </div>

      {/* Footer — workload */}
      <div className="flex items-center gap-3 border-t border-border/60 px-5 py-2.5">
        {active > 0 ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
            <RotateCw size={10} className="animate-spin" />
            {active} active {active === 1 ? "task" : "tasks"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-green-600">
            <span className="size-1.5 rounded-full bg-green-400" />
            Idle
          </span>
        )}
        <span className="font-mono text-[10px] text-content-tertiary ml-auto flex items-center gap-1">
          <History size={9} />{total} total
        </span>
      </div>
    </div>
  );
}

// ─── Agents Page ──────────────────────────────────────────────────────────────

export function AgentsPage() {
  const [hireState, setHireState]     = useState<{ open: boolean; agent?: Agent }>({ open: false });
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
    refetchInterval: 10_000,
  });

  const totalActive = agents.reduce((sum, a) => sum + (a.active_count ?? 0), 0);
  const idleCount   = agents.filter((a) => !a.active_count || a.active_count === 0).length;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">

        <div className="mb-7 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-content-primary flex items-center gap-2">
              <Users size={18} className="text-content-tertiary" />
              Engineering Team
            </h1>
            <p className="text-xs text-content-secondary mt-1 flex items-center gap-2">
              <span>{agents.length} engineer{agents.length !== 1 ? "s" : ""}</span>
              {totalActive > 0 && (
                <>
                  <span className="text-content-tertiary">·</span>
                  <span className="flex items-center gap-1 text-accent">
                    <RotateCw size={9} className="animate-spin" />{totalActive} active
                  </span>
                </>
              )}
              {idleCount > 0 && (
                <>
                  <span className="text-content-tertiary">·</span>
                  <span className="flex items-center gap-1 text-green-600">
                    <span className="size-1.5 rounded-full bg-green-400" />{idleCount} idle
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => setHireState({ open: true })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Briefcase size={13} />
            Hire Engineer
          </button>
        </div>

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-48 rounded-xl border border-border bg-surface-secondary animate-pulse" />)}
          </div>
        )}

        {!isLoading && agents.length === 0 && (
          <div className="py-24 text-center">
            <div className="text-5xl mb-4">👥</div>
            <p className="text-sm font-medium text-content-primary mb-1">Your team is empty</p>
            <p className="text-xs text-content-tertiary mb-4">Hire your first engineer to start delegating stories</p>
            <button
              onClick={() => setHireState({ open: true })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90"
            >
              <Briefcase size={13} />Hire your first engineer
            </button>
          </div>
        )}

        {agents.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                onOpenDetail={() => setDetailAgent(a)}
                onEdit={() => setHireState({ open: true, agent: a })}
              />
            ))}
          </div>
        )}
      </div>

      <HireDialog
        open={hireState.open}
        onClose={() => setHireState({ open: false })}
        agent={hireState.agent}
      />

      {detailAgent && (
        <AgentDetailDialog
          agent={detailAgent}
          onClose={() => setDetailAgent(null)}
          onEdit={() => { setDetailAgent(null); setHireState({ open: true, agent: detailAgent }); }}
        />
      )}
    </div>
  );
}
