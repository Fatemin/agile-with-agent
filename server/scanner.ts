import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { nanoid } from "nanoid";
import { db } from "./db.js";

function saveContexts(projectId: string, results: Record<string, string>) {
  for (const [section, content] of Object.entries(results)) {
    db.prepare(`
      INSERT INTO project_contexts (id, project_id, section, title, content, sort_order, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) FROM project_contexts WHERE project_id = ?), 'scan', datetime('now'))
      ON CONFLICT(project_id, section) DO UPDATE SET content = excluded.content, updated_at = datetime('now'), updated_by = 'scan'
    `).run(nanoid(), projectId, section, section, content, projectId);
  }
}

export function scanLocal(projectId: string, root: string): string[] {
  if (!existsSync(root)) return [];

  const results: Record<string, string> = {};

  const readFile = (relPath: string): string | null => {
    const abs = join(root, relPath);
    return existsSync(abs) ? readFileSync(abs, "utf-8").trim() : null;
  };
  const readFirst = (...paths: string[]): string | null => {
    for (const p of paths) { const c = readFile(p); if (c) return c; }
    return null;
  };
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

  const readme = readFirst("README.md", "readme.md", "README.mdx", "README.txt");
  if (readme) results.overview = readme;

  const prd = readFirst(
    "PRD.md", "prd.md", "docs/PRD.md", "docs/prd.md",
    "docs/requirements.md", "docs/product.md", "REQUIREMENTS.md", "docs/spec.md", "SPEC.md"
  ) ?? readDir("docs");
  if (prd) results.prd = prd;

  const design = readFirst(
    "DESIGN.md", "design.md", "docs/DESIGN.md", "docs/design.md",
    "docs/design-system.md", "design-system.md", "UI.md"
  );
  if (design) results.design_system = design;

  const dataModel = readFirst(
    "schema.sql", "database/schema.sql", "db/schema.sql",
    "prisma/schema.prisma", "schema.prisma",
    "drizzle/schema.ts", "src/schema.ts", "src/db/schema.ts",
    "docs/data-model.md", "DATA_MODEL.md"
  );
  if (dataModel) results.data_model = dataModel;

  const arch = readFirst(
    "ARCHITECTURE.md", "architecture.md", "docs/ARCHITECTURE.md",
    "docs/architecture.md", "docs/tech.md", "TECH.md"
  );
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
      const summary = [
        `**Package:** ${pkg.name ?? "—"}`,
        pkg.description ? `**Description:** ${pkg.description}` : null,
        deps ? `**Dependencies:** ${deps}` : null,
        devDeps ? `**Dev Dependencies:** ${devDeps}` : null,
      ].filter(Boolean).join("\n");
      archContent = archContent ? `${archContent}\n\n---\n\n${summary}` : summary;
    } catch { /* ignore */ }
  }
  if (archContent) results.architecture = archContent;

  const conventions = readFirst(
    "CONTRIBUTING.md", "contributing.md", "docs/CONTRIBUTING.md",
    "CONVENTIONS.md", "conventions.md", "CODING_STANDARDS.md", "docs/conventions.md", "CLAUDE.md"
  );
  if (conventions) results.conventions = conventions;

  saveContexts(projectId, results);
  return Object.keys(results);
}

export async function scanGithub(projectId: string, githubUrl: string): Promise<string[]> {
  const match = githubUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!match) return [];
  const [, owner, repoRaw] = match;
  const repo = repoRaw.replace(/\.git$/, "");
  const base = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const headers = { Accept: "application/vnd.github.v3.raw", "User-Agent": "agile-with-agent" };

  const fetchRaw = async (path: string): Promise<string | null> => {
    try {
      const res = await fetch(`${base}/${path}`, { headers });
      return res.ok ? await res.text() : null;
    } catch { return null; }
  };
  const fetchFirst = async (...paths: string[]): Promise<string | null> => {
    for (const p of paths) { const c = await fetchRaw(p); if (c) return c; }
    return null;
  };

  const results: Record<string, string> = {};

  const readme = await fetchFirst("README.md", "readme.md", "README.mdx");
  if (readme) results.overview = readme;

  const prd = await fetchFirst("PRD.md", "docs/PRD.md", "docs/requirements.md", "REQUIREMENTS.md");
  if (prd) results.prd = prd;

  const schema = await fetchFirst(
    "prisma/schema.prisma", "schema.sql", "src/db/schema.ts",
    "drizzle/schema.ts", "database/schema.sql"
  );
  if (schema) results.data_model = schema;

  const conventions = await fetchFirst(
    "CONTRIBUTING.md", "CLAUDE.md", "docs/CONTRIBUTING.md", "CONVENTIONS.md"
  );
  if (conventions) results.conventions = conventions;

  const pkgJson = await fetchRaw("package.json");
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        name?: string; description?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 20).join(", ");
      const devDeps = Object.keys(pkg.devDependencies ?? {}).slice(0, 20).join(", ");
      const summary = [
        `**Package:** ${pkg.name ?? "—"}`,
        pkg.description ? `**Description:** ${pkg.description}` : null,
        deps ? `**Dependencies:** ${deps}` : null,
        devDeps ? `**Dev Dependencies:** ${devDeps}` : null,
      ].filter(Boolean).join("\n");
      if (summary) results.architecture = summary;
    } catch { /* ignore */ }
  }

  saveContexts(projectId, results);
  return Object.keys(results);
}
