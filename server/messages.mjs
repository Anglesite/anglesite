/** Message types for overlay ↔ server communication. */
export const MESSAGE_TYPES = Object.freeze({
  ADD_ANNOTATION: "anglesite:add-annotation",
  LIST_ANNOTATIONS: "anglesite:list-annotations",
  RESOLVE_ANNOTATION: "anglesite:resolve-annotation",
  ANNOTATIONS_RESPONSE: "anglesite:annotations-response",
  ANNOTATION_RESPONSE: "anglesite:annotation-response",
  ANNOTATION_RESOLVED: "anglesite:annotation-resolved",
  // Edit pipeline (Phase 5). The active MCP surface is the `apply_edit` tool registered in
  // `server/index.mjs`; these constants mirror that so consumers using `messages.mjs` see a
  // complete catalog. `EDIT_APPLIED` / `EDIT_FAILED` describe the response payload that the
  // tool's text content carries (JSON-encoded).
  APPLY_EDIT: "anglesite:apply-edit",
  EDIT_APPLIED: "anglesite:edit-applied",
  EDIT_FAILED: "anglesite:edit-failed",
  ERROR: "anglesite:error",
});

/** Reasons an apply-edit can refuse. The patcher (#295) emits these as the first non-refusal
 *  resolver's `reason`; the dispatcher (#297) routes them into `EDIT_FAILED` responses. */
export const EDIT_FAILED_REASONS = Object.freeze([
  "no-match",
  "ambiguous",
  "dynamic-expression",
  "patch-conflict",
  "write-failed",
  "not-implemented",
  "image-optimize-failed",
  "no-edits-to-undo",
  "head-only-mode",
  "initial-commit",
  "working-tree-modified",
]);

const KNOWN_TYPES = new Set(Object.values(MESSAGE_TYPES));

/** Build an add-annotation message (client → server). */
export function createAddMessage(path, selector, text) {
  return { type: MESSAGE_TYPES.ADD_ANNOTATION, path, selector, text };
}

/** Build a list-annotations message (client → server). */
export function createListMessage(path) {
  const msg = { type: MESSAGE_TYPES.LIST_ANNOTATIONS };
  if (path !== undefined) msg.path = path;
  return msg;
}

/** Build a resolve-annotation message (client → server). */
export function createResolveMessage(id) {
  return { type: MESSAGE_TYPES.RESOLVE_ANNOTATION, id };
}

/** Build an annotations-list response (server → client). */
export function createAnnotationsResponse(annotations) {
  return { type: MESSAGE_TYPES.ANNOTATIONS_RESPONSE, annotations };
}

/** Build a single-annotation response (server → client). */
export function createAnnotationResponse(annotation) {
  return { type: MESSAGE_TYPES.ANNOTATION_RESPONSE, annotation };
}

/** Build a resolved notification (server → client push). */
export function createResolvedNotification(id) {
  return { type: MESSAGE_TYPES.ANNOTATION_RESOLVED, id };
}

/** Build an error message (server → client). */
export function createErrorMessage(message) {
  return { type: MESSAGE_TYPES.ERROR, message };
}

/** Build an edit-applied response (server → client). `range` is `{start, end}` byte offsets in
 *  `file`; `commit` is the SHA on the hidden `anglesite/edits` branch (#298). `result` is
 *  optional, op-scoped metadata that the overlay can apply directly: e.g. `replace-image-src`
 *  returns `{ src, srcset? }` so the overlay swaps both attributes on success without
 *  re-deriving them from the patch text. Mirrors `createEditAppliedContent` in
 *  `apply-edit-schema.mjs` — keep them in lockstep when the wire format changes. */
export function createEditAppliedMessage(id, file, range, commit, result) {
  const msg = { type: MESSAGE_TYPES.EDIT_APPLIED, id, file, range, commit };
  if (result !== undefined) msg.result = result;
  return msg;
}

/** Build an edit-failed response (server → client). `reason` must be one of `EDIT_FAILED_REASONS`. */
export function createEditFailedMessage(id, reason, detail) {
  const msg = { type: MESSAGE_TYPES.EDIT_FAILED, id, reason };
  if (detail !== undefined) msg.detail = detail;
  return msg;
}

/** Required-field rules per message type. */
const REQUIRED_FIELDS = Object.freeze({
  [MESSAGE_TYPES.ADD_ANNOTATION]: ["path", "selector", "text"],
  [MESSAGE_TYPES.LIST_ANNOTATIONS]: [],
  [MESSAGE_TYPES.RESOLVE_ANNOTATION]: ["id"],
  [MESSAGE_TYPES.ANNOTATIONS_RESPONSE]: ["annotations"],
  [MESSAGE_TYPES.ANNOTATION_RESPONSE]: ["annotation"],
  [MESSAGE_TYPES.ANNOTATION_RESOLVED]: ["id"],
  [MESSAGE_TYPES.APPLY_EDIT]: ["id", "path", "selector", "op"],
  [MESSAGE_TYPES.EDIT_APPLIED]: ["id", "file", "range"],
  [MESSAGE_TYPES.EDIT_FAILED]: ["id", "reason"],
  [MESSAGE_TYPES.ERROR]: ["message"],
});

/** Parse and validate an incoming message. Returns null if invalid. */
export function parseMessage(raw) {
  if (raw === null || typeof raw !== "object" || !raw.type) return null;
  if (!KNOWN_TYPES.has(raw.type)) return null;

  const required = REQUIRED_FIELDS[raw.type];
  if (required) {
    for (const field of required) {
      if (raw[field] === undefined || raw[field] === null) return null;
    }
  }

  // annotations must be an array
  if (
    raw.type === MESSAGE_TYPES.ANNOTATIONS_RESPONSE &&
    !Array.isArray(raw.annotations)
  ) {
    return null;
  }

  return raw;
}
