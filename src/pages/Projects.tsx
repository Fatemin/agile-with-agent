import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/types";

const PROJECT_COLORS = [
  "#22D3EE", "#8B5CF6", "#F59E0B", "#22C55E", "#EF4444", "#EC4899", "#F97316", "#14B8A6",
];

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", name: "", description: "", color: "#22D3EE" });

  const mutation = useMutation({
    mutationFn: () => api.projects.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      onClose();
      setForm({ key: "", name: "", description: "", color: "#22D3EE" });
    },
    onError: () => toast.error("Failed to create project"),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New Project">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 w-28">
            <Label htmlFor="key">Key</Label>
            <Input
              id="key"
              placeholder="PROJ"
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase().slice(0, 6) }))}
            />
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Project"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="desc">Description</Label>
          <Textarea
            id="desc"
            rows={3}
            placeholder="What is this project about?"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Color</Label>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className="size-6 rounded-full transition-transform hover:scale-110 focus:outline-none"
                style={{
                  backgroundColor: c,
                  outline: form.color === c ? `2px solid ${c}` : undefined,
                  outlineOffset: form.color === c ? "2px" : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="accent"
          onClick={() => mutation.mutate()}
          disabled={!form.key || !form.name || mutation.isPending}
        >
          Create
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--bg-secondary)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
          <span className="font-semibold text-[var(--text-primary)]">{project.name}</span>
        </div>
        <Badge variant="outline" className="font-mono text-[11px]">{project.key}</Badge>
      </div>
      {project.description && (
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{project.description}</p>
      )}
      <div className="flex items-center gap-3 mt-auto pt-1 border-t border-[var(--border)]">
        <span className="text-xs text-[var(--text-tertiary)]">
          {project.story_count ?? 0} stories
        </span>
        {(project.active_count ?? 0) > 0 && (
          <span className="text-xs text-[var(--accent)] font-medium">
            {project.active_count} in progress
          </span>
        )}
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Projects</h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
            Manage your agile projects
          </p>
        </div>
        <Button variant="accent" size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} />
          New Project
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-[var(--bg-secondary)] animate-pulse" />
          ))}
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <FolderKanban size={40} className="text-[var(--text-tertiary)]" />
          <p className="text-[var(--text-secondary)]">No projects yet</p>
          <Button variant="accent" size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} />
            Create your first project
          </Button>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}

      <CreateProjectDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
