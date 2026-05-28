import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const storiesRouter = new Hono();

function getNextKey(projectId: string): string {
  const project = db.prepare("SELECT key FROM projects WHERE id = ?").get(projectId) as { key: string } | undefined;
  if (!project) return "STORY-1";
  const last = db.prepare(
    "SELECT key FROM stories WHERE project_id = ? ORDER BY rowid DESC LIMIT 1"
  ).get(projectId) as { key: string } | undefined;
  if (!last) return `${project.key}-1`;
  const num = parseInt(last.key.split("-").pop() ?? "0", 10);
  return `${project.key}-${num + 1}`;
}

storiesRouter.get("/", (c) => {
  const { project_id, sprint_id, epic_id, status } = c.req.query();
  let sql = `
    SELECT s.*, a.name as agent_name, a.provider as agent_provider,
           e.title as epic_title, e.color as epic_color
    FROM stories s
    LEFT JOIN agents a ON s.assigned_agent_id = a.id
    LEFT JOIN epics e ON s.epic_id = e.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (project_id) { sql += " AND s.project_id = ?"; params.push(project_id); }
  if (sprint_id === "null") { sql += " AND s.sprint_id IS NULL"; }
  else if (sprint_id) { sql += " AND s.sprint_id = ?"; params.push(sprint_id); }
  if (epic_id) { sql += " AND s.epic_id = ?"; params.push(epic_id); }
  if (status) { sql += " AND s.status = ?"; params.push(status); }
  sql += " ORDER BY s.created_at ASC";
  return c.json(db.prepare(sql).all(...params));
});

storiesRouter.post("/", async (c) => {
  const body = await c.req.json<{
    project_id: string; title: string; description?: string;
    acceptance_criteria?: string; story_points?: number; priority?: string;
    epic_id?: string; sprint_id?: string;
  }>();
  if (!body.project_id || !body.title) return c.json({ error: "project_id and title required" }, 400);
  const id = nanoid();
  const key = getNextKey(body.project_id);
  // If sprint_id provided and sprint is active, status = todo
  let status = "backlog";
  if (body.sprint_id) {
    const sprint = db.prepare("SELECT status FROM sprints WHERE id = ?").get(body.sprint_id) as { status: string } | undefined;
    status = sprint?.status === "active" ? "todo" : "backlog";
  }
  db.prepare(`
    INSERT INTO stories (id, project_id, epic_id, sprint_id, key, title, description, acceptance_criteria, story_points, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.project_id, body.epic_id ?? null, body.sprint_id ?? null,
    key, body.title, body.description ?? null, body.acceptance_criteria ?? null,
    body.story_points ?? null, body.priority ?? "medium", status
  );
  return c.json(db.prepare(`
    SELECT s.*, a.name as agent_name, a.provider as agent_provider,
           e.title as epic_title, e.color as epic_color
    FROM stories s LEFT JOIN agents a ON s.assigned_agent_id = a.id LEFT JOIN epics e ON s.epic_id = e.id
    WHERE s.id = ?
  `).get(id), 201);
});

storiesRouter.get("/:id", (c) => {
  const row = db.prepare(`
    SELECT s.*, a.name as agent_name, a.provider as agent_provider,
           e.title as epic_title, e.color as epic_color
    FROM stories s LEFT JOIN agents a ON s.assigned_agent_id = a.id LEFT JOIN epics e ON s.epic_id = e.id
    WHERE s.id = ?
  `).get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

storiesRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{
    title?: string; description?: string; acceptance_criteria?: string;
    story_points?: number | null; priority?: string; status?: string;
    epic_id?: string | null; sprint_id?: string | null;
    assigned_agent_id?: string | null;
  }>();
  const id = c.req.param("id");
  const allowed = ["title", "description", "acceptance_criteria", "story_points", "priority", "status", "epic_id", "sprint_id", "assigned_agent_id"] as const;
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) { updates.push(`${k} = ?`); vals.push((body as Record<string, unknown>)[k] ?? null); }
  }
  if (updates.length) {
    updates.push("updated_at = datetime('now')");
    db.prepare(`UPDATE stories SET ${updates.join(", ")} WHERE id = ?`).run(...vals, id);
  }
  return c.json(db.prepare(`
    SELECT s.*, a.name as agent_name, a.provider as agent_provider,
           e.title as epic_title, e.color as epic_color
    FROM stories s LEFT JOIN agents a ON s.assigned_agent_id = a.id LEFT JOIN epics e ON s.epic_id = e.id
    WHERE s.id = ?
  `).get(id));
});

storiesRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM stories WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
