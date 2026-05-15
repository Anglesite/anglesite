/**
 * Zod schema for the `apply_edit` MCP tool — the wire format the Anglesite-app WKWebView edit
 * overlay sends. Decided in Anglesite/Anglesite-app#18 (selector strategy = server-side
 * resolution via this `ElementInfo` payload) and finalized here. Mirrors the `ElementInfo`
 * typedef in `selector.mjs` so `buildSelector(info)` can consume the payload directly.
 *
 * Reconciled vs. the original #296 proposal:
 *   - `selector: ElementInfo` (drops `element/tagName/textFingerprint/domPath`; matches
 *     selector.mjs's existing typedef).
 *   - `path` (drops `url`; the app already uses `path` on its side).
 *   - `op` is the closed enum {replace-text, replace-attr, replace-image-src}.
 *   - No `site` field — the MCP server already knows its `projectRoot`.
 *   - `type` is accepted-and-ignored — the app uses it as a WKWebView-side boundary tag.
 */
import { z } from "zod";

const ancestorInfoSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  nthChild: z.number().int().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
});

export const elementInfoSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()),
  nthChild: z.number().int(),
  ancestors: z.array(ancestorInfoSchema).optional(),
  dataAnglesiteId: z.string().optional(),
  dataTestId: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  textContent: z.string().optional(),
});

/** Edit operations the patcher knows how to apply. Phase 5's patcher (#295) implements these;
 *  new ops require an explicit enum addition + a resolver update. */
export const editOps = ["replace-text", "replace-attr", "replace-image-src"];

/** The MCP tool's input shape, as passed to `server.tool(name, description, shape, handler)`. */
export const applyEditInputShape = {
  id: z
    .string()
    .describe("Correlation ID echoed back in edit-applied/edit-failed"),
  type: z
    .string()
    .optional()
    .describe(
      "Boundary tag from the WKWebView side (e.g. 'anglesite:apply-edit') — accepted and ignored; the MCP tool name is authoritative",
    ),
  path: z
    .string()
    .describe("Page path where the edit happened, e.g. /about/"),
  selector: elementInfoSchema.describe(
    "Structured element metadata; resolved server-side via selector.mjs.buildSelector",
  ),
  op: z
    .enum(editOps)
    .describe(
      "Edit operation: replace-text (innerText), replace-attr (op needs value to be {name, value}), replace-image-src (value is {filename, mimeType, dataURL})",
    ),
  value: z
    .unknown()
    .describe(
      "Operation payload; varies by op (string for replace-text, {name, value} for replace-attr, {filename, mimeType, dataURL} for replace-image-src)",
    ),
};

/** Build the MCP `content` entry for an edit-failed response. The handler wraps this in
 *  `{content: [...], isError: true}`. */
export function createEditFailedContent(id, reason, detail) {
  const body = { type: "anglesite:edit-failed", id, reason };
  if (detail !== undefined) body.detail = detail;
  return { type: "text", text: JSON.stringify(body) };
}

/** Build the MCP `content` entry for an edit-applied response. `range` is `{start, end}` byte
 *  offsets in `file`; `commit` is the SHA the patch was committed to on the hidden
 *  `anglesite/edits` branch (added by #298). */
export function createEditAppliedContent(id, file, range, commit) {
  const body = { type: "anglesite:edit-applied", id, file, range };
  if (commit !== undefined) body.commit = commit;
  return { type: "text", text: JSON.stringify(body) };
}
