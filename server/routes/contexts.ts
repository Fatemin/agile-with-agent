import { Hono } from "hono";
import { existsSync } from "node:fs";
import { db } from "../db.js";
import { scanLocal } from "../scanner.js";

export const contextsRouter = new Hono();

contextsRouter.get("/", (c) => {
  const projectId = c.req.query("project_id");
  if (!projectId) return c.json({ error: "project_id required" }, 400);
  const rows = db.prepare(
    "SELECT * FROM project_contexts WHERE project_id = ? ORDER BY sort_order ASC"
  ).all(projectId);
  return c.json(rows);
});

contextsRouter.put("/:projectId/:section", async (c) => {
  const { projectId, section } = c.req.param();
  const body = await c.req.json<{ content?: string; title?: string; updated_by?: string }>();
  const existing = db.prepare(
    "SELECT id FROM project_contexts WHERE project_id = ? AND section = ?"
  ).get(projectId, section) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE project_contexts SET content = ?, updated_at = datetime('now'), updated_by = ?
      ${body.title ? ", title = ?" : ""}
      WHERE id = ?
    `).run(
      body.content ?? null,
      body.updated_by ?? "human",
      ...(body.title ? [body.title] : []),
      existing.id
    );
  } else {
    const maxOrder = (db.prepare(
      "SELECT MAX(sort_order) as m FROM project_contexts WHERE project_id = ?"
    ).get(projectId) as { m: number | null }).m ?? 0;
    const { nanoid } = await import("nanoid");
    db.prepare(`
      INSERT INTO project_contexts (id, project_id, section, title, content, sort_order, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), projectId, section, body.title ?? section, body.content ?? null, maxOrder + 1, body.updated_by ?? "human");
  }
  return c.json(db.prepare("SELECT * FROM project_contexts WHERE project_id = ? AND section = ?").get(projectId, section));
});

contextsRouter.post("/:projectId/scan", (c) => {
  const { projectId } = c.req.param();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as {
    local_path: string | null;
  } | undefined;

  if (!project?.local_path) {
    return c.json({ error: "Project has no local_path set. Configure it in Settings first." }, 400);
  }
  if (!existsSync(project.local_path)) {
    return c.json({ error: `Directory not found: ${project.local_path}` }, 400);
  }

  const scanned = scanLocal(projectId, project.local_path);
  return c.json({ scanned, message: `Scanned ${scanned.length} sections from ${project.local_path}` });
});
