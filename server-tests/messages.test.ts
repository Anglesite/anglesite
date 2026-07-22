import { describe, it, expect } from "vitest";
import {
  MESSAGE_TYPES,
  createAddMessage,
  createListMessage,
  createResolveMessage,
  createAnnotationsResponse,
  createAnnotationResponse,
  createResolvedNotification,
  createErrorMessage,
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
    expect(MESSAGE_TYPES.ANNOTATION_RESOLVED).toBe(
      "anglesite:annotation-resolved",
    );
    expect(MESSAGE_TYPES.ERROR).toBe("anglesite:error");
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

describe("createResolvedNotification", () => {
  it("builds a resolved notification with annotation id", () => {
    const msg = createResolvedNotification("abc-123");
    expect(msg).toEqual({
      type: MESSAGE_TYPES.ANNOTATION_RESOLVED,
      id: "abc-123",
    });
  });
});

describe("createErrorMessage", () => {
  it("builds an error message with a reason string", () => {
    const msg = createErrorMessage("MCP server unreachable");
    expect(msg).toEqual({
      type: MESSAGE_TYPES.ERROR,
      message: "MCP server unreachable",
    });
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

  // Per-type payload validation

  it("rejects add-annotation missing path", () => {
    expect(
      parseMessage({
        type: MESSAGE_TYPES.ADD_ANNOTATION,
        selector: "h1",
        text: "Note",
      }),
    ).toBeNull();
  });

  it("rejects add-annotation missing selector", () => {
    expect(
      parseMessage({
        type: MESSAGE_TYPES.ADD_ANNOTATION,
        path: "/",
        text: "Note",
      }),
    ).toBeNull();
  });

  it("rejects add-annotation missing text", () => {
    expect(
      parseMessage({
        type: MESSAGE_TYPES.ADD_ANNOTATION,
        path: "/",
        selector: "h1",
      }),
    ).toBeNull();
  });

  it("rejects resolve-annotation missing id", () => {
    expect(
      parseMessage({ type: MESSAGE_TYPES.RESOLVE_ANNOTATION }),
    ).toBeNull();
  });

  it("accepts list-annotations without optional path", () => {
    const msg = parseMessage({ type: MESSAGE_TYPES.LIST_ANNOTATIONS });
    expect(msg).not.toBeNull();
  });

  it("accepts list-annotations with path", () => {
    const msg = parseMessage({
      type: MESSAGE_TYPES.LIST_ANNOTATIONS,
      path: "/about",
    });
    expect(msg).not.toBeNull();
    expect(msg!.path).toBe("/about");
  });

  it("rejects annotations-response missing annotations array", () => {
    expect(
      parseMessage({ type: MESSAGE_TYPES.ANNOTATIONS_RESPONSE }),
    ).toBeNull();
  });

  it("rejects annotations-response with non-array annotations", () => {
    expect(
      parseMessage({
        type: MESSAGE_TYPES.ANNOTATIONS_RESPONSE,
        annotations: "not-array",
      }),
    ).toBeNull();
  });

  it("accepts valid annotations-response", () => {
    const msg = parseMessage({
      type: MESSAGE_TYPES.ANNOTATIONS_RESPONSE,
      annotations: [],
    });
    expect(msg).not.toBeNull();
  });

  it("rejects annotation-response missing annotation", () => {
    expect(
      parseMessage({ type: MESSAGE_TYPES.ANNOTATION_RESPONSE }),
    ).toBeNull();
  });

  it("rejects annotation-resolved missing id", () => {
    expect(
      parseMessage({ type: MESSAGE_TYPES.ANNOTATION_RESOLVED }),
    ).toBeNull();
  });

  it("accepts valid annotation-resolved", () => {
    const msg = parseMessage({
      type: MESSAGE_TYPES.ANNOTATION_RESOLVED,
      id: "abc",
    });
    expect(msg).not.toBeNull();
  });

  it("rejects error message missing message field", () => {
    expect(parseMessage({ type: MESSAGE_TYPES.ERROR })).toBeNull();
  });

  it("accepts valid error message", () => {
    const msg = parseMessage({
      type: MESSAGE_TYPES.ERROR,
      message: "Server unreachable",
    });
    expect(msg).not.toBeNull();
    expect(msg!.message).toBe("Server unreachable");
  });
});
