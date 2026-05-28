import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
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
  { value: "claude",  label: "Claude",  color: "#F97316" },
  { value: "codex",   label: "Codex",   color: "#0891B2" },
  { value: "copilot", label: "Copilot", color: "#8B5CF6" },
  { value: "gemini",  label: "Gemini",  color: "#22C55E" },
  { value: "custom",  label: "Custom",  color: "#A1A1AA" },
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
  name: string; provider: Provider; model: string;
  system_prompt: string; prompt_template: string;
}

function AgentDialog({ open, onClose, agent }: { open: boolean; onClose: () => void; agent?: Agent }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<AgentFormState>({
    name: agent?.name ?? "",
    provider: (agent?.provider as Provider) ?? "claude",
    model: agent?.model ?? "",
    system_prompt: agent?.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt_template: agent?.prompt_template ?? DEFAULT_PROMPT_TEMPLATE,
  });
  const mutation = useMutation({
    mutationFn: () => agent
      ? api.agents.update(agent.id, { ...form, model: form.model || undefined })
      : api.agents.create({ ...form, model: form.model || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); toast.success(agent ? "Agent updated" : "Agent created"); onClose(); },
    onError: () => toast.error("Failed to save agent"),
  });

  return (
    <Dialog open={open} onClose={onClose} title={agent ? `Edit ${agent.name}` : "New Agent"} className="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name *</Label>
            <Input placeholder="My Agent" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <Select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 col-span-2">
            <Label>Model <span className="text-content-tertiary font-normal">(optional)</span></Label>
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
            <span className="text-[11px] text-content-tertiary">Defines the agent's role</span>
          </div>
          <Textarea rows={6} className="font-mono text-xs leading-relaxed" value={form.system_prompt}
            onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Prompt Template</Label>
            <span className="text-[11px] text-content-tertiary">
              <code className="text-accent">{"{{story_title}}"}</code>{" "}
              <code className="text-accent">{"{{story_description}}"}</code>{" "}
              <code className="text-accent">{"{{acceptance_criteria}}"}</code>
            </span>
          </div>
          <Textarea rows={8} className="font-mono text-xs leading-relaxed" value={form.prompt_template}
            onChange={(e) => setForm((f) => ({ ...f, prompt_template: e.target.value }))} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
          {agent ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AgentCard({ agent, onEdit }: { agent: Agent; onEdit: () => void }) {
  const qc = useQueryClient();
  const prov = PROVIDERS.find((p) => p.value === agent.provider);
  const deleteMutation = useMutation({
    mutationFn: () => api.agents.delete(agent.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); toast.success("Agent deleted"); },
  });

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-surface-secondary transition-all hover:-translate-y-px hover:border-accent/35">
      <div className="h-[3px]" style={{ background: prov?.color }} />
      <div className="flex flex-col items-center px-5 pb-4 pt-5 text-center">
        <div
          className="flex size-[60px] shrink-0 items-center justify-center rounded-lg border border-border bg-surface-primary"
          style={{ boxShadow: `0 0 0 1px ${prov?.color}20` }}
        >
          <Bot size={24} style={{ color: prov?.color }} />
        </div>
        <h2 className="mt-3 max-w-full truncate font-mono text-base font-bold text-content-primary">{agent.name}</h2>
        <div className="mt-0.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-primary/70 px-2.5 py-1 font-mono text-[10px] text-content-tertiary">
          <span className="text-content-secondary" style={{ color: prov?.color }}>{prov?.label}</span>
          {agent.model && <><span className="text-content-tertiary/70">·</span><span className="truncate">{agent.model}</span></>}
        </div>
        {agent.system_prompt && (
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-content-secondary">{agent.system_prompt}</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 font-mono text-[10px] text-content-tertiary">
        <span>{agent.active_count ?? 0} active</span>
        <span>{agent.story_count ?? 0} total</span>
        <div className="flex gap-1">
          <button onClick={onEdit} className="p-1 hover:text-content-primary transition-colors"><Pencil size={12} /></button>
          <button onClick={() => { if (confirm(`Delete ${agent.name}?`)) deleteMutation.mutate(); }}
            className="p-1 hover:text-error transition-colors"><Trash2 size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const [dialogState, setDialogState] = useState<{ open: boolean; agent?: Agent }>({ open: false });
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents.list() });

  return (
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-content-primary">Agents</h1>
            <p className="font-mono text-xs text-content-tertiary">
              {agents?.filter((a) => (a.active_count ?? 0) > 0).length ?? 0}/{agents?.length ?? 0} active
            </p>
          </div>
          <button
            onClick={() => setDialogState({ open: true })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-surface-primary transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            New agent
          </button>
        </div>

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-56 rounded-lg border border-border bg-surface-secondary animate-pulse" />)}
          </div>
        )}

        {agents?.length === 0 && (
          <div className="py-20 text-center">
            <Bot size={32} className="mx-auto text-content-tertiary mb-3" />
            <p className="text-sm text-content-tertiary">No agents configured.</p>
            <button onClick={() => setDialogState({ open: true })} className="mt-2 text-sm text-accent hover:underline">
              Add your first agent
            </button>
          </div>
        )}

        {agents && agents.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={() => setDialogState({ open: true, agent: a })} />
            ))}
          </div>
        )}

        <AgentDialog open={dialogState.open} onClose={() => setDialogState({ open: false })} agent={dialogState.agent} />
      </div>
    </div>
  );
}
