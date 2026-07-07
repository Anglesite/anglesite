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
 *   - `op` is the closed enum {replace-text, replace-attr, replace-image-src, edit-style, apply-instruction}
 *     plus the four Component Editor style ops (`COMPONENT_STYLE_OPS`): set-style-property,
 *     remove-style-property, add-style-rule, set-rule-selector — see `componentEditSchema`.
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
 *  structured `needs-agent` refusal so the app can route it to its agent. The last four are the
 *  Component Editor's component-style ops (see `componentEditSchema` / `COMPONENT_STYLE_OPS`). */
export const editOps = [
  "replace-text",
  "replace-attr",
  "replace-image-src",
  "edit-style",
  "apply-instruction",
  "set-style-property",
  "remove-style-property",
  "add-style-rule",
  "set-rule-selector",
];

/** The subset of `editOps` that operate on a component's scoped `<style>` via `component`
 *  rather than on a page element via `selector`. Reused by `patcher.mjs` and
 *  `apply-edit-dispatcher.mjs` to branch dispatch without repeating the op-name list. */
export const COMPONENT_STYLE_OPS = new Set([
  "set-style-property",
  "remove-style-property",
  "add-style-rule",
  "set-rule-selector",
]);

/** Structured payload for the four component-style ops. Identifies the target rule by its exact
 *  byte span (from `get_component_model`'s `styles[].span`) plus a `baseVersion` content-hash
 *  guard so a stale client-side model is refused rather than silently mis-patching. */
export const componentEditSchema = z.object({
  path: z.string().describe("Component path relative to the project root, e.g. src/components/Card.astro"),
  baseVersion: z.string().describe("Content-hash version (sha256:...) the edit was computed against; a mismatch is refused as stale"),
  ruleSpan: z
    .tuple([z.number().int().nullable(), z.number().int().nullable()])
    .optional()
    .describe("Identifies an existing rule by its exact byte span from get_component_model's styles[].span. Required for set-style-property, remove-style-property, set-rule-selector. Omitted for add-style-rule."),
  property: z.string().optional().describe("Declaration property name; required for set-style-property and remove-style-property"),
  value: z.string().optional().describe("Declaration value; required for set-style-property"),
  selector: z.string().optional().describe("New rule's selector for add-style-rule, or the renamed selector for set-rule-selector"),
  media: z.string().nullable().optional().describe("@media condition for add-style-rule; absent/null means no wrapping media query"),
  declarations: z
    .array(z.object({ property: z.string(), value: z.string() }))
    .optional()
    .describe("Initial declarations for add-style-rule"),
});

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
    .describe("Page or component path"),
  selector: elementInfoSchema
    .optional()
    .describe(
      "Structured element metadata for page-level ops; resolved server-side via selector.mjs.buildSelector",
    ),
  component: componentEditSchema
    .optional()
    .describe(
      "Structured component-style edit payload for set-style-property/remove-style-property/add-style-rule/set-rule-selector",
    ),
  op: z
    .enum(editOps)
    .describe(
      "Edit operation: replace-text (innerText), replace-attr (value is {name, value}), replace-image-src (value is {filename, mimeType, dataURL}), edit-style (value is {property, value}; merges a rule into the owning component's scoped <style>), apply-instruction (reserved: sent only by the Anglesite-app Foundation Models chat path; always returns edit-failed/needs-agent — do not use from external callers), set-style-property/remove-style-property/add-style-rule/set-rule-selector (component-style ops — see componentEditSchema)",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      "Operation payload; varies by op (string for replace-text, {name, value} for replace-attr, {filename, mimeType, dataURL} for replace-image-src, {property, value} for edit-style, string for apply-instruction — the NL instruction text). Omitted for the component-style ops, whose payload is `component`.",
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
 *  overlay swaps both attributes on success without re-deriving them from the patch text.
 *  `model` is a fresh `buildComponentModel` result piggybacked on component-style-op success so
 *  the app never needs a second round-trip to `get_component_model` after a write. */
export function createEditAppliedContent(id, file, range, commit, result, model) {
  const body = { type: "anglesite:edit-applied", id, file, range };
  if (commit !== undefined) body.commit = commit;
  if (result !== undefined) body.result = result;
  if (model !== undefined) body.model = model;
  return { type: "text", text: JSON.stringify(body) };
}

/** Build the MCP `content` entry for an edit-preview (dry-run) response. `before`/`after` are the
 *  windowed source fragments around the change — see dispatcher `windowAround`. */
export function createEditPreviewContent(id, file, range, op, before, after) {
  const body = { type: "anglesite:edit-preview", id, file, range, op, before, after };
  return { type: "text", text: JSON.stringify(body) };
}
