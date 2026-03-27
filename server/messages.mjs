/** Message types for overlay ↔ server communication. */
export const MESSAGE_TYPES = Object.freeze({
  ADD_ANNOTATION: "anglesite:add-annotation",
  LIST_ANNOTATIONS: "anglesite:list-annotations",
  RESOLVE_ANNOTATION: "anglesite:resolve-annotation",
  ANNOTATIONS_RESPONSE: "anglesite:annotations-response",
  ANNOTATION_RESPONSE: "anglesite:annotation-response",
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

/** Parse and validate an incoming message. Returns null if invalid. */
export function parseMessage(raw) {
  if (raw === null || typeof raw !== "object" || !raw.type) return null;
  if (!KNOWN_TYPES.has(raw.type)) return null;
  return raw;
}
