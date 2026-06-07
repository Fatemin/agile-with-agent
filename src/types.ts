export type Priority = "low" | "medium" | "high" | "urgent";

// Linear-style flow workflow (replaces the old sprint-style states).
// Migration: in_dev → in_progress, in_qa → human_review, ready → human_review, released → done.
export type StoryStatus =
  | "backlog"
  | "todo"
  | "design_review"
  | "in_progress"
  | "human_review"
  | "done"
  | "cancelled";
export type StoryType = "story" | "bug" | "task" | "spike";
export type StoryMode = "auto" | "manual";
export type SprintStatus = "planning" | "active" | "completed";
export type Provider = "claude" | "claude-code" | "codex" | "codex-cli" | "gemini" | "custom";
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
  branch_name: string | null;
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
  // Dev / QA / Rollout
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  qa_test_cases: string | null;
  qa_notes: string | null;
  qa_result: "pass" | "fail" | null;
  qa_signed_off_by: string | null;
  qa_signed_off_at: string | null;
  staging_url: string | null;
  deploy_env: string | null;
  deploy_url: string | null;
  commit_hash: string | null;
  deployed_at: string | null;
  parent_story_id: string | null;
  pipeline_mode: number;
  mode: StoryMode;
  design: string | null;
  // Joined fields
  agent_name?: string | null;
  agent_provider?: string | null;
  epic_title?: string | null;
  epic_color?: string | null;
  sprint_name?: string | null;
  // Aggregates (from the stories list/get query)
  task_total?: number;
  task_done?: number;
  defect_count?: number;
}

export type AgentRole =
  | "frontend" | "backend" | "fullstack" | "qa"
  | "devops" | "techlead" | "security" | "docs" | "custom";

export type AgentStatus = "idle" | "in_progress";

export interface Agent {
  id: string;
  name: string;
  role: AgentRole | null;
  provider: Provider;
  model: string | null;
  system_prompt: string | null;
  prompt_template: string | null;
  created_at: string;
  story_count?: number;
  active_count?: number;
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked" | "failed";

export type TaskType = "subtask" | "defect" | "spike";

export type DefectSeverity = "critical" | "major" | "minor" | "trivial";

export type FoundDuring = "dev" | "qa" | "uat" | "prod";

export interface StoryTask {
  id: string;
  story_id: string;
  seq: number;
  type: TaskType;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  estimate_hours: number | null;
  logged_hours: number | null;
  role: AgentRole;
  agent_id: string | null;
  scope_paths: string;   // JSON string — parse with JSON.parse
  depends_on: string;    // JSON string — parse with JSON.parse
  status: TaskStatus;
  impl_summary: string | null;
  // Defect-specific
  severity: DefectSeverity | null;
  steps_to_repro: string | null;
  expected: string | null;
  actual: string | null;
  found_during: FoundDuring | null;
  linked_task_id: string | null;
  agent_name?: string | null;
  agent_role?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentStory {
  id: string;
  key: string;
  title: string;
  type: StoryType;
  status: StoryStatus;
  story_points: number | null;
  priority: Priority;
  qa_result: "pass" | "fail" | null;
  updated_at: string;
  created_at: string;
  project_name: string;
  sprint_name: string | null;
  epic_title: string | null;
  epic_color: string | null;
}

export interface AgentRun {
  id: string;
  story_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  run_type: string;
  model: string | null;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  turns: number;
  prompt_text: string | null;
  output_text: string | null;
  created_at: string;
  agent_name?: string | null;
  agent_role?: string | null;
}

// Orchestrator snapshot (Symphony §13.3)
export interface SnapshotRunning {
  storyId: string;
  identifier: string;
  startedAt: string;
  attempt: number;
  turnCount: number;
  tokenIn: number;
  tokenOut: number;
  lastEventAt: string;
  elapsedSec: number;
}
export interface SnapshotRetrying {
  storyId: string;
  identifier: string;
  attempt: number;
  dueInSec: number;
  error: string | null;
}
export interface Snapshot {
  running: SnapshotRunning[];
  retrying: SnapshotRetrying[];
  totals: {
    runningCount: number;
    retryingCount: number;
    completedCount: number;
    tokenIn: number;
    tokenOut: number;
    secondsRunning: number;
  };
  wipLimit: number;
  pollIntervalMs: number;
}

export interface SystemEvent {
  id: string;
  type: string;
  level: "debug" | "info" | "warn" | "error";
  content: string;
  created_at: string;
}

// Context/State views (CONTEXT.md §15)
export interface StorySnapshotView {
  goal: string | null;
  completed: Array<{ seq: number; title: string; result: string }>;
  inProgress: { seq: number; title: string } | null;
  blocked: Array<{ seq: number; title: string }>;
  artifacts: string[];
}

export interface Decision {
  id: string;
  seq: number;
  topic: string;
  decision: string;
  rationale: string | null;
  status: "active" | "superseded" | string;
  created_at: string;
}

export interface Artifact {
  id: string;
  path: string;
  kind: string;
  summary: string | null;
  status: string;
  updated_at: string;
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
