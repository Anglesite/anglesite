import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addAnnotation,
  listAnnotations,
  resolveAnnotation,
} from "./annotations.mjs";
import {
  applyEditInputShape,
  createEditFailedContent,
} from "./apply-edit-schema.mjs";

const projectRoot = process.env.ANGLESITE_PROJECT_ROOT || process.cwd();

const server = new McpServer({
  name: "anglesite-annotations",
  version: "0.16.4",
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

// Phase 5 edit pipeline (#294). The schema is settled here; the patcher (#295), dispatcher
// (#297), and edit-history (#298) land in follow-up PRs. Until then the handler stubs out
// with `edit-failed: not-implemented`, which is enough for the app to exercise the wire
// format end-to-end and surface the reply in the Debug pane.
server.tool(
  "apply_edit",
  "Apply an edit to the underlying source for a previewed page element. The selector is the structured ElementInfo payload built by the WKWebView overlay; the server resolves it via selector.mjs and patches the matching source file.",
  applyEditInputShape,
  ({ id }) => {
    return {
      content: [
        createEditFailedContent(id, "not-implemented", "Phase 5 patcher (Anglesite/anglesite#295) hasn't landed yet — schema-only stub."),
      ],
      isError: true,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
