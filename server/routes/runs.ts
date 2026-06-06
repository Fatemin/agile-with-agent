import { Hono } from "hono";
import { db, type SqlParam } from "../db.js";

export const runsRouter = new Hono();

// GET /api/runs?story_id=X  or  ?agent_id=X  or  ?task_id=X
runsRouter.get("/", (c) => {
  const { story_id, agent_id, task_id } = c.req.query();
  let sql = `
    SELECT r.*,
           a.name AS agent_name, a.role AS agent_role
    FROM agent_runs r
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE 1=1
  `;
  const params: SqlParam[] = [];
  if (story_id) { sql += " AND r.story_id = ?"; params.push(story_id); }
  if (agent_id) { sql += " AND r.agent_id = ?"; params.push(agent_id); }
  if (task_id)  { sql += " AND r.task_id = ?";  params.push(task_id); }
  sql += " ORDER BY r.created_at DESC LIMIT 100";
  return c.json(db.prepare(sql).all(...params));
});
