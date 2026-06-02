import { db } from "./db.js";
import { defaultWorkspaceRoot } from "./workspace.js";

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface AgentRuntimeConfig {
  enabled: boolean;
  cli_path: string;
  permission_mode: PermissionMode;
  model: string;
  timeout_minutes: number;
  wip_limit: number;                // global concurrency cap (Symphony §5.3.5)
  poll_interval_ms: number;         // orchestrator tick (Symphony §5.3.2)
  workspace_root: string;           // per-story workspaces under here (§5.3.3)
  max_retry_backoff_ms: number;     // retry cap (§5.3.5)
  stall_timeout_ms: number;         // event-inactivity kill threshold (§5.3.6)
}

const DEFAULT_CONFIG: AgentRuntimeConfig = {
  enabled: true,
  cli_path: process.platform === "win32" ? "claude.cmd" : "claude",
  permission_mode: "acceptEdits",
  model: "claude-sonnet-4-5",
  timeout_minutes: 15,
  wip_limit: 3,
  poll_interval_ms: 30_000,
  workspace_root: defaultWorkspaceRoot(),
  max_retry_backoff_ms: 5 * 60_000,
  stall_timeout_ms: 5 * 60_000,
};

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'agent_runtime_config'").get() as
    { value: string } | undefined;
  if (!row) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as Partial<AgentRuntimeConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}
