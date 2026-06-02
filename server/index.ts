import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { db } from "./db.js";
import { activitiesRouter } from "./routes/activities.js";
import { executionRouter } from "./routes/execution.js";
import { tasksRouter } from "./routes/tasks.js";
import { settingsRouter } from "./routes/settings.js";
import { runsRouter } from "./routes/runs.js";
import { agentsRouter } from "./routes/agents.js";
import { contextsRouter } from "./routes/contexts.js";
import { epicsRouter } from "./routes/epics.js";
import { projectsRouter } from "./routes/projects.js";
import { sprintsRouter } from "./routes/sprints.js";
import { storiesRouter } from "./routes/stories.js";
import { orchestrator } from "./orchestrator.js";

const app = new Hono();

app.use(logger());
app.use(cors());

app.route("/api/projects", projectsRouter);
app.route("/api/contexts", contextsRouter);
app.route("/api/epics", epicsRouter);
app.route("/api/sprints", sprintsRouter);
app.route("/api/stories", storiesRouter);
app.route("/api/stories", activitiesRouter);
app.route("/api/agents", agentsRouter);
app.route("/api/stories", executionRouter);
app.route("/api/stories", tasksRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/runs", runsRouter);

// Orchestrator observability snapshot — Symphony §13.3
app.get("/api/snapshot", (c) => c.json(orchestrator.snapshot()));
app.post("/api/snapshot/kick", (c) => { orchestrator.kick(); return c.json({ ok: true }); });

// System-level events (orchestrator startup/dispatch/recovery, no story FK)
app.get("/api/system-events", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const rows = db.prepare(
    "SELECT id, type, level, content, created_at FROM system_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  return c.json(rows);
});

// Serve built frontend in production
app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const PORT = Number(process.env.PORT ?? 3001);
console.log(`🚀 Server running on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });

// Start the orchestrator polling loop
orchestrator.start();

// Graceful shutdown — abort in-flight workers
const shutdown = async () => {
  console.log("Shutting down orchestrator…");
  try { await orchestrator.stop(); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
