import { useIsFetching, useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronDown, FolderPlus, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { cn } from "@/lib/utils";

const TABS: { id: string; label: string; href: (id: string) => string }[] = [
  { id: "dashboard", label: "Dashboard",    href: () => "/" },
  { id: "board",     label: "Board",        href: (id) => `/projects/${id}/board` },
  { id: "backlog",   label: "Backlog",      href: (id) => `/projects/${id}/backlog` },
  { id: "sprints",   label: "Sprint Cycles", href: (id) => `/projects/${id}/sprints` },
  { id: "context",   label: "Context",      href: (id) => `/projects/${id}/context` },
  { id: "agents",    label: "Agents",       href: () => "/agents" },
  { id: "ops",       label: "Ops",          href: () => "/ops" },
];

function activeTab(pathname: string): string {
  if (pathname === "/") return "dashboard";
  if (pathname === "/agents") return "agents";
  if (pathname === "/ops") return "ops";
  if (pathname.includes("/board"))   return "board";
  if (pathname.includes("/backlog")) return "backlog";
  if (pathname.includes("/sprints")) return "sprints";
  if (pathname.includes("/context")) return "context";
  return "";
}

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const isFetching = useIsFetching();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const currentTab = activeTab(location.pathname);

  const handleSelectProject = (id: string) => {
    navigate(`/projects/${id}/board`);
    setDropdownOpen(false);
  };

  return (
    <header className="shrink-0 sticky top-0 z-40 flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface-secondary">

      {/* Left: logo + project selector */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-[14px] font-bold tracking-tight text-content-primary hover:opacity-90 transition-opacity"
        >
          <span className="p-1 bg-accent rounded text-white block leading-none">
            <Sparkles size={12} className="fill-current" />
          </span>
          Agile <span className="text-accent">×</span> Agent
        </Link>

        <span className="text-content-tertiary text-xs select-none">/</span>

        {/* Project selector dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-surface-card text-xs font-semibold text-content-primary hover:bg-surface-tertiary transition-colors outline-none shadow-sm"
          >
            <Briefcase size={12} className="text-accent shrink-0" />
            <span className="max-w-[140px] truncate">
              {currentProject ? currentProject.name : "Select Project"}
            </span>
            {currentProject && (
              <span className="font-mono text-[9px] text-content-tertiary">{currentProject.key}</span>
            )}
            <ChevronDown size={11} className="text-content-tertiary shrink-0" />
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-[240px] bg-surface-card border border-border rounded-xl shadow-xl z-50 p-2">
                <span className="block px-2.5 py-1.5 text-[10px] font-mono font-semibold uppercase text-content-tertiary tracking-wider border-b border-border/60 mb-1">
                  Workspaces
                </span>
                <div className="max-h-[180px] overflow-y-auto scrollbar-column space-y-0.5 mb-1.5">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProject(p.id)}
                      className={cn(
                        "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg transition-colors outline-none",
                        p.id === projectId
                          ? "bg-accent-soft text-accent font-semibold"
                          : "text-content-secondary hover:text-content-primary hover:bg-surface-secondary"
                      )}
                    >
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="font-mono text-[10px] text-content-tertiary">{p.key}</span>
                    </button>
                  ))}
                  {projects.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-content-tertiary">No projects yet</p>
                  )}
                </div>
                <button
                  onClick={() => { navigate("/projects"); setDropdownOpen(false); }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-accent text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  <FolderPlus size={13} />
                  New Project
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center/right: global tabs */}
      <nav className="flex items-center gap-0.5 text-xs">
        {TABS.map(({ id, label, href }) => {
          const isProjectTab = id !== "dashboard" && id !== "agents" && id !== "ops";
          const disabled = isProjectTab && !currentProject;
          const to = isProjectTab
            ? (currentProject ? href(currentProject.id) : "#")
            : href("");
          const isActive = currentTab === id;

          return (
            <Link
              key={id}
              to={to}
              onClick={(e) => disabled && e.preventDefault()}
              className={cn(
                "px-3 py-1.5 rounded-md font-medium transition-all outline-none",
                isActive
                  ? "bg-accent-soft text-accent"
                  : disabled
                  ? "text-content-tertiary/40 cursor-not-allowed pointer-events-none"
                  : "text-content-secondary hover:text-content-primary hover:bg-surface-tertiary"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Right: sync indicator + settings */}
      <div className="flex items-center gap-2">
        {isFetching > 0 && (
          <span className="font-mono text-[9px] text-accent flex items-center gap-1">
            <span className="size-1.5 bg-accent rounded-full animate-ping" />
            syncing
          </span>
        )}
        <Link
          to="/settings"
          title="Settings"
          className={cn(
            "p-1.5 rounded-md transition-colors",
            location.pathname === "/settings"
              ? "text-accent bg-accent-soft"
              : "text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary"
          )}
        >
          <Settings size={14} />
        </Link>
        <span className="font-mono text-[10px] text-content-tertiary bg-surface-tertiary border border-border rounded px-2 py-0.5 uppercase tracking-wide">
          v0.1
        </span>
      </div>
    </header>
  );
}
