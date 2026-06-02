import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { executeDocsAgent } from "../execution.js";
import { scanGithub, scanLocal } from "../scanner.js";

export const projectsRouter = new Hono();

projectsRouter.get("/", (c) => {
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id) as story_count,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id AND status NOT IN ('backlog','done')) as active_count,
      (SELECT COUNT(*) FROM sprints WHERE project_id = p.id AND status = 'active') as active_sprint_count
    FROM projects p
    WHERE p.status != 'archived'
    ORDER BY p.created_at DESC
  `).all();
  return c.json(rows);
});

projectsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    key: string; name: string; description?: string; color?: string;
    local_path?: string; github_url?: string; tech_stack?: string;
    is_existing?: boolean;
  }>();
  if (!body.key || !body.name) return c.json({ error: "key and name required" }, 400);

  const id = nanoid();
  db.prepare(`
    INSERT INTO projects (id, key, name, description, color, local_path, github_url, tech_stack)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.key.toUpperCase(), body.name, body.description ?? null,
    body.color ?? "#0891B2", body.local_path ?? null, body.github_url ?? null,
    body.tech_stack ?? null
  );

  const sections = [
    { section: "overview", title: "Project Overview", sort_order: 0 },
    { section: "prd", title: "Product Requirements", sort_order: 1 },
    { section: "design_system", title: "Design System", sort_order: 2 },
    { section: "data_model", title: "Data Model", sort_order: 3 },
    { section: "architecture", title: "Architecture & Tech Stack", sort_order: 4 },
    { section: "conventions", title: "Coding Conventions", sort_order: 5 },
    { section: "glossary", title: "Domain Glossary", sort_order: 6 },
  ];
  for (const s of sections) {
    db.prepare("INSERT OR IGNORE INTO project_contexts (id, project_id, section, title, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
      .run(nanoid(), id, s.section, s.title, null, s.sort_order);
  }

  if (body.is_existing) {
    if (body.local_path) {
      scanLocal(id, body.local_path);
    } else if (body.github_url) {
      await scanGithub(id, body.github_url);
    }
  }

  return c.json(db.prepare("SELECT * FROM projects WHERE id = ?").get(id), 201);
});

projectsRouter.get("/:id", (c) => {
  const row = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id) as story_count,
      (SELECT COUNT(*) FROM stories WHERE project_id = p.id AND status NOT IN ('backlog','done')) as active_count
    FROM projects p WHERE p.id = ?
  `).get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

projectsRouter.patch("/:id", async (c) => {
  const body = await c.req.json<{
    name?: string; description?: string; color?: string;
    local_path?: string; github_url?: string; tech_stack?: string;
    definition_of_done?: string; status?: string;
  }>();
  const id = c.req.param("id");
  const allowed = ["name", "description", "color", "local_path", "github_url", "tech_stack", "definition_of_done", "status"] as const;
  for (const k of allowed) {
    if (k in body) db.prepare(`UPDATE projects SET ${k} = ? WHERE id = ?`).run((body as Record<string, unknown>)[k] ?? null, id);
  }
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

projectsRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

projectsRouter.post("/:id/generate-context", async (c) => {
  const projectId = c.req.param("id");
  const { agent_id } = await c.req.json<{ agent_id: string }>();
  if (!agent_id) return c.json({ error: "agent_id required" }, 400);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of executeDocsAgent(projectId, agent_id)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "done" || event.type === "error") break;
      }
    } catch (e) {
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: e instanceof Error ? e.message : String(e) }),
      });
    }
  });
});
