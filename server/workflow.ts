import { existsSync, readFileSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { logSystem } from "./logger.js";

/**
 * Workflow loader — Symphony §5.
 *
 * Reads a project's `WORKFLOW.md`:
 *   - YAML front matter (between two `---` markers)
 *   - Markdown body → per-issue prompt template (Liquid-like)
 *
 * Hot reload via fs.watch (§6.2). When the file changes, the cached entry is
 * invalidated and the next read returns the new content.
 */

export interface WorkflowConfig {
  tracker?: {
    kind?: string;
    active_states?: string[];
    terminal_states?: string[];
  };
  polling?: { interval_ms?: number };
  workspace?: { root?: string };
  hooks?: {
    after_create?: string;
    before_run?: string;
    after_run?: string;
    before_remove?: string;
    timeout_ms?: number;
  };
  agent?: {
    max_concurrent_agents?: number;
    max_retry_backoff_ms?: number;
    max_turns?: number;
    max_concurrent_agents_by_state?: Record<string, number>;
  };
  codex?: {
    command?: string;
    approval_policy?: string;
    turn_timeout_ms?: number;
    read_timeout_ms?: number;
    stall_timeout_ms?: number;
  };
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  config: WorkflowConfig;
  prompt_template: string;
  /** True when the WORKFLOW.md body supplied a real prompt (not the built-in fallback). */
  has_prompt_body: boolean;
}

export type WorkflowError =
  | { code: "missing_workflow_file"; message: string }
  | { code: "workflow_parse_error"; message: string }
  | { code: "workflow_front_matter_not_a_map"; message: string };

interface CacheEntry {
  definition: WorkflowDefinition | null;
  error: WorkflowError | null;
  watcher: FSWatcher | null;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

const FALLBACK_PROMPT = "You are working on an issue. Read it carefully and complete the work described.";

// ── Parse a WORKFLOW.md string ──────────────────────────────────────────────

export function parseWorkflowFile(raw: string): WorkflowDefinition | WorkflowError {
  // No front matter → entire file is prompt body
  if (!raw.startsWith("---")) {
    const trimmed = raw.trim();
    return { config: {}, prompt_template: trimmed || FALLBACK_PROMPT, has_prompt_body: trimmed.length > 0 };
  }

  // Find the closing `---` line
  const lines = raw.split(/\r?\n/);
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closeIdx = i; break; }
  }
  if (closeIdx === -1) {
    return { code: "workflow_parse_error", message: "Front matter opens with '---' but no closing '---' found" };
  }

  const yamlText = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n").trim();

  let parsed: unknown;
  try { parsed = YAML.parse(yamlText); }
  catch (e) {
    return { code: "workflow_parse_error", message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (parsed == null) return { config: {}, prompt_template: body || FALLBACK_PROMPT, has_prompt_body: body.length > 0 };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { code: "workflow_front_matter_not_a_map", message: "Front matter must be a YAML object" };
  }

  // Resolve $VAR_NAME indirections in string values (top-level + one nested layer).
  const resolved = resolveEnvVars(parsed as Record<string, unknown>);

  return { config: resolved as WorkflowConfig, prompt_template: body || FALLBACK_PROMPT, has_prompt_body: body.length > 0 };
}

function resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = expandEnv(v);
    else if (v && typeof v === "object" && !Array.isArray(v))
      out[k] = resolveEnvVars(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

function expandEnv(s: string): string {
  // Pure $VAR — resolve, treat empty as missing (§5.3.1)
  const pure = s.match(/^\$([A-Z_][A-Z0-9_]*)$/);
  if (pure) {
    const val = process.env[pure[1]];
    return (val && val.trim()) ? val : "";
  }
  // ~ home expansion
  if (s.startsWith("~")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home) return home + s.slice(1);
  }
  return s;
}

// ── Load + cache ────────────────────────────────────────────────────────────

/** Default lookup: `<projectLocalPath>/WORKFLOW.md`. */
export function workflowPathFor(projectLocalPath: string): string {
  return join(projectLocalPath, "WORKFLOW.md");
}

export function loadWorkflow(projectLocalPath: string): { definition: WorkflowDefinition | null; error: WorkflowError | null } {
  const path = workflowPathFor(projectLocalPath);
  const entry = cache.get(path);

  // Cache hit — return whatever we have (watcher invalidates on change)
  if (entry) return { definition: entry.definition, error: entry.error };

  return readAndCache(path);
}

function readAndCache(path: string): { definition: WorkflowDefinition | null; error: WorkflowError | null } {
  let definition: WorkflowDefinition | null = null;
  let error: WorkflowError | null = null;

  if (!existsSync(path)) {
    error = { code: "missing_workflow_file", message: `WORKFLOW.md not found at ${path}` };
  } else {
    try {
      const raw = readFileSync(path, "utf-8");
      const result = parseWorkflowFile(raw);
      if ("code" in result) error = result;
      else definition = result;
    } catch (e) {
      error = { code: "workflow_parse_error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Install watcher once per path (§6.2 hot reload)
  let watcher = cache.get(path)?.watcher ?? null;
  if (!watcher && existsSync(path)) {
    try {
      watcher = fsWatch(path, { persistent: false }, (event) => {
        if (event === "change" || event === "rename") {
          const prev = cache.get(path);
          logSystem("workflow", `WORKFLOW.md change detected — reloading: ${path}`, "info");
          // Invalidate; next access re-reads. Don't read here — file may be mid-write.
          if (prev) cache.set(path, { ...prev, definition: null, error: null, mtimeMs: 0 });
          setTimeout(() => readAndCache(path), 100);
        }
      });
    } catch (e) {
      logSystem("workflow", `fs.watch failed for ${path}: ${e instanceof Error ? e.message : String(e)}`, "warn");
    }
  }

  const mtimeMs = existsSync(path) ? (() => {
    try { return require("node:fs").statSync(path).mtimeMs as number; }
    catch { return 0; }
  })() : 0;

  cache.set(path, { definition, error, watcher, mtimeMs });
  return { definition, error };
}

/** Force-invalidate the cache (mainly for tests / manual reload). */
export function invalidateWorkflowCache(projectLocalPath?: string): void {
  if (projectLocalPath) {
    const path = workflowPathFor(projectLocalPath);
    const entry = cache.get(path);
    if (entry?.watcher) entry.watcher.close();
    cache.delete(path);
  } else {
    for (const entry of cache.values()) entry.watcher?.close();
    cache.clear();
  }
}

// ── Liquid-like template renderer (§5.4) ────────────────────────────────────
//
// Supports the small subset Symphony needs:
//   {{ var }}                    — strict variable lookup (errors if missing)
//   {{ obj.prop }}               — dot-notation
//   {{ var | filter }}           — known filters: upcase, downcase, default: "x"
//   {% if expr %}...{% endif %}  — minimal conditional
//   {% for x in list %}...{% endfor %}
// Unknown variables / filters throw — matches Symphony's strict requirement.

export class TemplateRenderError extends Error {
  constructor(msg: string) { super(msg); this.name = "TemplateRenderError"; }
}

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  let out = template;

  // {% for x in list %}...{% endfor %}
  out = out.replace(/\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g, (_m, name, path, body) => {
    const list = resolvePath(vars, path);
    if (list == null) return "";
    if (!Array.isArray(list)) throw new TemplateRenderError(`'${path}' is not iterable`);
    return list.map((item) => renderTemplate(body, { ...vars, [name]: item })).join("");
  });

  // {% if expr %}...{% endif %}  — truthy check only
  out = out.replace(/\{%\s*if\s+([\w.]+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, path, body) => {
    const v = resolvePath(vars, path);
    return v ? body : "";
  });

  // {{ var | filter[: arg] }}
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
    const parts = expr.split("|").map((s: string) => s.trim());
    const path = parts[0];
    let v = resolvePath(vars, path);
    if (v === undefined) throw new TemplateRenderError(`Unknown variable: ${path}`);
    for (const filter of parts.slice(1)) {
      v = applyFilter(filter, v);
    }
    return v == null ? "" : String(v);
  });

  return out;
}

function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let cur: unknown = vars;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function applyFilter(spec: string, value: unknown): unknown {
  const match = spec.match(/^(\w+)(?::\s*"(.*)")?$/);
  if (!match) throw new TemplateRenderError(`Bad filter syntax: ${spec}`);
  const name = match[1];
  const arg = match[2];
  switch (name) {
    case "upcase":   return String(value ?? "").toUpperCase();
    case "downcase": return String(value ?? "").toLowerCase();
    case "default":  return (value === undefined || value === null || value === "") ? (arg ?? "") : value;
    default: throw new TemplateRenderError(`Unknown filter: ${name}`);
  }
}
