import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, FolderOpen, Github, Plus, Sparkles } from "lucide-react";
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

type Source = "none" | "local" | "github";

interface CreateForm {
  key: string;
  name: string;
  description: string;
  color: string;
  source: Source;
  is_existing: boolean;
  local_path: string;
  github_url: string;
}

const INITIAL_FORM: CreateForm = {
  key: "", name: "", description: "", color: "#0891B2",
  source: "none", is_existing: false, local_path: "", github_url: "",
};

const SOURCE_OPTIONS = [
  { value: "none" as Source, label: "No code yet", Icon: Sparkles },
  { value: "local" as Source, label: "Local directory", Icon: FolderOpen },
  { value: "github" as Source, label: "GitHub repo", Icon: Github },
];

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<CreateForm>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () => api.projects.create({
      key: form.key,
      name: form.name,
      description: form.description || undefined,
      color: form.color,
      local_path: form.source === "local" && form.local_path ? form.local_path : undefined,
      github_url: form.source === "github" && form.github_url ? form.github_url : undefined,
      is_existing: form.is_existing,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(form.is_existing ? "Project created and scanned" : "Project created");
      handleClose();
    },
    onError: () => toast.error("Failed to create project"),
  });

  const handleClose = () => {
    onClose();
    setStep(1);
    setForm(INITIAL_FORM);
  };

  const step2Valid =
    form.source === "none" ||
    (form.source === "local" && (!form.is_existing || form.local_path.trim() !== "")) ||
    (form.source === "github" && (!form.is_existing || form.github_url.trim() !== ""));

  return (
    <Dialog open={open} onClose={handleClose} title="New Project">
      <div className="flex gap-1.5 mb-5">
        {([1, 2] as const).map((s) => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? "bg-accent" : "bg-border"}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My Project"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  const autoKey = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
                  setForm((f) => ({ ...f, name, key: f.key || autoKey }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5 w-24">
              <Label htmlFor="key">Key</Label>
              <Input
                id="key"
                placeholder="PROJ"
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase().slice(0, 6) }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
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
                  style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: "2px" }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>Where is this project?</Label>
            <div className="grid grid-cols-3 gap-2">
              {SOURCE_OPTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, source: value, is_existing: false }))}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-xs transition-colors ${
                    form.source === value
                      ? "border-accent bg-accent/10 text-content-primary"
                      : "border-border text-content-secondary hover:border-accent/40 hover:text-content-primary"
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {form.source === "local" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="local_path">Directory path</Label>
                <Input
                  id="local_path"
                  placeholder="/Users/you/projects/my-app"
                  value={form.local_path}
                  onChange={(e) => setForm((f) => ({ ...f, local_path: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                {([false, true] as const).map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, is_existing: val }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs transition-colors ${
                      form.is_existing === val
                        ? "border-accent bg-accent/10 text-content-primary"
                        : "border-border text-content-secondary hover:text-content-primary"
                    }`}
                  >
                    {val ? "Existing project — scan for content" : "New project"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.source === "github" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="github_url">Repository URL</Label>
                <Input
                  id="github_url"
                  placeholder="https://github.com/owner/repo"
                  value={form.github_url}
                  onChange={(e) => setForm((f) => ({ ...f, github_url: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                {([false, true] as const).map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, is_existing: val }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs transition-colors ${
                      form.is_existing === val
                        ? "border-accent bg-accent/10 text-content-primary"
                        : "border-border text-content-secondary hover:text-content-primary"
                    }`}
                  >
                    {val ? "Existing project — scan for content" : "New project"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        {step === 1 ? (
          <>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button variant="accent" onClick={() => setStep(2)} disabled={!form.key || !form.name}>
              Next
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button
              variant="accent"
              onClick={() => mutation.mutate()}
              disabled={!step2Valid || mutation.isPending}
            >
              {mutation.isPending
                ? (form.is_existing ? "Scanning..." : "Creating...")
                : (form.is_existing ? "Create & Scan" : "Create")}
            </Button>
          </>
        )}
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
