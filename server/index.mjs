import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addAnnotation,
  listAnnotations,
  resolveAnnotation,
} from "./annotations.mjs";
import { applyEditInputShape } from "./apply-edit-schema.mjs";
import { applyEdit } from "./apply-edit-dispatcher.mjs";
import { recordEdit } from "./edit-history.mjs";
import { undoEdit } from "./undo-edit.mjs";

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

// Phase 5 edit pipeline. The schema lives in `apply-edit-schema.mjs` (#296); the resolver in
// `patcher.mjs` (#295); the apply/refusal logic in `apply-edit-dispatcher.mjs` (#297); the
// hidden-branch history that backs per-edit undo in `edit-history.mjs` (#298). The dispatcher
// invokes `onApplied` after a successful patch — `recordEdit` commits onto refs/heads/anglesite/edits
// without touching HEAD/index/working-tree and returns the SHA, which the dispatcher threads
// back as `commit` on the edit-applied response.
server.tool(
  "apply_edit",
  "Apply an edit to the underlying source for a previewed page element. The selector is the structured ElementInfo payload built by the WKWebView overlay; the server resolves it via selector.mjs and patches the matching source file. Successful edits are also committed onto the hidden anglesite/edits branch for per-edit undo.",
  applyEditInputShape,
  async (input) =>
    applyEdit(projectRoot, input, {
      onApplied: ({ file, range }) =>
        recordEdit(projectRoot, { file, range, message: `anglesite: edit ${file}` }),
    }),
);

server.tool(
  "undo_edit",
  "Undo the most-recent commit on the hidden anglesite/edits branch by writing the parent commit's blobs back to disk. HEAD-only in v1: an optional `commit` argument must equal current HEAD (or be omitted). `force: true` skips the working-tree-modification check and overwrites any external changes to the touched files.",
  {
    commit: z.string().optional().describe("SHA to undo. Must equal current HEAD of refs/heads/anglesite/edits if provided."),
    force: z.boolean().optional().describe("Skip the working-tree-modification check and overwrite any external changes. Default false."),
  },
  async ({ commit, force }) => {
    const result = await undoEdit(projectRoot, { commit, force });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result.status === "refused",
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
