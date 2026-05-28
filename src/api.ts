import type { Agent, Epic, Project, ProjectContext, Sprint, Story } from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    list: () => req<Project[]>("/projects"),
    get: (id: string) => req<Project>(`/projects/${id}`),
    create: (body: Partial<Project> & { key: string; name: string }) =>
      req<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Project>) =>
      req<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  },

  epics: {
    list: (projectId?: string) =>
      req<Epic[]>(`/epics${projectId ? `?project_id=${projectId}` : ""}`),
    create: (body: { project_id: string; title: string; description?: string; color?: string }) =>
      req<Epic>("/epics", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Epic>) =>
      req<Epic>(`/epics/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/epics/${id}`, { method: "DELETE" }),
  },

  sprints: {
    list: (projectId?: string) =>
      req<Sprint[]>(`/sprints${projectId ? `?project_id=${projectId}` : ""}`),
    create: (body: { project_id: string; name: string; goal?: string; start_date?: string; end_date?: string; capacity?: number }) =>
      req<Sprint>("/sprints", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Omit<Sprint, "id" | "project_id" | "created_at">>) =>
      req<Sprint>(`/sprints/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/sprints/${id}`, { method: "DELETE" }),
  },

  stories: {
    list: (params?: { project_id?: string; sprint_id?: string | null; epic_id?: string; status?: string; type?: string }) => {
      const qs = new URLSearchParams();
      if (params?.project_id) qs.set("project_id", params.project_id);
      if (params?.sprint_id === null) qs.set("sprint_id", "null");
      else if (params?.sprint_id) qs.set("sprint_id", params.sprint_id);
      if (params?.epic_id) qs.set("epic_id", params.epic_id);
      if (params?.status) qs.set("status", params.status);
      if (params?.type) qs.set("type", params.type);
      return req<Story[]>(`/stories${qs.toString() ? `?${qs}` : ""}`);
    },
    get: (id: string) => req<Story>(`/stories/${id}`),
    create: (body: Partial<Story> & { project_id: string; title: string }) =>
      req<Story>("/stories", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Omit<Story, "id" | "project_id" | "key" | "created_at" | "updated_at">>) =>
      req<Story>(`/stories/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/stories/${id}`, { method: "DELETE" }),
  },

  agents: {
    list: () => req<Agent[]>("/agents"),
    get: (id: string) => req<Agent>(`/agents/${id}`),
    create: (body: Omit<Agent, "id" | "created_at" | "story_count" | "active_count">) =>
      req<Agent>("/agents", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Agent>) =>
      req<Agent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),
  },

  contexts: {
    list: (projectId: string) =>
      req<ProjectContext[]>(`/contexts?project_id=${projectId}`),
    update: (projectId: string, section: string, body: { content?: string; title?: string; updated_by?: string }) =>
      req<ProjectContext>(`/contexts/${projectId}/${section}`, { method: "PUT", body: JSON.stringify(body) }),
    scan: (projectId: string) =>
      req<{ scanned: string[]; message: string }>(`/contexts/${projectId}/scan`, { method: "POST" }),
  },
};
