import { Hono } from "hono";
import { db } from "../db.js";

export const settingsRouter = new Hono();

settingsRouter.get("/:key", (c) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(c.req.param("key")) as
    { value: string } | undefined;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ key: c.req.param("key"), value: JSON.parse(row.value) });
});

settingsRouter.put("/:key", async (c) => {
  const body = await c.req.json<{ value: unknown }>();
  const key = c.req.param("key");
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, JSON.stringify(body.value));
  return c.json({ key, value: body.value });
});
