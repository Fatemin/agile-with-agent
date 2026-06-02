import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// ─── Individual tool definitions ──────────────────────────────────────────────

const READ_FILE_DEF = {
  name: "read_file",
  description: "Read the full contents of a file. Use relative paths from the project root.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "File path relative to project root (e.g. src/api/users.ts)" },
    },
    required: ["path"],
  },
};

const WRITE_FILE_DEF = {
  name: "write_file",
  description: "Write or overwrite a file with the given content. Creates parent directories automatically. Always write the complete file content, not diffs.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      content: { type: "string", description: "Complete file content to write" },
    },
    required: ["path", "content"],
  },
};

const LIST_DIR_DEF = {
  name: "list_directory",
  description: "List files and directories. Use to understand project structure before reading files.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Directory path relative to project root (default: '.' for root)" },
      recursive: { type: "boolean", description: "List recursively up to 3 levels deep (default: false)" },
    },
  },
};

const RUN_CMD_DEF = {
  name: "run_command",
  description: "Run a shell command in the project directory. Use for: running tests, checking types (tsc --noEmit), linting, or git operations.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute (e.g. 'npm test')" },
    },
    required: ["command"],
  },
};

const SET_QA_RESULT_DEF = {
  name: "set_qa_result",
  description: "Report the final QA verdict. Call this exactly once after verifying the implementation against all acceptance criteria and running available tests.",
  input_schema: {
    type: "object" as const,
    properties: {
      result: {
        type: "string",
        enum: ["pass", "fail"],
        description: "pass — all criteria met; fail — one or more criteria not met",
      },
      summary: {
        type: "string",
        description: "Clear summary of findings: what was tested, which criteria passed/failed with specific evidence",
      },
    },
    required: ["result", "summary"],
  },
};

const PLAN_PIPELINE_DEF = {
  name: "plan_pipeline",
  description: "Decompose this story into specialist tasks. Call once after exploring the codebase and understanding scope. Each task will be executed by a specialist agent in order.",
  input_schema: {
    type: "object" as const,
    properties: {
      rationale: { type: "string", description: "Brief explanation of your decomposition decisions." },
      tasks: {
        type: "array",
        description: "Ordered list of tasks. Dependencies control sequencing.",
        items: {
          type: "object",
          properties: {
            seq:         { type: "number",  description: "Sequential index starting at 1." },
            title:       { type: "string",  description: "Short label, e.g. 'Update shared types'." },
            role:        { type: "string",  enum: ["frontend","backend","qa","devops","security","custom"] },
            description: { type: "string",  description: "Specific instructions for this specialist: what to build, key constraints, files to touch." },
            scope_paths: { type: "array",   items: { type: "string" }, description: "Write-allowed path prefixes, e.g. ['src/api/','src/types.ts']." },
            depends_on:  { type: "array",   items: { type: "number" }, description: "seq numbers that must complete before this task starts." },
          },
          required: ["seq", "title", "role", "description"],
        },
      },
    },
    required: ["tasks"],
  },
};

const UPDATE_CONTEXT_DEF = {
  name: "update_context",
  description: "Write or update a project context section with documentation you have generated from analyzing the codebase. Call once per section.",
  input_schema: {
    type: "object" as const,
    properties: {
      section: {
        type: "string",
        enum: ["overview", "prd", "design_system", "data_model", "architecture", "conventions", "glossary"],
        description: "Which context section to update.",
      },
      content: {
        type: "string",
        description: "Documentation content for this section in Markdown format. Be specific and factual — based only on what you observed in the code.",
      },
      title: {
        type: "string",
        description: "Optional custom section title. Leave blank to use the default.",
      },
    },
    required: ["section", "content"],
  },
};

const SUBMIT_DESIGN_DEF = {
  name: "submit_design",
  description: "Submit your design specification to complete Phase A. After calling this, proceed to Phase B — implement the changes with write_file.",
  input_schema: {
    type: "object" as const,
    properties: {
      spec: {
        type: "string",
        description: "Complete design spec in Markdown: files to create/modify, interfaces, approach, edge cases handled.",
      },
    },
    required: ["spec"],
  },
};

// ─── Tool set exports ─────────────────────────────────────────────────────────

// Standard single-agent tools (original, unchanged)
export const TOOL_DEFINITIONS = [READ_FILE_DEF, WRITE_FILE_DEF, LIST_DIR_DEF, RUN_CMD_DEF];

// QA agent tools
export const QA_TOOL_DEFINITIONS = [...TOOL_DEFINITIONS, SET_QA_RESULT_DEF];

// Tech Lead planning tools: read-only + plan_pipeline (no write_file)
export const TECHLEAD_TOOL_DEFINITIONS = [
  READ_FILE_DEF, LIST_DIR_DEF, RUN_CMD_DEF,
  PLAN_PIPELINE_DEF,
];

