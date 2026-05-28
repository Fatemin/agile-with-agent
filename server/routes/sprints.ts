import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const sprintsRouter = new Hono();

sprintsRouter.get("/", (c) => {
  const projectId = c.req.query("project_id");
  const rows = projectId
    ? db.prepare("SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at ASC").all(projectId)
    : db.prepare("SELECT * FROM sprints ORDER BY created_at ASC").all();
  return c.json(rows);
});

sprintsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    project_id: string; name: string; goal?: string; start_date?: string; end_date?: string;
  }>();
  if (!body.project_id || !body.name) return c.json({ error: "project_id and name required" }, 400);
  const id = nanoid();
  db.prepare("INSERT INTO sprints (id, project_id, name, goal, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, body.project_id, body.name, body.goal ?? null, body.start_date ?? null, body.end_date ?? null
  );
  return c.json(db.prepare("SELECT * FROM sprints WHERE id = ?").get(id), 201);
});

sprintsRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{
    name?: string; goal?: string; start_date?: string; end_date?: string; status?: string;
  }>();
  const id = c.req.param("id");

  if (body.status === "active") {
    // Only one sprint active per project at a time
    const sprint = db.prepare("SELECT project_id FROM sprints WHERE id = ?").get(id) as { project_id: string } | undefined;
    if (sprint) {
      db.prepare("UPDATE sprints SET status = 'completed' WHERE project_id = ? AND status = 'active'").run(sprint.project_id);
    }
    // Move todo stories in this sprint to 'todo' status
    db.prepare("UPDATE stories SET status = 'todo', updated_at = datetime('now') WHERE sprint_id = ? AND status = 'backlog'").run(id);
  }

  const allowed = ["name", "goal", "start_date", "end_date", "status"] as const;
  for (const k of allowed) {
    if (body[k] !== undefined) db.prepare(`UPDATE sprints SET ${k} = ? WHERE id = ?`).run(body[k]!, id);
  }

  return c.json(db.prepare("SELECT * FROM sprints WHERE id = ?").get(id));
});

sprintsRouter.delete("/:id", (c) => {
  // Move stories back to backlog
  db.prepare("UPDATE stories SET sprint_id = NULL, status = 'backlog', updated_at = datetime('now') WHERE sprint_id = ?").run(c.req.param("id"));
  db.prepare("DELETE FROM sprints WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
