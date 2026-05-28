export type Priority = "low" | "medium" | "high" | "urgent";
export type StoryStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type StoryType = "story" | "bug" | "task" | "spike";
export type SprintStatus = "planning" | "active" | "completed";
export type Provider = "claude" | "codex" | "copilot" | "gemini" | "custom";
export type ContextSection =
  | "overview"
  | "prd"
  | "design_system"
  | "data_model"
  | "architecture"
  | "conventions"
  | "glossary";

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  local_path: string | null;
  github_url: string | null;
  tech_stack: string | null;
  definition_of_done: string | null;
  status: "active" | "archived";
  created_at: string;
  // Aggregates
  story_count?: number;
  active_count?: number;
  active_sprint_count?: number;
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
  capacity: number | null;
  status: SprintStatus;
  created_at: string;
}

export interface Story {
  id: string;
  project_id: string;
  epic_id: string | null;
  sprint_id: string | null;
  key: string;
  type: StoryType;
  title: string;
  as_a: string | null;
  i_want: string | null;
  so_that: string | null;
  description: string | null;
  acceptance_criteria: string | null;
  definition_of_done: string | null;
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
  sprint_name?: string | null;
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

export interface ProjectContext {
  id: string;
  project_id: string;
  section: ContextSection | string;
  title: string;
  content: string | null;
  sort_order: number;
  updated_at: string;
  updated_by: string;
}
