import { useQuery } from "@tanstack/react-query";
import { Bot, Folders, LayoutDashboard, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

function NavItem({
  to, icon: Icon, label, active,
}: { to: string; icon: React.ElementType; label: string; active?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      )}
    >
      <Icon size={15} />
      {label}
    </Link>
  );
}

function ProjectItem({ project }: { project: Project }) {
  const location = useLocation();
  const active = location.pathname.startsWith(`/projects/${project.id}`);
  return (
    <Link
      to={`/projects/${project.id}`}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      <span className="truncate">{project.name}</span>
      {project.active_count ? (
        <span className="ml-auto text-xs text-[var(--accent)] font-mono">{project.active_count}</span>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
    refetchInterval: 30_000,
  });

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] py-4">
      {/* Logo */}
      <div className="px-4 pb-4">
        <span className="text-base font-bold tracking-tight text-[var(--text-primary)]">
          Agile <span className="text-[var(--accent)]">×</span> Agent
        </span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        <NavItem
          to="/"
          icon={LayoutDashboard}
          label="Dashboard"
          active={location.pathname === "/"}
        />
        <NavItem
          to="/projects"
          icon={Folders}
          label="Projects"
          active={location.pathname === "/projects"}
        />
        <NavItem
          to="/agents"
          icon={Bot}
          label="Agents"
          active={location.pathname === "/agents"}
        />
      </nav>

      {/* Project list */}
      {projects && projects.length > 0 && (
        <div className="mt-4 flex-1 overflow-y-auto px-2">
          <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
            Projects
          </p>
          <div className="flex flex-col gap-0.5">
            {projects.map((p) => (
              <ProjectItem key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom */}
      <div className="mt-auto px-2">
        <NavItem
          to="/settings"
          icon={Settings}
          label="Settings"
          active={location.pathname === "/settings"}
        />
      </div>
    </aside>
  );
}
