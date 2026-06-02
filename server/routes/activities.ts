import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const activitiesRouter = new Hono();

activitiesRouter.get("/:storyId/activities", (c) => {
  const { storyId } = c.req.param();
  const rows = db.prepare(
    "SELECT * FROM story_activities WHERE story_id = ? ORDER BY created_at DESC"
  ).all(storyId);
  return c.json(rows);
});

activitiesRouter.post("/:storyId/activities", async (c) => {
  const { storyId } = c.req.param();
  const body = await c.req.json<{ content: string; author?: string; type?: string }>();
  if (!body.content?.trim()) return c.json({ error: "content required" }, 400);
  const id = nanoid();
  db.prepare(
    "INSERT INTO story_activities (id, story_id, type, content, author) VALUES (?, ?, ?, ?, ?)"
  ).run(id, storyId, body.type ?? "comment", body.content, body.author ?? "human");
  return c.json(db.prepare("SELECT * FROM story_activities WHERE id = ?").get(id), 201);
});
