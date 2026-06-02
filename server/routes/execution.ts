import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { executeQA, executeStory } from "../execution.js";

export const executionRouter = new Hono();

executionRouter.post("/:storyId/execute", (c) => {
  const { storyId } = c.req.param();

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of executeStory(storyId)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "done" || event.type === "error") break;
      }
    } catch (e) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          content: e instanceof Error ? e.message : String(e),
        }),
      });
    }
  });
});

executionRouter.post("/:storyId/qa-run", (c) => {
  const { storyId } = c.req.param();

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of executeQA(storyId)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "error") break;
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "done", content: "QA complete" }) });
    } catch (e) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          content: e instanceof Error ? e.message : String(e),
        }),
      });
    }
  });
});
