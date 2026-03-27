/** Message types for overlay ↔ server communication. */
export const MESSAGE_TYPES = Object.freeze({
  ADD_ANNOTATION: "anglesite:add-annotation",
  LIST_ANNOTATIONS: "anglesite:list-annotations",
  RESOLVE_ANNOTATION: "anglesite:resolve-annotation",
  ANNOTATIONS_RESPONSE: "anglesite:annotations-response",
  ANNOTATION_RESPONSE: "anglesite:annotation-response",
  ANNOTATION_RESOLVED: "anglesite:annotation-resolved",
  ERROR: "anglesite:error",
});

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

/** Required-field rules per message type. */
const REQUIRED_FIELDS = Object.freeze({
  [MESSAGE_TYPES.ADD_ANNOTATION]: ["path", "selector", "text"],
  [MESSAGE_TYPES.LIST_ANNOTATIONS]: [],
  [MESSAGE_TYPES.RESOLVE_ANNOTATION]: ["id"],
  [MESSAGE_TYPES.ANNOTATIONS_RESPONSE]: ["annotations"],
  [MESSAGE_TYPES.ANNOTATION_RESPONSE]: ["annotation"],
  [MESSAGE_TYPES.ANNOTATION_RESOLVED]: ["id"],
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
