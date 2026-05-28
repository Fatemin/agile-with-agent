import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./db.js";
import { agentsRouter } from "./routes/agents.js";
import { contextsRouter } from "./routes/contexts.js";
import { epicsRouter } from "./routes/epics.js";
import { projectsRouter } from "./routes/projects.js";
import { sprintsRouter } from "./routes/sprints.js";
import { storiesRouter } from "./routes/stories.js";

const app = new Hono();

app.use(logger());
app.use(cors());

app.route("/api/projects", projectsRouter);
app.route("/api/contexts", contextsRouter);
app.route("/api/epics", epicsRouter);
app.route("/api/sprints", sprintsRouter);
app.route("/api/stories", storiesRouter);
app.route("/api/agents", agentsRouter);

// Serve built frontend in production
app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const PORT = Number(process.env.PORT ?? 3001);
console.log(`🚀 Server running on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
