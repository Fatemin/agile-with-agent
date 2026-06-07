import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { db, type SqlParam } from "../db.js";
import { executeTechLeadPlan, executeTask } from "../execution.js";
import { log } from "../logger.js";

export const tasksRouter = new Hono();

// ─── List tasks for a story ────────────────────────────────────────────────────

tasksRouter.get("/:storyId/tasks", (c) => {
  const tasks = db.prepare(`
    SELECT t.*,
           a.name AS agent_name,
           a.role AS agent_role
    FROM story_tasks t
    LEFT JOIN agents a ON t.agent_id = a.id
    WHERE t.story_id = ?
    ORDER BY t.seq ASC
  `).all(c.req.param("storyId"));
  return c.json(tasks);
});

// ─── Create a task manually ───────────────────────────────────────────────────

tasksRouter.post("/:storyId/tasks", async (c) => {
  const storyId = c.req.param("storyId");
  const body = await c.req.json<{
    seq?: number; title: string; role: string;
    type?: "subtask" | "defect" | "spike";
    description?: string; acceptance_criteria?: string;
    estimate_hours?: number; severity?: string;
    steps_to_repro?: string; expected?: string; actual?: string;
    found_during?: string; linked_task_id?: string;
    scope_paths?: string[]; depends_on?: number[]; agent_id?: string;
  }>();

  if (!body.title || !body.role) {
    return c.json({ error: "title and role required" }, 400);
  }

  // Auto-compute seq if not provided
  let seq = body.seq;
  if (seq == null) {
    const max = db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM story_tasks WHERE story_id = ?").get(storyId) as { m: number };
    seq = max.m + 1;
  }

  const id = nanoid();
  db.prepare(`
    INSERT INTO story_tasks (
      id, story_id, seq, type, title, description, acceptance_criteria,
      estimate_hours, severity, steps_to_repro, expected, actual,
      found_during, linked_task_id, role, agent_id, scope_paths, depends_on, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo')
  `).run(
    id, storyId, seq, body.type ?? "subtask", body.title,
    body.description ?? null, body.acceptance_criteria ?? null,
    body.estimate_hours ?? null, body.severity ?? null,
    body.steps_to_repro ?? null, body.expected ?? null, body.actual ?? null,
    body.found_during ?? null, body.linked_task_id ?? null,
    body.role, body.agent_id ?? null,
    JSON.stringify(body.scope_paths ?? []),
    JSON.stringify(body.depends_on ?? []),
  );

  const agentLabel = body.agent_id
    ? (db.prepare("SELECT name FROM agents WHERE id = ?").get(body.agent_id) as { name: string } | undefined)?.name ?? body.agent_id
    : "unassigned";
  const typeLabel = body.type === "defect" ? "🐛 Defect" : body.type === "spike" ? "🔬 Spike" : "Subtask";
  log(storyId, "task_created",
    `${typeLabel} #${seq} created manually: **${body.title}** [${body.role}] → ${agentLabel}`,
    "human"
  );

  return c.json(db.prepare("SELECT * FROM story_tasks WHERE id = ?").get(id), 201);
});

// ─── Update a task ────────────────────────────────────────────────────────────

tasksRouter.patch("/:storyId/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<Record<string, unknown>>();

  const allowed = [
    "title", "description", "acceptance_criteria", "role", "agent_id",
    "scope_paths", "depends_on", "seq", "status",
    "type", "estimate_hours", "logged_hours", "severity",
    "steps_to_repro", "expected", "actual", "found_during", "linked_task_id",
  ] as const;
  const updates: string[] = [];
  const vals: SqlParam[] = [];

  for (const k of allowed) {
    if (k in body) {
      // JSON-encode arrays
      if (k === "scope_paths" || k === "depends_on") {
        updates.push(`${k} = ?`);
        vals.push(JSON.stringify(body[k] ?? []));
      } else {
        updates.push(`${k} = ?`);
        vals.push((body[k] ?? null) as SqlParam);
      }
    }
  }

  const prevTask = db.prepare("SELECT agent_id, story_id FROM story_tasks WHERE id = ?").get(taskId) as
    { agent_id: string | null; story_id: string } | undefined;

  if (updates.length) {
    updates.push("updated_at = datetime('now')");
    db.prepare(`UPDATE story_tasks SET ${updates.join(", ")} WHERE id = ?`).run(...vals, taskId);
  }

  // Log agent assignment change
  const newAgentId = body.agent_id as string | undefined | null;
  if ("agent_id" in body && newAgentId !== prevTask?.agent_id && prevTask?.story_id) {
    if (newAgentId) {
      const agent = db.prepare("SELECT name, role FROM agents WHERE id = ?").get(newAgentId) as
        { name: string; role: string | null } | undefined;
      const task = db.prepare("SELECT seq, title FROM story_tasks WHERE id = ?").get(taskId) as
        { seq: number; title: string } | undefined;
      log(prevTask.story_id, "agent_change",
        `Task #${task?.seq ?? "?"} agent assigned: **${agent?.name ?? newAgentId}**${agent?.role ? ` (${agent.role})` : ""} → ${task?.title ?? taskId}`,
        "human"
      );
    }
  }

  // Log status change
  if ("status" in body && body.status && prevTask?.story_id) {
    const task = db.prepare("SELECT seq, title FROM story_tasks WHERE id = ?").get(taskId) as
      { seq: number; title: string } | undefined;
    log(prevTask.story_id, "task_status",
      `Task #${task?.seq ?? "?"} status: ${body.status as string} — ${task?.title ?? taskId}`,
      "human"
    );
  }

  // Manual mode: assigning an agent to a todo task triggers immediate execution
  if (newAgentId && newAgentId !== prevTask?.agent_id && prevTask?.story_id) {
    const story = db.prepare("SELECT mode FROM stories WHERE id = ?").get(prevTask.story_id) as
      { mode: string } | undefined;
    if (story?.mode === "manual") {
      const task = db.prepare("SELECT status FROM story_tasks WHERE id = ?").get(taskId) as
        { status: string } | undefined;
      if (task?.status === "todo") {
        (async () => {
          for await (const event of executeTask(prevTask.story_id, taskId)) {
            if (event.type === "error") break;
          }
        })().catch((e: unknown) =>
          console.error("Manual task execution failed:", e instanceof Error ? e.message : String(e))
        );
      }
    }
  }

  return c.json(db.prepare("SELECT * FROM story_tasks WHERE id = ?").get(taskId));
});

// ─── Delete a task ────────────────────────────────────────────────────────────

tasksRouter.delete("/:storyId/tasks/:taskId", (c) => {
  db.prepare("DELETE FROM story_tasks WHERE id = ?").run(c.req.param("taskId"));
  return c.json({ ok: true });
});

// ─── Trigger Tech Lead planning (SSE) ─────────────────────────────────────────

tasksRouter.post("/:storyId/plan", (c) => {
  const storyId = c.req.param("storyId");
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of executeTechLeadPlan(storyId)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "error") break;
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "done", content: "Planning complete" }) });
    } catch (e) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", content: e instanceof Error ? e.message : String(e) }) });
    }
  });
});

// ─── Run a single task manually (SSE) ────────────────────────────────────────

tasksRouter.post("/:storyId/tasks/:taskId/execute", (c) => {
  const { storyId, taskId } = c.req.param();
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of executeTask(storyId, taskId)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "error") break;
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "done", content: "Task complete" }) });
    } catch (e) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", content: e instanceof Error ? e.message : String(e) }) });
    }
  });
});
