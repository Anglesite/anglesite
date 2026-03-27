import { describe, it, expect } from "vitest";
import {
  MESSAGE_TYPES,
  createAddMessage,
  createListMessage,
  createResolveMessage,
  createAnnotationsResponse,
  createAnnotationResponse,
  parseMessage,
} from "../server/messages.mjs";

// ---------------------------------------------------------------------------
// MESSAGE_TYPES constants
// ---------------------------------------------------------------------------

describe("MESSAGE_TYPES", () => {
  it("defines all expected message types", () => {
    expect(MESSAGE_TYPES.ADD_ANNOTATION).toBe("anglesite:add-annotation");
    expect(MESSAGE_TYPES.LIST_ANNOTATIONS).toBe("anglesite:list-annotations");
    expect(MESSAGE_TYPES.RESOLVE_ANNOTATION).toBe(
      "anglesite:resolve-annotation",
    );
    expect(MESSAGE_TYPES.ANNOTATIONS_RESPONSE).toBe(
      "anglesite:annotations-response",
    );
    expect(MESSAGE_TYPES.ANNOTATION_RESPONSE).toBe(
      "anglesite:annotation-response",
    );
  });
});

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

describe("createAddMessage", () => {
  it("builds an add annotation message", () => {
    const msg = createAddMessage("/about", "h1.hero", "Fix line-height");
    expect(msg).toEqual({
      type: MESSAGE_TYPES.ADD_ANNOTATION,
      path: "/about",
      selector: "h1.hero",
      text: "Fix line-height",
    });
  });
});

describe("createListMessage", () => {
  it("builds a list message without path filter", () => {
    const msg = createListMessage();
    expect(msg).toEqual({ type: MESSAGE_TYPES.LIST_ANNOTATIONS });
  });

  it("builds a list message with path filter", () => {
    const msg = createListMessage("/about");
    expect(msg).toEqual({
      type: MESSAGE_TYPES.LIST_ANNOTATIONS,
      path: "/about",
    });
  });
});

describe("createResolveMessage", () => {
  it("builds a resolve message", () => {
    const msg = createResolveMessage("abc-123");
    expect(msg).toEqual({
      type: MESSAGE_TYPES.RESOLVE_ANNOTATION,
      id: "abc-123",
    });
  });
});

describe("createAnnotationsResponse", () => {
  it("wraps annotations array in a response", () => {
    const annotations = [
      { id: "1", path: "/", selector: "h1", text: "Fix", resolved: false },
    ];
    const msg = createAnnotationsResponse(annotations);
    expect(msg.type).toBe(MESSAGE_TYPES.ANNOTATIONS_RESPONSE);
    expect(msg.annotations).toEqual(annotations);
  });
});

describe("createAnnotationResponse", () => {
  it("wraps a single annotation in a response", () => {
    const annotation = {
      id: "1",
      path: "/",
      selector: "h1",
      text: "Fix",
      resolved: false,
    };
    const msg = createAnnotationResponse(annotation);
    expect(msg.type).toBe(MESSAGE_TYPES.ANNOTATION_RESPONSE);
    expect(msg.annotation).toEqual(annotation);
  });
});

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe("parseMessage", () => {
  it("parses a valid add message", () => {
    const raw = {
      type: "anglesite:add-annotation",
      path: "/",
      selector: "h1",
      text: "Note",
    };
    const result = parseMessage(raw);
    expect(result).toEqual(raw);
  });

  it("returns null for unknown message type", () => {
    expect(parseMessage({ type: "unknown:foo" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseMessage("string")).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it("returns null when type is missing", () => {
    expect(parseMessage({ path: "/" })).toBeNull();
  });

  it("parses all known message types", () => {
    for (const type of Object.values(MESSAGE_TYPES)) {
      const msg = parseMessage({ type });
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe(type);
    }
  });
});
