/**
 * Design guide — the single source of truth for how agents must write a design.
 *
 * Every design run (executeDesign) injects buildDesignPrompt() so all agents
 * produce a structured, readable, accurate plan in the SAME language the story
 * was written in. Keep this prompt the only place that defines design output.
 */

/**
 * Detect the language to write the design in, from the story's own text.
 * CJK (Chinese/Japanese/Korean) → "Chinese" (this tool's main non-English case);
 * otherwise "English". The agent is also told to mirror the story's language, so
 * less common languages still work — this just makes the common case deterministic.
 */
export function detectStoryLanguage(text: string): "Chinese" | "English" {
  // CJK Unified + Hiragana/Katakana + Hangul
  return /[一-鿿぀-ヿ가-힯]/.test(text) ? "Chinese" : "English";
}

/**
 * Build the design-phase instructions. Starts with the literal marker
 * "## Design Phase" (relied on downstream to detect a design run).
 */
export function buildDesignPrompt(opts: { storyText: string }): string {
  const lang = detectStoryLanguage(opts.storyText);
  return `## Design Phase

Explore the codebase (read-only) and produce a clear, accurate **implementation plan**.
Do NOT modify files, run git, or write code in this phase.

**Write the ENTIRE design in ${lang}** — always match the language the story is written in
(including the section headings). Use the story's own terminology.

Use exactly these sections, as Markdown (translate the headings into ${lang}):

1. **Summary** — 1–2 sentences: what will be built and why.
2. **Affected files** — a bullet list of \`path/to/file\` → the specific change to make.
   Only list files you actually opened while exploring; never invent paths.
3. **Approach** — numbered, concrete steps a developer can follow in order.
4. **Data / API changes** — schema, types, or endpoints touched (write the local word for "None" if not applicable).
5. **Risks & edge cases** — a short bullet list of what could break or needs care.
6. **Acceptance criteria check** — map each acceptance criterion to how the plan satisfies it.

Readability & accuracy rules:
- Use headings, short bullet lists, and \`code\` spans for files / functions / identifiers.
  No walls of text — a reviewer should grasp the plan in under a minute.
- Be specific and factual: cite the real files and symbols you found. If something is
  unknown or undecided, say so explicitly — do not fabricate details.
- Keep it concise. Output the plan only, with no preamble or sign-off.

---

After the prose plan, output the task breakdown as exactly ONE fenced \`\`\`json code block
(JSON keys in English; string values may be in ${lang}):

\`\`\`json
{
  "goal": "one sentence: the outcome this story delivers",
  "tasks": [
    {
      "seq": 1,
      "role": "backend",
      "title": "short imperative title",
      "description": "what to do, concretely",
      "acceptance_criteria": "- checkable item\\n- another",
      "scope_paths": ["path/or/glob/the/task/will/touch"],
      "depends_on": []
    }
  ]
}
\`\`\`

Rules for the task block:
- \`role\` is one of: frontend, backend, fullstack, qa, devops, security, custom.
- Order tasks so each task's \`depends_on\` lists only the \`seq\` numbers of earlier tasks it needs.
- \`scope_paths\`: the specific files/globs that task will create or modify (from "Affected files").
- Split work that touches clearly separate areas into separate tasks; keep a task focused.
- Always include a final task with \`role: "qa"\` that verifies the acceptance criteria.`;
}
