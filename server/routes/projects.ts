import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const projectsRouter = new Hono();

projectsRouter.get("/", (c) => {
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id) as story_count,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id AND status NOT IN ('backlog','done')) as active_count
    FROM projects p ORDER BY p.created_at DESC
  `).all();
  return c.json(rows);
});

projectsRouter.post("/", async (c) => {
  const body = await c.req.json<{ key: string; name: string; description?: string; color?: string }>();
  if (!body.key || !body.name) return c.json({ error: "key and name required" }, 400);
  const id = nanoid();
  db.prepare("INSERT INTO projects (id, key, name, description, color) VALUES (?, ?, ?, ?, ?)").run(
    id, body.key.toUpperCase(), body.name, body.description ?? null, body.color ?? "#22D3EE"
  );
  return c.json(db.prepare("SELECT * FROM projects WHERE id = ?").get(id), 201);
});

projectsRouter.get("/:id", (c) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

projectsRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string; color?: string }>();
  const id = c.req.param("id");
  if (body.name !== undefined) db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(body.name, id);
  if (body.description !== undefined) db.prepare("UPDATE projects SET description = ? WHERE id = ?").run(body.description, id);
  if (body.color !== undefined) db.prepare("UPDATE projects SET color = ? WHERE id = ?").run(body.color, id);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

projectsRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
