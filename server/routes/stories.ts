import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { orchestrator } from "../orchestrator.js";
import { buildBranchName, createBranch } from "../git.js";
import { log } from "../logger.js";

export const storiesRouter = new Hono();

const STORY_JOIN = `
  SELECT s.*, a.name as agent_name, a.provider as agent_provider,
         e.title as epic_title, e.color as epic_color,
         sp.name as sprint_name
  FROM stories s
  LEFT JOIN agents a ON s.assigned_agent_id = a.id
  LEFT JOIN epics e ON s.epic_id = e.id
  LEFT JOIN sprints sp ON s.sprint_id = sp.id
`;

const STATUS_LABELS: Record<string, string> = {
  backlog:      "Backlog",
  todo:         "Todo",
  in_progress:  "In Progress",
  human_review: "Human Review",
  done:         "Done",
  cancelled:    "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};

function getNextKey(projectId: string): string {
  const project = db.prepare("SELECT key FROM projects WHERE id = ?").get(projectId) as { key: string } | undefined;
  if (!project) return "STORY-1";
  const last = db.prepare(
    "SELECT key FROM stories WHERE project_id = ? ORDER BY rowid DESC LIMIT 1"
  ).get(projectId) as { key: string } | undefined;
  if (!last) return `${project.key}-1`;
  const num = parseInt(last.key.split("-").pop() ?? "0", 10);
  return `${project.key}-${num + 1}`;
}

storiesRouter.get("/", (c) => {
  const { project_id, sprint_id, epic_id, status, type } = c.req.query();
  let sql = `${STORY_JOIN} WHERE 1=1`;
  const params: unknown[] = [];
  if (project_id) { sql += " AND s.project_id = ?"; params.push(project_id); }
  if (sprint_id === "null") { sql += " AND s.sprint_id IS NULL"; }
  else if (sprint_id) { sql += " AND s.sprint_id = ?"; params.push(sprint_id); }
  if (epic_id) { sql += " AND s.epic_id = ?"; params.push(epic_id); }
  if (status) { sql += " AND s.status = ?"; params.push(status); }
  if (type) { sql += " AND s.type = ?"; params.push(type); }
  sql += " ORDER BY s.created_at ASC";
  return c.json(db.prepare(sql).all(...params));
});

storiesRouter.post("/", async (c) => {
  const body = await c.req.json<{
    project_id: string; title: string; type?: string;
    as_a?: string; i_want?: string; so_that?: string;
    description?: string; acceptance_criteria?: string;
    definition_of_done?: string; story_points?: number;
    priority?: string; epic_id?: string; sprint_id?: string;
    mode?: "auto" | "manual";
  }>();
  if (!body.project_id || !body.title) return c.json({ error: "project_id and title required" }, 400);

  const id = nanoid();
  const key = getNextKey(body.project_id);
  const mode = body.mode ?? "manual";
  console.log(`[story create] key=${getNextKey(body.project_id)} mode=${mode} sprint_id=${body.sprint_id ?? "none"}`);

  // Flow mode: every story starts in backlog. Sprint is optional grouping only.
  // User explicitly moves to "todo" → dispatcher picks up → in_progress.
  const status = "backlog";
  const sprintBranchName: string | null = body.sprint_id
    ? (db.prepare("SELECT branch_name FROM sprints WHERE id = ?").get(body.sprint_id) as
        { branch_name: string | null } | undefined)?.branch_name ?? null
    : null;

  db.prepare(`
    INSERT INTO stories (id, project_id, epic_id, sprint_id, key, type, title, as_a, i_want, so_that,
                         description, acceptance_criteria, definition_of_done, story_points, priority, status, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.project_id, body.epic_id ?? null, body.sprint_id ?? null, key,
    body.type ?? "story", body.title,
    body.as_a ?? null, body.i_want ?? null, body.so_that ?? null,
    body.description ?? null, body.acceptance_criteria ?? null,
    body.definition_of_done ?? null, body.story_points ?? null,
    body.priority ?? "medium", status, mode);

  // Log story creation
  const sprintLabel = body.sprint_id
    ? (db.prepare("SELECT name FROM sprints WHERE id = ?").get(body.sprint_id) as { name: string } | undefined)?.name ?? body.sprint_id
    : null;
  log(id, "created",
    `Story created: **${key}** [${body.type ?? "story"}] [${mode} mode]${sprintLabel ? ` in sprint ${sprintLabel}` : ""} — status: ${status}`,
    "system"
  );

  // Auto mode: move to 'todo' so the orchestrator's next tick picks it up.
  // Branch creation + status transition + dispatch are now owned by the orchestrator
  // (Symphony §7: only the orchestrator mutates scheduling state).
  if (mode === "auto") {
    db.prepare("UPDATE stories SET status = 'todo', updated_at = datetime('now') WHERE id = ?").run(id);
    log(id, "status_change", "Status changed to **Todo** (auto mode — queued for orchestrator)", "system");
    orchestrator.kick();
  }
  // sprintBranchName is no longer used at creation — sprints are pure labels now.
  void sprintBranchName;

  return c.json(db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(id), 201);
});

storiesRouter.get("/:id", (c) => {
  const row = db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

storiesRouter.patch("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const id = c.req.param("id");

  const allowed = [
    "title", "type", "as_a", "i_want", "so_that", "description",
    "acceptance_criteria", "definition_of_done", "story_points",
    "priority", "status", "epic_id", "sprint_id", "assigned_agent_id",
    // Dev/QA/Rollout fields
    "branch_name", "pr_url", "pr_number",
    "qa_test_cases", "qa_notes", "qa_signed_off_by", "qa_signed_off_at", "staging_url",
    "deploy_env", "deploy_url", "commit_hash", "deployed_at",
    "qa_result", "parent_story_id", "mode",
  ];

  const prev = db.prepare(`
    SELECT s.status, s.mode, s.sprint_id, s.key, s.title, s.branch_name,
           s.assigned_agent_id, s.priority, s.type, s.story_points, s.epic_id,
           p.local_path
    FROM stories s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(id) as {
    status: string; mode: string; sprint_id: string | null; key: string;
    title: string; branch_name: string | null;
    assigned_agent_id: string | null; local_path: string | null;
    priority: string; type: string; story_points: number | null; epic_id: string | null;
  } | undefined;

  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) { updates.push(`${k} = ?`); vals.push(body[k] ?? null); }
  }
  if (updates.length) {
    updates.push("updated_at = datetime('now')");
    db.prepare(`UPDATE stories SET ${updates.join(", ")} WHERE id = ?`).run(...vals, id);
  }

  // ── Field change audit log ─────────────────────────────────────────────────
  if (prev) {
    if ("title" in body && body.title && body.title !== prev.title) {
      log(id, "field_change", `Title: "${prev.title}" → "${body.title as string}"`, "human");
    }
    if ("priority" in body && body.priority && body.priority !== prev.priority) {
      log(id, "field_change",
        `Priority: ${PRIORITY_LABELS[prev.priority] ?? prev.priority} → ${PRIORITY_LABELS[body.priority as string] ?? body.priority as string}`,
        "human"
      );
    }
    if ("type" in body && body.type && body.type !== prev.type) {
      log(id, "field_change", `Type: ${prev.type} → ${body.type as string}`, "human");
    }
    if ("story_points" in body) {
      const newPts = body.story_points as number | null;
      if (newPts !== prev.story_points) {
        log(id, "field_change", `Points: ${prev.story_points ?? "—"} → ${newPts ?? "—"}`, "human");
      }
    }
    if ("assigned_agent_id" in body) {
      const newAgentId = body.assigned_agent_id as string | null;
      if (newAgentId !== prev.assigned_agent_id) {
        if (newAgentId) {
          const agent = db.prepare("SELECT name, role FROM agents WHERE id = ?").get(newAgentId) as
            { name: string; role: string | null } | undefined;
          log(id, "agent_change", `Agent assigned: **${agent?.name ?? newAgentId}**${agent?.role ? ` (${agent.role})` : ""}`, "human");
        } else {
          log(id, "agent_change", "Agent removed", "human");
        }
      }
    }
    if ("sprint_id" in body) {
      const newSprintId = body.sprint_id as string | null;
      if (newSprintId !== prev.sprint_id) {
        if (newSprintId) {
          const sprint = db.prepare("SELECT name FROM sprints WHERE id = ?").get(newSprintId) as { name: string } | undefined;
          log(id, "sprint_change", `Sprint: ${sprint?.name ?? newSprintId}`, "human");
        } else {
          log(id, "sprint_change", "Removed from sprint", "human");
        }
      }
    }
    if ("mode" in body && body.mode && body.mode !== prev.mode) {
      log(id, "field_change", `Mode: ${prev.mode} → ${body.mode as string}`, "human", "warn");
    }
    if ("epic_id" in body) {
      const newEpicId = body.epic_id as string | null;
      if (newEpicId !== prev.epic_id) {
        if (newEpicId) {
          const epic = db.prepare("SELECT title FROM epics WHERE id = ?").get(newEpicId) as { title: string } | undefined;
          log(id, "field_change", `Epic: ${epic?.title ?? newEpicId}`, "human");
        } else {
          log(id, "field_change", "Epic removed", "human");
        }
      }
    }
    if ("pr_url" in body && body.pr_url && body.pr_url !== prev.branch_name) {
      log(id, "field_change", `PR linked: ${body.pr_url as string}`, "human");
    }
  }

  // ── Status transition side-effects (Linear-style flow) ───────────────────
  if (prev && "status" in body && body.status !== prev.status) {
    const newStatus = body.status as string;
    const label = STATUS_LABELS[newStatus] ?? newStatus;
    log(id, "status_change", `Status changed to **${label}**`, "system");

    // in_progress: create branch if missing + nudge orchestrator to pick it up.
    // (Reconciliation also auto-stops runs when status leaves in_progress.)
    if (newStatus === "in_progress") {
      if (prev.local_path && !prev.branch_name) {
        const branchName = buildBranchName(prev.key, prev.title);
        const result = createBranch(prev.local_path, branchName);
        if (result.ok && result.branch) {
          db.prepare("UPDATE stories SET branch_name = ? WHERE id = ?").run(result.branch, id);
          log(id, "git", `Branch created: \`${result.branch}\``, "system");
        } else {
          log(id, "git_error", `Branch creation failed: ${result.error ?? "unknown"}`, "system", "error");
        }
      }
      orchestrator.kick();
    }

    // Moving out of an active state — orchestrator's next tick will terminate the run
    if (newStatus !== "in_progress" && newStatus !== "todo" && prev.status === "in_progress") {
      orchestrator.kick();
    }

    // done: require qa_result = pass (gating still works through human_review)
    if (newStatus === "done") {
      const qaRow = db.prepare("SELECT qa_result FROM stories WHERE id = ?").get(id) as { qa_result: string | null } | undefined;
      if (qaRow?.qa_result !== "pass") {
        return c.json(
          { error: "Cannot mark done — QA has not passed. Move through Human Review first." },
          400
        );
      }
      db.prepare("UPDATE stories SET deployed_at = COALESCE(deployed_at, datetime('now')) WHERE id = ?").run(id);
    }
  }

  // ── QA sign-off ────────────────────────────────────────────────────────────
  if ("qa_signed_off_by" in body && body.qa_signed_off_by) {
    log(id, "qa_signoff", `QA signed off by **${body.qa_signed_off_by as string}**`, "human");
  }

  return c.json(db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(id));
});

