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
        "px-2.5 py-1 rounded-md text-xs transition-colors",
        active
          ? "text-[var(--accent)] bg-[var(--accent-soft)] font-medium"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
      )}
    >
      {label}
    </Link>
  );
}

function ProjectSwitcher({ currentProject }: { currentProject?: Project }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  if (!currentProject) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <span className="size-2 rounded-full" style={{ backgroundColor: currentProject.color }} />
        {currentProject.name}
        <ChevronDown size={13} className="text-[var(--text-tertiary)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] py-1 shadow-lg">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { navigate(`/projects/${p.id}`); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-secondary)]",
                  p.id === currentProject.id ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)]"
                )}
              >
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                {p.name}
                <span className="ml-auto font-mono text-[11px] text-[var(--text-tertiary)]">{p.key}</span>
              </button>
            ))}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              onClick={() => { navigate("/projects"); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-3 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-2">
        <Link to="/" className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
          Agile <span className="text-[var(--accent)]">×</span> Agent
        </Link>

        {project && (
          <>
            <span className="text-[var(--text-tertiary)] text-xs">/</span>
            <ProjectSwitcher currentProject={project} />
          </>
        )}
      </div>

      {/* Right nav */}
      <nav className="flex items-center gap-1">
        <NavLink to="/" label="Dashboard" active={location.pathname === "/"} />
        <NavLink to="/projects" label="Projects" active={location.pathname === "/projects"} />
        <NavLink to="/agents" label="Agents" active={location.pathname === "/agents"} />
      </nav>
    </header>
  );
}
