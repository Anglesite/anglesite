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
 *   - `op` is the closed enum {replace-text, replace-attr, replace-image-src, edit-style, apply-instruction}.
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

/** Edit operations the server accepts. The patcher resolves the first four; `apply-instruction`
 *  is an NL-forwarding op the app's Foundation Models chat path sends — the server returns a
 *  structured `needs-agent` refusal so the app can route it to its agent. */
export const editOps = ["replace-text", "replace-attr", "replace-image-src", "edit-style", "apply-instruction"];

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
      "Edit operation: replace-text (innerText), replace-attr (value is {name, value}), replace-image-src (value is {filename, mimeType, dataURL}), edit-style (value is {property, value}; merges a rule into the owning component's scoped <style>), apply-instruction (reserved: sent only by the Anglesite-app Foundation Models chat path; always returns edit-failed/needs-agent — do not use from external callers)",
    ),
  value: z
    .unknown()
    .describe(
      "Operation payload; varies by op (string for replace-text, {name, value} for replace-attr, {filename, mimeType, dataURL} for replace-image-src, {property, value} for edit-style, string for apply-instruction — the NL instruction text)",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "When true, compute the would-be change and return an edit-preview {before, after} WITHOUT writing to disk or recording history",
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
 *  `anglesite/edits` branch (added by #298). `result` is optional, op-scoped metadata that the
 *  overlay can apply directly: e.g. `replace-image-src` returns `{ src, srcset? }` so the
 *  overlay swaps both attributes on success without re-deriving them from the patch text. */
export function createEditAppliedContent(id, file, range, commit, result) {
  const body = { type: "anglesite:edit-applied", id, file, range };
  if (commit !== undefined) body.commit = commit;
  if (result !== undefined) body.result = result;
  return { type: "text", text: JSON.stringify(body) };
}

/** Build the MCP `content` entry for an edit-preview (dry-run) response. `before`/`after` are the
 *  windowed source fragments around the change — see dispatcher `windowAround`. */
export function createEditPreviewContent(id, file, range, op, before, after) {
  const body = { type: "anglesite:edit-preview", id, file, range, op, before, after };
  return { type: "text", text: JSON.stringify(body) };
}
