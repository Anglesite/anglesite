import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { listContent } from "./list-content.mjs";
import { createPage, createPost } from "./create-content.mjs";

/**
 * The plugin version is the single source of truth (`bin/release.ts` keeps the
 * three manifests in lockstep). Read it from the manifest at startup so the MCP
 * `initialize` handshake never drifts from the bundled plugin the host copied.
 */
function pluginVersion() {
  try {
    const manifestUrl = new URL(
      "../.claude-plugin/plugin.json",
      import.meta.url,
    );
    const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8"));
    return manifest.version ?? "0.0.0";
  } catch (err) {
    // Surface the problem (bad install path, stale bundled copy) without breaking
    // startup — the app-host may read this version for compatibility checks.
    console.warn("[anglesite] could not read plugin version:", err.message);
    return "0.0.0";
  }
}

/**
 * Build the Anglesite MCP server with every tool registered against `projectRoot`.
 * Transport-agnostic — the caller connects it to stdio or HTTP.
 */
export function buildServer(projectRoot) {
  const server = new McpServer({
    name: "anglesite",
    version: pluginVersion(),
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

  // Siri AI Phase A content tools (#140 / A.6). `list_content` feeds the Anglesite-app's
  // SiteContentGraph (#142); `create_page`/`create_post` back the Add-Page/Add-Post intents (A.5).
  server.tool(
    "list_content",
    "List the site's pages, article-like content-collection entries (posts, notes, episodes, experiments), and images under public/images, as structured JSON. Read-only; the filesystem is the source of truth.",
    {},
    () => {
      const listing = listContent(projectRoot);
      return { content: [{ type: "text", text: JSON.stringify(listing) }] };
    },
  );

  server.tool(
    "create_page",
    "Scaffold a new Astro page under src/pages/ from a BaseLayout template and commit it. Does not overwrite an existing page.",
    {
      name: z.string().describe("Human-readable page name, e.g. 'About Us'. Used as the title."),
      route: z
        .string()
        .optional()
        .describe("URL route, e.g. /about or /services/web. Derived from name when omitted."),
    },
    ({ name, route }) => {
      try {
        const result = createPage(projectRoot, { name, route });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    },
  );

  server.tool(
    "create_post",
    "Scaffold a new content-collection entry (default collection: posts) as a draft from a template and commit it. Does not overwrite an existing entry.",
    {
      title: z.string().describe("Post title. Used as the slug source when slug is omitted."),
      collection: z
        .string()
        .optional()
        .describe("Content collection name, e.g. posts (default) or notes."),
      slug: z.string().optional().describe("URL slug. Derived from title when omitted."),
    },
    ({ title, collection, slug }) => {
      try {
        const result = createPost(projectRoot, { title, collection, slug });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    },
  );

  return server;
}

/** Connect a freshly built server to stdio. The default transport. */
export async function startStdioServer({ projectRoot }) {
  const server = buildServer(projectRoot);
  await server.connect(new StdioServerTransport());
}
