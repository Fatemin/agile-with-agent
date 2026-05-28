import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const storiesRouter = new Hono();

const STORY_JOIN = `
  SELECT s.*, a.name as agent_name, a.provider as agent_provider,
         e.title as epic_title, e.color as epic_color,
         sp.name as sprint_name
  FROM stories s
  LEFT JOIN agents a ON s.assigned_agent_id = a.id
  LEFT JOIN epics e ON s.epic_id = e.id
  LEFT JOIN sprints sp ON s.sprint_id = sp.id
`;

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
  const { project_id, sprint_id, epic_id, status, type } = c.req.query();
  let sql = `${STORY_JOIN} WHERE 1=1`;
  const params: unknown[] = [];
  if (project_id) { sql += " AND s.project_id = ?"; params.push(project_id); }
  if (sprint_id === "null") { sql += " AND s.sprint_id IS NULL"; }
  else if (sprint_id) { sql += " AND s.sprint_id = ?"; params.push(sprint_id); }
  if (epic_id) { sql += " AND s.epic_id = ?"; params.push(epic_id); }
  if (status) { sql += " AND s.status = ?"; params.push(status); }
  if (type) { sql += " AND s.type = ?"; params.push(type); }
  sql += " ORDER BY s.created_at ASC";
  return c.json(db.prepare(sql).all(...params));
});

storiesRouter.post("/", async (c) => {
  const body = await c.req.json<{
    project_id: string; title: string; type?: string;
    as_a?: string; i_want?: string; so_that?: string;
    description?: string; acceptance_criteria?: string;
    definition_of_done?: string; story_points?: number;
    priority?: string; epic_id?: string; sprint_id?: string;
  }>();
  if (!body.project_id || !body.title) return c.json({ error: "project_id and title required" }, 400);
  const id = nanoid();
  const key = getNextKey(body.project_id);
  let status = "backlog";
  if (body.sprint_id) {
    const sprint = db.prepare("SELECT status FROM sprints WHERE id = ?").get(body.sprint_id) as { status: string } | undefined;
    status = sprint?.status === "active" ? "todo" : "backlog";
  }
  db.prepare(`
    INSERT INTO stories (id, project_id, epic_id, sprint_id, key, type, title, as_a, i_want, so_that,
                         description, acceptance_criteria, definition_of_done, story_points, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.project_id, body.epic_id ?? null, body.sprint_id ?? null, key,
    body.type ?? "story", body.title,
    body.as_a ?? null, body.i_want ?? null, body.so_that ?? null,
    body.description ?? null, body.acceptance_criteria ?? null,
    body.definition_of_done ?? null, body.story_points ?? null,
    body.priority ?? "medium", status);
  return c.json(db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(id), 201);
});

storiesRouter.get("/:id", (c) => {
  const row = db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

storiesRouter.patch("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const id = c.req.param("id");
  const allowed = [
    "title", "type", "as_a", "i_want", "so_that", "description",
    "acceptance_criteria", "definition_of_done", "story_points",
    "priority", "status", "epic_id", "sprint_id", "assigned_agent_id",
  ];
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) { updates.push(`${k} = ?`); vals.push(body[k] ?? null); }
  }
  if (updates.length) {
    updates.push("updated_at = datetime('now')");
    db.prepare(`UPDATE stories SET ${updates.join(", ")} WHERE id = ?`).run(...vals, id);
  }
  return c.json(db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(id));
});

storiesRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM stories WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
