import { Hono } from "hono";
import {
  existsSync, readdirSync, readFileSync, statSync,
} from "node:fs";
import { extname, join } from "node:path";
import { nanoid } from "nanoid";
import { db } from "../db.js";

export const contextsRouter = new Hono();

// List all context sections for a project
contextsRouter.get("/", (c) => {
  const projectId = c.req.query("project_id");
  if (!projectId) return c.json({ error: "project_id required" }, 400);
  const rows = db.prepare(
    "SELECT * FROM project_contexts WHERE project_id = ? ORDER BY sort_order ASC"
  ).all(projectId);
  return c.json(rows);
});

// Upsert a context section
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
    db.prepare(`
      INSERT INTO project_contexts (id, project_id, section, title, content, sort_order, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), projectId, section, body.title ?? section, body.content ?? null, maxOrder + 1, body.updated_by ?? "human");
  }
  return c.json(db.prepare("SELECT * FROM project_contexts WHERE project_id = ? AND section = ?").get(projectId, section));
});

// Scan local repository files and populate context sections
contextsRouter.post("/:projectId/scan", async (c) => {
  const { projectId } = c.req.param();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as {
    local_path: string | null; github_url: string | null;
  } | undefined;

  if (!project?.local_path) {
    return c.json({ error: "Project has no local_path set. Configure it in Settings first." }, 400);
  }
  const root = project.local_path;
  if (!existsSync(root)) {
    return c.json({ error: `Directory not found: ${root}` }, 400);
  }

  const results: Record<string, string> = {};

  // Helper: read a file if it exists
  const readFile = (relPath: string): string | null => {
    const abs = join(root, relPath);
    return existsSync(abs) ? readFileSync(abs, "utf-8").trim() : null;
  };

  // Helper: read first matching file from candidates
  const readFirst = (...paths: string[]): string | null => {
    for (const p of paths) { const c = readFile(p); if (c) return c; }
    return null;
  };

  // Helper: read all md files in a directory
  const readDir = (dir: string, maxFiles = 5): string | null => {
    const abs = join(root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
    const files = readdirSync(abs)
      .filter((f) => [".md", ".txt", ".mdx"].includes(extname(f).toLowerCase()))
      .slice(0, maxFiles);
    if (!files.length) return null;
    return files.map((f) => {
      const content = readFileSync(join(abs, f), "utf-8").trim();
      return `## ${f}\n\n${content}`;
    }).join("\n\n---\n\n");
  };

  // ─── Overview ───────────────────────────────────────────────────────────────
  const readme = readFirst("README.md", "readme.md", "README.mdx", "README.txt");
  if (readme) results.overview = readme;

  // ─── PRD ────────────────────────────────────────────────────────────────────
  const prd = readFirst(
    "PRD.md", "prd.md", "docs/PRD.md", "docs/prd.md",
    "docs/requirements.md", "docs/product.md", "REQUIREMENTS.md",
    "docs/spec.md", "SPEC.md"
  ) ?? readDir("docs");
  if (prd) results.prd = prd;

  // ─── Design System ──────────────────────────────────────────────────────────
  const design = readFirst(
    "DESIGN.md", "design.md", "docs/DESIGN.md", "docs/design.md",
    "docs/design-system.md", "design-system.md", "UI.md"
  );
  if (design) results.design_system = design;

  // ─── Data Model ─────────────────────────────────────────────────────────────
  const dataModel = readFirst(
    "schema.sql", "database/schema.sql", "db/schema.sql",
    "prisma/schema.prisma", "schema.prisma",
    "drizzle/schema.ts", "src/schema.ts", "src/db/schema.ts",
    "docs/data-model.md", "DATA_MODEL.md"
  );
  if (dataModel) results.data_model = dataModel;

  // ─── Architecture ───────────────────────────────────────────────────────────
  const arch = readFirst(
    "ARCHITECTURE.md", "architecture.md", "docs/ARCHITECTURE.md",
    "docs/architecture.md", "docs/tech.md", "TECH.md"
  );
  // Also read package.json for tech stack info
  const pkgJson = readFile("package.json");
  let archContent = arch ?? "";
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        name?: string; description?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 20).join(", ");
      const devDeps = Object.keys(pkg.devDependencies ?? {}).slice(0, 20).join(", ");
      const pkgSummary = [
        `**Package:** ${pkg.name ?? "—"}`,
        pkg.description ? `**Description:** ${pkg.description}` : null,
        deps ? `**Dependencies:** ${deps}` : null,
        devDeps ? `**Dev Dependencies:** ${devDeps}` : null,
      ].filter(Boolean).join("\n");
      archContent = archContent ? `${archContent}\n\n---\n\n${pkgSummary}` : pkgSummary;
    } catch { /* ignore parse errors */ }
  }
  if (archContent) results.architecture = archContent;

  // ─── Conventions ────────────────────────────────────────────────────────────
  const conventions = readFirst(
    "CONTRIBUTING.md", "contributing.md", "docs/CONTRIBUTING.md",
    "CONVENTIONS.md", "conventions.md", "CODING_STANDARDS.md",
    "docs/conventions.md", "CLAUDE.md"
  );
  if (conventions) results.conventions = conventions;

  // Save all found sections
  const now = "datetime('now')";
  for (const [section, content] of Object.entries(results)) {
    db.prepare(`
      INSERT INTO project_contexts (id, project_id, section, title, content, sort_order, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) FROM project_contexts WHERE project_id = ?), 'scan', ${now})
      ON CONFLICT(project_id, section) DO UPDATE SET content = excluded.content, updated_at = ${now}, updated_by = 'scan'
    `).run(nanoid(), projectId, section, section, content, projectId);
  }

  return c.json({
    scanned: Object.keys(results),
    message: `Scanned ${Object.keys(results).length} sections from ${root}`,
  });
});
