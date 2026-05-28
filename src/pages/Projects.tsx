import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/types";

const PROJECT_COLORS = [
  "#0891B2", "#8B5CF6", "#F59E0B", "#22C55E", "#EF4444", "#EC4899", "#F97316", "#14B8A6",
];

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", name: "", description: "", color: "#0891B2" });
  const mutation = useMutation({
    mutationFn: () => api.projects.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      onClose();
      setForm({ key: "", name: "", description: "", color: "#0891B2" });
    },
    onError: () => toast.error("Failed to create project"),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New Project">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 w-28">
            <Label htmlFor="key">Key</Label>
            <Input id="key" placeholder="PROJ" value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase().slice(0, 6) }))} />
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="My Project" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea rows={3} placeholder="What is this project about?" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Color</Label>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))}
                className="size-6 rounded-full transition-transform hover:scale-110 focus:outline-none"
                style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: "2px" }}
              />
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={() => mutation.mutate()} disabled={!form.key || !form.name || mutation.isPending}>
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
      className="group relative block overflow-hidden rounded-lg border border-border bg-surface-secondary transition-all hover:-translate-y-px hover:border-accent/35"
    >
      <div className="h-[3px]" style={{ background: project.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-sm text-content-primary">{project.name}</h2>
          </div>
          <span className="font-mono text-[10px] text-content-tertiary shrink-0">{project.key}</span>
        </div>
        {project.description && (
          <p className="mt-2 text-xs text-content-secondary line-clamp-2 leading-5">{project.description}</p>
        )}
        <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3 font-mono text-[10px] text-content-tertiary">
          <span>{project.story_count ?? 0} stories</span>
          {(project.active_count ?? 0) > 0 && (
            <span className="text-accent">{project.active_count} active</span>
          )}
        </div>
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
    <div className="flex-1 overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-content-primary">Projects</h1>
            <p className="font-mono text-xs text-content-tertiary">
              {projects?.length ?? 0} projects
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-surface-primary transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            New project
          </button>
        </div>

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-lg border border-border bg-surface-secondary animate-pulse" />
            ))}
          </div>
        )}

        {projects?.length === 0 && (
          <div className="py-20 text-center">
            <FolderKanban size={32} className="mx-auto text-content-tertiary mb-3" />
            <p className="text-sm text-content-tertiary">No projects yet.</p>
            <button onClick={() => setOpen(true)} className="mt-2 text-sm text-accent hover:underline">
              Create your first project
            </button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}

        <CreateProjectDialog open={open} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
