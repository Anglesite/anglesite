import Foundation

/// The kind of change a natural-language instruction resolves to. Plain (no FoundationModels
/// dependency) so the op-mapping compiles + tests on the CI toolchain.
public enum InterpretedEditKind: String, Sendable, Equatable {
    /// Replace the element's text content.
    case text
    /// Set (or replace) a single attribute on the element.
    case attribute
    /// Set a single CSS declaration for the element.
    case style
}

/// A model-independent representation of an interpreted edit. The FM-backed interpreter (gated
/// behind `#if compiler(>=6.4)`) produces this; the op-mapping below is pure and CI-tested.
public struct InterpretedEdit: Sendable, Equatable {
    /// Which of the optional payload fields below are meaningful; `resolveOp()` enforces the
    /// per-kind requirements.
    public let kind: InterpretedEditKind
    /// Replacement text — required (non-empty) for `.text`, ignored otherwise.
    public let newText: String?
    /// Attribute to set — required (non-empty) for `.attribute`.
    public let attributeName: String?
    /// New attribute value — required for `.attribute`; empty is allowed (clearing a value is
    /// a valid edit), unlike the other payloads.
    public let attributeValue: String?
    /// CSS property to set — required (non-empty) for `.style`.
    public let styleProperty: String?
    /// CSS value — required (non-empty) for `.style`.
    public let styleValue: String?
    /// One-line human phrasing of the change, for the confirmation dialog.
    public let summary: String

    /// Memberwise initializer. Pass nil for the payload fields the `kind` doesn't use —
    /// `resolveOp()` is the validity check, not this initializer.
    public init(kind: InterpretedEditKind, newText: String?, attributeName: String?, attributeValue: String?,
                styleProperty: String?, styleValue: String?, summary: String) {
        self.kind = kind; self.newText = newText
        self.attributeName = attributeName; self.attributeValue = attributeValue
        self.styleProperty = styleProperty; self.styleValue = styleValue; self.summary = summary
    }

    /// Map to the concrete plugin op + value, or nil if the kind's required payload is missing.
    public func resolveOp() -> ResolvedEditOp? {
        switch kind {
        case .text:
            guard let t = newText, !t.isEmpty else { return nil }
            return ResolvedEditOp(op: "replace-text", value: .string(t))
        case .attribute:
            guard let n = attributeName, !n.isEmpty, let v = attributeValue else { return nil }
            return ResolvedEditOp(op: "replace-attr", value: .object(["name": .string(n), "value": .string(v)]))
        case .style:
            guard let p = styleProperty, !p.isEmpty, let v = styleValue, !v.isEmpty else { return nil }
            return ResolvedEditOp(op: "edit-style", value: .object(["property": .string(p), "value": .string(v)]))
        }
    }
}

/// A wire-ready edit operation: the sidecar op name plus its JSON payload, in the exact shape
/// the MCP apply-edit path expects — so the intent layer never builds payload dictionaries.
public struct ResolvedEditOp: Sendable, Equatable {
    /// Sidecar op identifier: `replace-text`, `replace-attr`, or `edit-style`.
    public let op: String
    /// The payload for `op`, already shaped as the sidecar expects it.
    public let value: JSONValue
    /// Memberwise initializer; prefer deriving instances via `InterpretedEdit.resolveOp()`,
    /// which enforces the per-kind payload requirements.
    public init(op: String, value: JSONValue) { self.op = op; self.value = value }
}

/// Context about the onscreen element the instruction targets.
public struct InterpretedElementContext: Sendable, Equatable {
    /// HTML tag name of the target element, grounding the model's interpretation.
    public let tag: String
    /// The element's current text content, when it has any — lets the model produce a minimal
    /// rewrite instead of inventing content.
    public let currentText: String?
    /// Site-relative path of the page the element appears on.
    public let pagePath: String
    /// Human-readable label for the element, as surfaced to the user.
    public let displayName: String
    /// Site the element belongs to. Required for the FM interpreter to build an `AssistantContext`.
    public let siteID: String?
    /// Root directory of the site on disk. Required for the FM interpreter's `AssistantContext`.
    public let siteDirectory: URL?

    /// Memberwise initializer. `siteID`/`siteDirectory` default to nil because only the
    /// FM-backed interpreter needs them (see their individual docs); the pure op-mapping path
    /// works without a site.
    public init(tag: String, currentText: String?, pagePath: String, displayName: String,
                siteID: String? = nil, siteDirectory: URL? = nil) {
        self.tag = tag; self.currentText = currentText; self.pagePath = pagePath
        self.displayName = displayName; self.siteID = siteID; self.siteDirectory = siteDirectory
    }
}

/// Seam between the intent and the on-device model. The live implementation is FM-backed and
/// `#if compiler(>=6.4)`-gated; tests inject a fake returning a canned `InterpretedEdit`.
public protocol EditInterpreting: Sendable {
    /// Interprets a natural-language `instruction` against `element` into a structured
    /// ``InterpretedEdit``. Throws ``EditInterpretationError`` when interpretation can't run
    /// at all; implementations may also surface model errors directly.
    func interpret(instruction: String, element: InterpretedElementContext) async throws -> InterpretedEdit
}

/// Thrown when on-device interpretation can't run (Apple Intelligence unavailable, etc.).
public enum EditInterpretationError: Error, Sendable, Equatable {
    /// On-device interpretation is not possible on this host (Apple Intelligence disabled,
    /// model not downloaded, …). The message is user-facing.
    case unavailable(String)
    /// The element\'s site isn\'t open in Anglesite (siteID/siteDirectory missing from context).
    case siteUnavailable(String)
}
