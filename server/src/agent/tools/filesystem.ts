import { tool } from "ai";
import { z } from "zod";

// Phase 1: mock filesystem tools — return canned responses.
// Phase 2+ will wire these to real fs operations.

export const readFileTool = tool({
  description: "Read the contents of a file at the given path",
  parameters: z.object({
    path: z.string().describe("The file path to read"),
  }),
  execute: async ({ path }) => {
    console.log(`[tool:readFile] path=${path}`);
    return {
      path,
      content: `[mock] Contents of ${path} would appear here in a real environment.`,
    };
  },
});

export const writeFileTool = tool({
  description: "Write content to a file at the given path",
  parameters: z.object({
    path: z.string().describe("The file path to write to"),
    content: z.string().describe("The content to write"),
  }),
  execute: async ({ path, content }) => {
    console.log(`[tool:writeFile] path=${path} bytes=${content.length}`);
    return {
      path,
      success: true,
      message: `[mock] Would have written ${content.length} bytes to ${path}.`,
    };
  },
});
