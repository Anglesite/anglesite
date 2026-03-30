import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addAnnotation,
  listAnnotations,
  resolveAnnotation,
} from "./annotations.mjs";

const projectRoot = process.env.ANGLESITE_PROJECT_ROOT || process.cwd();

const server = new McpServer({
  name: "anglesite-annotations",
  version: "1.0.0",
});

server.tool(
  "add_annotation",
  "Pin a feedback note to a page element",
  {
    path: z.string().describe("Page path, e.g. /about"),
    selector: z.string().describe("CSS selector of the target element"),
    text: z.string().describe("The feedback note text"),
    sourceFile: z
      .string()
      .optional()
      .describe("Source file path, e.g. src/pages/about.astro"),
  },
  ({ path, selector, text, sourceFile }) => {
    const annotation = addAnnotation(projectRoot, {
      path,
      selector,
      text,
      sourceFile,
    });
    return { content: [{ type: "text", text: JSON.stringify(annotation) }] };
  },
);

server.tool(
  "list_annotations",
  "List unresolved feedback annotations",
  {
    path: z.string().optional().describe("Filter by page path"),
  },
  ({ path }) => {
    const annotations = listAnnotations(projectRoot, path);
    return { content: [{ type: "text", text: JSON.stringify(annotations) }] };
  },
);

server.tool(
  "resolve_annotation",
  "Mark a feedback annotation as resolved",
  {
    id: z.string().describe("Annotation ID to resolve"),
  },
  ({ id }) => {
    try {
      const annotation = resolveAnnotation(projectRoot, id);
      return { content: [{ type: "text", text: JSON.stringify(annotation) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
