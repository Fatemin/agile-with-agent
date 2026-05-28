import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const epicsRouter = new Hono();

epicsRouter.get("/", (c) => {
  const projectId = c.req.query("project_id");
  const rows = projectId
    ? db.prepare("SELECT * FROM epics WHERE project_id = ? ORDER BY created_at ASC").all(projectId)
    : db.prepare("SELECT * FROM epics ORDER BY created_at ASC").all();
  return c.json(rows);
});

epicsRouter.post("/", async (c) => {
  const body = await c.req.json<{ project_id: string; title: string; description?: string; color?: string }>();
  if (!body.project_id || !body.title) return c.json({ error: "project_id and title required" }, 400);
  const id = nanoid();
  db.prepare("INSERT INTO epics (id, project_id, title, description, color) VALUES (?, ?, ?, ?, ?)").run(
    id, body.project_id, body.title, body.description ?? null, body.color ?? "#8B5CF6"
  );
  return c.json(db.prepare("SELECT * FROM epics WHERE id = ?").get(id), 201);
});

epicsRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{ title?: string; description?: string; color?: string; status?: string }>();
  const id = c.req.param("id");
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  for (const [k, v] of fields) {
    if (["title", "description", "color", "status"].includes(k))
      db.prepare(`UPDATE epics SET ${k} = ? WHERE id = ?`).run(v, id);
  }
  return c.json(db.prepare("SELECT * FROM epics WHERE id = ?").get(id));
});

epicsRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM epics WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
