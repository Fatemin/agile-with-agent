import type { Agent, AgentRun, AgentStory, Artifact, Decision, Epic, Project, ProjectContext, Snapshot, Sprint, Story, StorySnapshotView, StoryTask, SystemEvent } from "./types";

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
    create: (body: Partial<Project> & { key: string; name: string; is_existing?: boolean }) =>
      req<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Project>) =>
      req<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
    generateContext: (id: string, agentId: string) =>
      fetch(`/api/projects/${id}/generate-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      }),
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
    create: (body: Partial<Story> & { project_id: string; title: string; mode?: "auto" | "manual" }) =>
      req<Story>("/stories", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Story>) =>
      req<Story>(`/stories/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/stories/${id}`, { method: "DELETE" }),
    // Context/State views (CONTEXT.md §15)
    snapshot:  (id: string) => req<StorySnapshotView>(`/stories/${id}/snapshot`),
    decisions: (id: string) => req<Decision[]>(`/stories/${id}/decisions`),
    artifacts: (id: string) => req<Artifact[]>(`/stories/${id}/artifacts`),
  },

  agents: {
    list: () => req<Agent[]>("/agents"),
    get: (id: string) => req<Agent>(`/agents/${id}`),
    create: (body: Omit<Agent, "id" | "created_at" | "story_count" | "active_count"> & { role?: string }) =>
      req<Agent>("/agents", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Agent> & { role?: string }) =>
      req<Agent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => req<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),
    stories: (id: string) => req<AgentStory[]>(`/agents/${id}/stories`),
  },

  contexts: {
    list: (projectId: string) =>
      req<ProjectContext[]>(`/contexts?project_id=${projectId}`),
    update: (projectId: string, section: string, body: { content?: string; title?: string; updated_by?: string }) =>
      req<ProjectContext>(`/contexts/${projectId}/${section}`, { method: "PUT", body: JSON.stringify(body) }),
    scan: (projectId: string) =>
      req<{ scanned: string[]; message: string }>(`/contexts/${projectId}/scan`, { method: "POST" }),
  },

  settings: {
    get: <T = unknown>(key: string) =>
      req<{ key: string; value: T }>(`/settings/${key}`),
    put: <T = unknown>(key: string, value: T) =>
      req<{ key: string; value: T }>(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  },

  execution: {
    run: (storyId: string) => fetch(`/api/stories/${storyId}/execute`, { method: "POST" }),
    qaRun: (storyId: string) => fetch(`/api/stories/${storyId}/qa-run`, { method: "POST" }),
    plan: (storyId: string) => fetch(`/api/stories/${storyId}/plan`, { method: "POST" }),
    runTask: (storyId: string, taskId: string) =>
      fetch(`/api/stories/${storyId}/tasks/${taskId}/execute`, { method: "POST" }),
    reportBug: (storyId: string, body: { title: string; description?: string }) =>
      req<Story>(`/stories/${storyId}/report-bug`, { method: "POST", body: JSON.stringify(body) }),
  },

  tasks: {
    list: (storyId: string) => req<StoryTask[]>(`/stories/${storyId}/tasks`),
    create: (storyId: string, body: {
      title: string; role: string;
      seq?: number;
      type?: "subtask" | "defect" | "spike";
      description?: string; acceptance_criteria?: string;
      estimate_hours?: number; severity?: string;
      steps_to_repro?: string; expected?: string; actual?: string;
      found_during?: string; linked_task_id?: string;
      scope_paths?: string[]; depends_on?: number[]; agent_id?: string;
    }) => req<StoryTask>(`/stories/${storyId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    update: (storyId: string, taskId: string, body: {
      title?: string; description?: string | null;
      acceptance_criteria?: string | null;
      role?: string; agent_id?: string | null;
      scope_paths?: string[]; depends_on?: number[];
      seq?: number; phase?: string; status?: string;
      type?: string; estimate_hours?: number | null; logged_hours?: number | null;
      severity?: string | null; steps_to_repro?: string | null;
      expected?: string | null; actual?: string | null;
      found_during?: string | null; linked_task_id?: string | null;
    }) => req<StoryTask>(`/stories/${storyId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (storyId: string, taskId: string) =>
      req<{ ok: boolean }>(`/stories/${storyId}/tasks/${taskId}`, { method: "DELETE" }),
  },

  runs: {
    list: (params: { story_id?: string; agent_id?: string; task_id?: string }) => {
      const qs = new URLSearchParams();
      if (params.story_id) qs.set("story_id", params.story_id);
      if (params.agent_id) qs.set("agent_id", params.agent_id);
      if (params.task_id)  qs.set("task_id",  params.task_id);
      return req<AgentRun[]>(`/runs?${qs}`);
    },
  },

  snapshot: {
    get:  () => req<Snapshot>("/snapshot"),
    kick: () => req<{ ok: boolean }>("/snapshot/kick", { method: "POST" }),
  },

  systemEvents: {
    list: (limit = 100) => req<SystemEvent[]>(`/system-events?limit=${limit}`),
  },

  activities: {
    list: (storyId: string) =>
      req<{ id: string; story_id: string; type: string; content: string; author: string; level: string; created_at: string }[]>(
        `/stories/${storyId}/activities`
      ),
    create: (storyId: string, body: { content: string; author?: string; type?: string }) =>
      req<{ id: string; story_id: string; type: string; content: string; author: string; level: string; created_at: string }>(
        `/stories/${storyId}/activities`, { method: "POST", body: JSON.stringify(body) }
      ),
  },
};