// Specialist Phase A: explore + design, no code writes
export const TASK_DESIGN_TOOLS = [READ_FILE_DEF, LIST_DIR_DEF, RUN_CMD_DEF, SUBMIT_DESIGN_DEF];

// Specialist Phase B: full write access
export const TASK_IMPL_TOOLS = [READ_FILE_DEF, WRITE_FILE_DEF, LIST_DIR_DEF, RUN_CMD_DEF];

// Docs agent: read-only file access + update_context (no write_file)
export const DOCS_TOOL_DEFINITIONS = [READ_FILE_DEF, LIST_DIR_DEF, RUN_CMD_DEF, UPDATE_CONTEXT_DEF];

// ─── Scope enforcement ────────────────────────────────────────────────────────

export interface ScopePolicy {
  paths: string[];       // allowed write-path prefixes
  taskTitle: string;
  mode: "soft" | "hard";
}

function matchesScope(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true; // no restriction
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((p) => {
    const pat = p.replace(/\\/g, "/");
    // Glob patterns ending with /** or /*
    if (pat.endsWith("/**")) return normalized.startsWith(pat.slice(0, -3));
    if (pat.endsWith("/*")) {
      const dir = pat.slice(0, -2);
      const rest = normalized.slice(dir.length + 1);
      return normalized.startsWith(dir + "/") && !rest.includes("/");
    }
    // Exact match or directory prefix
    return normalized === pat || normalized.startsWith(pat.endsWith("/") ? pat : pat + "/");
  });
}

// ─── Safety ───────────────────────────────────────────────────────────────────

const BLOCKED = [
  /\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\s+\/[fqs]/i,
  /\bformat\s+[a-z]:/i,
  /DROP\s+(TABLE|DATABASE)/i,
  /curl[^|]*\|\s*(?:ba)?sh/i,
  /wget[^|]*\|\s*(?:ba)?sh/i,
];

function safe(cmd: string): boolean {
  return !BLOCKED.some((r) => r.test(cmd));
}

// ─── Directory lister ─────────────────────────────────────────────────────────

const SKIP = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".venv", "venv", "target"]);

function listRecursive(abs: string, root: string, depth: number): string[] {
  if (depth > 3 || !existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && !SKIP.has(e.name))
    .flatMap((e) => {
      const full = join(abs, e.name);
      const rel  = relative(root, full);
      if (e.isDirectory()) return [rel + "/", ...listRecursive(full, root, depth + 1)];
      return [rel];
    });
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>;

export function executeTool(
  name: string,
  input: ToolInput,
  localPath: string,
  scopePolicy?: ScopePolicy,
): string {
  const guard = (rel: string) => {
    const abs = resolve(localPath, rel);
    if (!abs.startsWith(resolve(localPath))) throw new Error("Path traversal not allowed");
    return abs;
  };

  try {
    switch (name) {
      case "read_file": {
        const abs = guard(input.path as string);
        if (!existsSync(abs)) return `Error: File not found: ${input.path}`;
        const text = readFileSync(abs, "utf-8");
        return text.length > 60_000 ? text.slice(0, 60_000) + "\n\n[…truncated at 60 000 chars]" : text;
      }

      case "write_file": {
        if (scopePolicy && scopePolicy.paths.length > 0) {
          const filePath = input.path as string;
          if (!matchesScope(filePath, scopePolicy.paths)) {
            const msg = `Scope violation: "${filePath}" is outside allowed paths for task "${scopePolicy.taskTitle}". Allowed: ${scopePolicy.paths.join(", ")}`;
            if (scopePolicy.mode === "hard") return `Error: ${msg}`;
            // soft: write but warn
            console.warn(`[scope-soft] ${msg}`);
          }
        }
        const abs = guard(input.path as string);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, input.content as string, "utf-8");
        return `OK: wrote ${input.path}`;
      }

      case "list_directory": {
        const rel = (input.path as string | undefined) ?? ".";
        const abs = guard(rel);
        if (!existsSync(abs)) return `Error: Not found: ${rel}`;
        if (!statSync(abs).isDirectory()) return `Error: Not a directory: ${rel}`;
        const files = (input.recursive as boolean | undefined)
          ? listRecursive(abs, localPath, 0)
          : readdirSync(abs, { withFileTypes: true })
              .filter((e) => !e.name.startsWith(".") && !SKIP.has(e.name))
              .map((e) => e.isDirectory() ? e.name + "/" : e.name);
        return files.length ? files.join("\n") : "(empty)";
      }

      case "run_command": {
        const cmd = input.command as string;
        if (!safe(cmd)) return `Error: command blocked for safety — ${cmd}`;
        try {
          const out = execSync(cmd, {
            cwd: localPath,
            encoding: "utf-8",
            timeout: 120_000,
            maxBuffer: 5 * 1024 * 1024,
          });
          return out.trim() || "(no output)";
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string; status?: number };
          const out = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
          return `Exit ${err.status ?? 1}:\n${out || "(no output)"}`;
        }
      }

      default:
        return `Error: unknown tool "${name}"`;
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
