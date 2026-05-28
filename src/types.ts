export type Priority = "low" | "medium" | "high" | "urgent";
export type StoryStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type SprintStatus = "planning" | "active" | "completed";
export type Provider = "claude" | "codex" | "copilot" | "gemini" | "custom";

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  story_count?: number;
  active_count?: number;
}

export interface Epic {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  color: string;
  status: "open" | "closed";
  created_at: string;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  status: SprintStatus;
  created_at: string;
}

export interface Story {
  id: string;
  project_id: string;
  epic_id: string | null;
  sprint_id: string | null;
  key: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  story_points: number | null;
  priority: Priority;
  status: StoryStatus;
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  agent_name?: string | null;
  agent_provider?: string | null;
  epic_title?: string | null;
  epic_color?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  provider: Provider;
  model: string | null;
  system_prompt: string | null;
  prompt_template: string | null;
  created_at: string;
  story_count?: number;
  active_count?: number;
}
