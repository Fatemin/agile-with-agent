import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const agentsRouter = new Hono();

agentsRouter.get("/", (c) => {
  const rows = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM stories WHERE assigned_agent_id = a.id) as story_count,
      (SELECT COUNT(*) FROM stories WHERE assigned_agent_id = a.id AND status = 'in_progress') as active_count
    FROM agents a ORDER BY a.created_at DESC
  `).all();
  return c.json(rows);
});

agentsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name: string; provider: string; model?: string;
    system_prompt?: string; prompt_template?: string;
  }>();
  if (!body.name || !body.provider) return c.json({ error: "name and provider required" }, 400);
  const id = nanoid();
  db.prepare("INSERT INTO agents (id, name, provider, model, system_prompt, prompt_template) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, body.name, body.provider, body.model ?? null, body.system_prompt ?? null, body.prompt_template ?? null
  );
  return c.json(db.prepare("SELECT * FROM agents WHERE id = ?").get(id), 201);
});

agentsRouter.get("/:id", (c) => {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

agentsRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{
    name?: string; provider?: string; model?: string;
    system_prompt?: string; prompt_template?: string;
  }>();
  const id = c.req.param("id");
  const allowed = ["name", "provider", "model", "system_prompt", "prompt_template"] as const;
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) { updates.push(`${k} = ?`); vals.push((body as Record<string, unknown>)[k] ?? null); }
  }
  if (updates.length) db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...vals, id);
  return c.json(db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
});

agentsRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM agents WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});
