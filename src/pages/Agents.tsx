import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, Provider } from "@/types";

const PROVIDERS: { value: Provider; label: string; color: string }[] = [
  { value: "claude", label: "Claude", color: "#F97316" },
  { value: "codex", label: "Codex", color: "#22D3EE" },
  { value: "copilot", label: "Copilot", color: "#8B5CF6" },
  { value: "gemini", label: "Gemini", color: "#22C55E" },
  { value: "custom", label: "Custom", color: "#A1A1AA" },
];

const DEFAULT_SYSTEM_PROMPT = `You are an expert software engineer. You will be given a user story with acceptance criteria.
Your goal is to implement the requirements fully, write tests, and ensure all existing tests pass.
Follow the project's coding conventions and style.`;

const DEFAULT_PROMPT_TEMPLATE = `## User Story
{{story_title}}

## Description
{{story_description}}

## Acceptance Criteria
{{acceptance_criteria}}

Please implement this user story. Make sure all acceptance criteria are met and tests pass.`;

interface AgentFormState {
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  prompt_template: string;
}

function AgentDialog({
  open, onClose, agent,
}: { open: boolean; onClose: () => void; agent?: Agent }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<AgentFormState>({
    name: agent?.name ?? "",
    provider: (agent?.provider as Provider) ?? "claude",
    model: agent?.model ?? "",
    system_prompt: agent?.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt_template: agent?.prompt_template ?? DEFAULT_PROMPT_TEMPLATE,
  });

  const mutation = useMutation({
    mutationFn: () =>
      agent
        ? api.agents.update(agent.id, { ...form, model: form.model || undefined })
        : api.agents.create({ ...form, model: form.model || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success(agent ? "Agent updated" : "Agent created");
      onClose();
    },
    onError: () => toast.error("Failed to save agent"),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={agent ? `Edit ${agent.name}` : "New Agent"}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name *</Label>
            <Input
              placeholder="My Agent"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <Select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 col-span-2">
            <Label>Model</Label>
            <Input
              placeholder={form.provider === "claude" ? "claude-sonnet-4-6" : form.provider === "codex" ? "o3" : ""}
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>System Prompt</Label>
            <span className="text-[11px] text-[var(--text-tertiary)]">Defines the agent's role and behavior</span>
          </div>
          <Textarea
            rows={6}
            className="font-mono text-xs"
            value={form.system_prompt}
            onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
            placeholder="You are an expert software engineer..."
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Prompt Template</Label>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              Use <code className="text-[var(--accent)]">{"{{story_title}}"}</code>,{" "}
              <code className="text-[var(--accent)]">{"{{story_description}}"}</code>,{" "}
              <code className="text-[var(--accent)]">{"{{acceptance_criteria}}"}</code>
            </span>
          </div>
          <Textarea
            rows={8}
            className="font-mono text-xs"
            value={form.prompt_template}
            onChange={(e) => setForm((f) => ({ ...f, prompt_template: e.target.value }))}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="accent"
          onClick={() => mutation.mutate()}
          disabled={!form.name || mutation.isPending}
        >
          {agent ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AgentCard({ agent, onEdit }: { agent: Agent; onEdit: () => void }) {
  const qc = useQueryClient();
  const providerInfo = PROVIDERS.find((p) => p.value === agent.provider);
  const deleteMutation = useMutation({
    mutationFn: () => api.agents.delete(agent.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); toast.success("Agent deleted"); },
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${providerInfo?.color}15` }}
          >
            <Bot size={18} style={{ color: providerInfo?.color }} />
          </div>
          <div>
            <p className="font-semibold text-[var(--text-primary)]">{agent.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-xs font-medium"
                style={{ color: providerInfo?.color }}
              >
                {providerInfo?.label}
              </span>
              {agent.model && (
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{agent.model}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="ghost" onClick={onEdit}>
            <Pencil size={13} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete ${agent.name}?`)) deleteMutation.mutate();
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-1.5">
          <Zap size={12} className="text-[var(--accent)]" />
          <span className="text-xs text-[var(--text-secondary)]">
            {agent.active_count ?? 0} active
          </span>
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">
          {agent.story_count ?? 0} total assigned
        </span>
      </div>

      {agent.system_prompt && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)] line-clamp-2 font-mono leading-relaxed">
          {agent.system_prompt}
        </p>
      )}
    </div>
  );
}

export function AgentsPage() {
  const [dialogState, setDialogState] = useState<{ open: boolean; agent?: Agent }>({ open: false });
  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Agents</h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
            Configure AI agents and their prompts
          </p>
        </div>
        <Button variant="accent" size="sm" onClick={() => setDialogState({ open: true })}>
          <Plus size={14} />
          New Agent
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-36 rounded-xl bg-[var(--bg-secondary)] animate-pulse" />
          ))}
        </div>
      )}

      {agents && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Bot size={40} className="text-[var(--text-tertiary)]" />
          <p className="text-[var(--text-secondary)]">No agents configured</p>
          <Button variant="accent" size="sm" onClick={() => setDialogState({ open: true })}>
            <Plus size={14} />
            Add your first agent
          </Button>
        </div>
      )}

      {agents && agents.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              onEdit={() => setDialogState({ open: true, agent: a })}
            />
          ))}
        </div>
      )}

      <AgentDialog
        open={dialogState.open}
        onClose={() => setDialogState({ open: false })}
        agent={dialogState.agent}
      />
    </div>
  );
}
