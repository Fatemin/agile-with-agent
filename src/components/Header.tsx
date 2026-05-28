import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FolderKanban } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "text-xs px-2.5 py-1 rounded-md transition-colors",
        active
          ? "text-accent bg-accent-soft font-medium"
          : "text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary"
      )}
    >
      {label}
    </Link>
  );
}

function ProjectSwitcher({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-content-primary hover:bg-surface-tertiary transition-colors"
      >
        <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} />
        {project.name}
        <ChevronDown size={13} className="text-content-tertiary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-border bg-surface-card py-1 shadow-lg">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { navigate(`/projects/${p.id}`); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-secondary",
                  p.id === project.id ? "text-accent font-medium" : "text-content-primary"
                )}
              >
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="flex-1 text-left truncate">{p.name}</span>
                <span className="font-mono text-[10px] text-content-tertiary shrink-0">{p.key}</span>
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => { navigate("/projects"); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-tertiary hover:bg-surface-secondary transition-colors"
            >
              <FolderKanban size={13} />
              All projects
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-secondary shrink-0">
      <div className="flex items-center gap-2">
        <Link to="/" className="text-[15px] font-bold tracking-tight text-content-primary">
          Agile <span className="text-accent">×</span> Agent
        </Link>
        {project && (
          <>
            <span className="text-content-tertiary text-xs">/</span>
            <ProjectSwitcher project={project} />
          </>
        )}
      </div>
      <nav className="flex items-center gap-1">
        <NavLink to="/" label="Dashboard" active={location.pathname === "/"} />
        <NavLink to="/projects" label="Projects" active={location.pathname === "/projects"} />
        <NavLink to="/agents" label="Agents" active={location.pathname === "/agents"} />
      </nav>
    </header>
  );
}