storiesRouter.delete("/:id", (c) => {
  db.prepare("DELETE FROM stories WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

storiesRouter.post("/:id/report-bug", async (c) => {
  const parentId = c.req.param("id");
  const body = await c.req.json<{ title: string; description?: string }>();
  if (!body.title) return c.json({ error: "title required" }, 400);

  const parent = db.prepare("SELECT project_id, epic_id, sprint_id FROM stories WHERE id = ?")
    .get(parentId) as { project_id: string; epic_id: string | null; sprint_id: string | null } | undefined;
  if (!parent) return c.json({ error: "Parent story not found" }, 404);

  const id = nanoid();
  const key = getNextKey(parent.project_id);

  db.prepare(`
    INSERT INTO stories
      (id, project_id, epic_id, sprint_id, key, type, title, description, priority, status, parent_story_id)
    VALUES (?, ?, ?, ?, ?, 'bug', ?, ?, 'high', 'todo', ?)
  `).run(id, parent.project_id, parent.epic_id ?? null, parent.sprint_id ?? null,
    key, body.title, body.description ?? null, parentId);

  log(parentId, "qa", `Bug reported: **[${key}]** — ${body.title}`, "system");

  return c.json(db.prepare(`${STORY_JOIN} WHERE s.id = ?`).get(id), 201);
});
