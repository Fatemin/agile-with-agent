import { nanoid } from "nanoid";
import { db } from "./db.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  storyId: string,
  type: string,
  content: string,
  author: string = "system",
  level: LogLevel = "info"
): void {
  db.prepare(
    "INSERT INTO story_activities (id, story_id, type, content, author, level) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(nanoid(), storyId, type, content, author, level);
}

/** Non-story orchestrator/system events (no FK to stories). */
export function logSystem(type: string, content: string, level: LogLevel = "info"): void {
  try {
    db.prepare(
      "INSERT INTO system_events (id, type, content, level) VALUES (?, ?, ?, ?)"
    ).run(nanoid(), type, content, level);
  } catch (e) {
    console.error("[logSystem] failed:", e instanceof Error ? e.message : String(e));
  }
  // Also mirror to console for live tailing
  const prefix = level === "error" ? "✗" : level === "warn" ? "⚠" : "·";
  console.log(`[${type}] ${prefix} ${content}`);
}
