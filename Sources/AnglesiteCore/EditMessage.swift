import Foundation

/// One edit request flowing JS → native, decoded from the `WKScriptMessage.body` JSON dict.
///
/// The `type` field is strict — only message types we explicitly understand are accepted; everything
/// else is rejected at decode (rather than letting unknown types reach the router). New types need
/// an explicit `MessageType` case + decode update, which is the point: the WKWebView boundary is
/// untrusted input, so the contract is closed-set by design.
public struct EditMessage: Sendable, Equatable {
    /// The closed set of accepted `type` tags. Raw values carry the `anglesite:` prefix so
    /// overlay messages can't collide with any other script-message traffic in the page.
    public enum MessageType: String, Sendable, Equatable {
        /// Apply an edit to the underlying source — Phase 5 lands the server-side patcher and the
        /// exact `op` taxonomy. Until then this is the only accepted message type.
        case applyEdit = "anglesite:apply-edit"
    }

    /// App-side conveniences for `op` strings, so callers don't sprinkle free string literals
    /// across the codebase. The wire format stays a `String` (the plugin defines the
    /// authoritative `apply_edit` op set in its MCP schema) — these are just typed names that
    /// make the app↔plugin pairing grep-able and rename-safe on our side.
    ///
    /// New ops on the plugin side need a paired entry here so call sites get a compile-time
    /// reference rather than a runtime mismatch via typo.
    public enum Op {
        /// `"replace-text"` — overlay click-to-edit, structured text replacement.
        public static let replaceText = "replace-text"
        /// `"replace-image-src"` — overlay image-drop replacement.
        public static let replaceImageSrc = "replace-image-src"
        /// `"replace-attr"` — generic attribute set (e.g. `href`, `alt`).
        public static let replaceAttr = "replace-attr"
        /// `"apply-instruction"` — natural-language edit forwarded to the plugin for
        /// interpretation. Used by Foundation Models' chat `ApplyEditTool` (#251). Siri AI's
        /// `EditContentIntent` (B.5 / #149) now emits concrete ops instead.
        public static let applyInstruction = "apply-instruction"
        /// `"set-style-property"` — Component Editor: set a CSS declaration's value (or add it if
        /// absent) within a `<style>` rule. Carries a `component` payload, not `selector`.
        public static let setStyleProperty = "set-style-property"
        /// `"remove-style-property"` — Component Editor: remove a CSS declaration from a rule.
        /// Carries a `component` payload, not `selector`.
        public static let removeStyleProperty = "remove-style-property"
        /// `"add-style-rule"` — Component Editor: add a new CSS rule to a `<style>` block. Carries
        /// a `component` payload, not `selector`.
        public static let addStyleRule = "add-style-rule"
        /// `"set-rule-selector"` — Component Editor: rewrite a CSS rule's selector. Carries a
        /// `component` payload, not `selector`.
        public static let setRuleSelector = "set-rule-selector"
        /// `"insert-node"` — Component Editor: insert a new element/component/slot node.
        /// Carries a `component` payload.
        public static let insertNode = "insert-node"
        /// `"move-node"` — Component Editor: reorder/reparent an existing node. Carries a
        /// `component` payload.
        public static let moveNode = "move-node"
        /// `"remove-node"` — Component Editor: delete a node (and prune now-unused imports).
        /// Carries a `component` payload.
        public static let removeNode = "remove-node"
        /// `"set-attr"` — Component Editor: set or remove (nil value) an attribute/prop at
        /// the use-site. Carries a `component` payload.
        public static let setAttr = "set-attr"
        /// `"extract-component"` — Component Editor: carve an outline subtree out into a brand-new
        /// `.astro` component under `src/components/`, replacing the extracted markup with a
        /// self-closing instance + import (one atomic two-file edit). Carries a `component` payload
        /// with an added `newName` (a bare PascalCase identifier; the server derives the full
        /// `src/components/<newName>.astro` path itself).
        public static let extractComponent = "extract-component"
        /// `"set-props-interface"` — Component Editor: codegen/replace the frontmatter's
        /// `Props` interface + `Astro.props` destructure from a structured props array.
        /// Carries a `component` payload.
        public static let setPropsInterface = "set-props-interface"
        /// `"set-script-zone"` — Component Editor: replace a whole script zone
        /// (`frontmatter` or `client`) wholesale — a code-pane save. Carries a `component`
        /// payload.
        public static let setScriptZone = "set-script-zone"
    }

    /// Overlay-generated correlation ID so the JS side can match replies to the original message.
    public let id: String
    /// Boundary tag — always ``MessageType/applyEdit`` today; kept as a field (not hardcoded)
    /// so future message types extend the struct instead of forking it.
    public let type: MessageType
    /// Page path (e.g. `/about/`).
    public let path: String
    /// Structured element metadata (`ElementInfo`) — the plugin's `server/selector.mjs` resolves
    /// this to a CSS selector server-side. The bridge is a relay; #18 records the decision. `nil`
    /// for Component Editor ops, which address a component/rule via `component` instead.
    public let selector: JSONValue?
    /// Edit operation — `"replace-text"`, `"replace-attr"`, etc. Phase 5 finalizes the taxonomy.
    public let op: String
    /// Component Editor payload — `{ path, baseVersion, ruleSpan, ... }`, op-specific. Carried by
    /// the CSS write ops (`set-style-property`, `remove-style-property`, `add-style-rule`,
    /// `set-rule-selector`) instead of `selector`.
    public let component: JSONValue?
    /// Operation payload — varies by `op`. Optional because some ops (e.g. `"delete"`) won't carry one.
    public let value: JSONValue?
    /// When `true`, the plugin performs a dry run and returns an `anglesite:edit-preview` body
    /// instead of applying the change. Used by `EditContentIntent` to show a before/after diff
    /// before committing. Defaults `false` so all existing call sites are unaffected.
    public let dryRun: Bool

    /// Memberwise initializer for app-originated edits (intents, chat tools) — messages from
    /// the overlay come through ``decode(from:)`` instead. Defaults mirror the wire format's
    /// optionality: `dryRun` false so existing call sites are unaffected by its addition.
    public init(
        id: String,
        type: MessageType = .applyEdit,
        path: String,
        selector: JSONValue? = nil,
        op: String,
        component: JSONValue? = nil,
        value: JSONValue?,
        dryRun: Bool = false
    ) {
        self.id = id
        self.type = type
        self.path = path
        self.selector = selector
        self.op = op
        self.component = component
        self.value = value
        self.dryRun = dryRun
    }

    /// Round-trippable `JSONValue` representation — used as the `arguments` payload when the
    /// router forwards an edit to the plugin's `apply_edit` MCP tool (the `type` field stays as
    /// the WKWebView-side boundary tag `"anglesite:apply-edit"`; the plugin's schema accepts and
    /// ignores it since the tool name is authoritative server-side).
    public var jsonValue: JSONValue {
        var obj: [String: JSONValue] = [
            "id": .string(id),
            "type": .string(type.rawValue),
            "path": .string(path),
            "op": .string(op),
        ]
        if let selector { obj["selector"] = selector }
        if let component { obj["component"] = component }
        if let value { obj["value"] = value }
        if dryRun { obj["dry_run"] = .bool(true) }
        return .object(obj)
    }

    /// Why ``decode(from:)`` rejected a message body. `Equatable` so tests can assert the
    /// exact rejection, and each case carries enough context to log a useful diagnostic
    /// without echoing the (untrusted) payload itself.
    public enum DecodeError: Error, Sendable, Equatable {
        /// The `WKScriptMessage.body` wasn't a JSON object (dictionary) at all.
        case notAnObject
        /// A required field was absent; the payload is the field name.
        case missingField(String)
        /// A field was present but the wrong JSON type; `expected` names the type the
        /// contract requires (e.g. `"string"`, `"object"`).
        case wrongType(field: String, expected: String)
        /// The `type` tag isn't in ``MessageType`` — the closed-set rejection this boundary
        /// exists for. Carries the unrecognized raw value.
        case unknownType(String)
    }

    /// Validate every field at the JS boundary; never throw. Returns a domain `Result` so callers
    /// can log the decode failure with the same machinery they use for everything else.
    public static func decode(from body: Any) -> Result<EditMessage, DecodeError> {
        guard let dict = body as? [String: Any] else { return .failure(.notAnObject) }
        // String-typed required fields, in the order callers see them in error messages.
        func requireString(_ field: String) -> Result<String, DecodeError> {
            guard let raw = dict[field] else { return .failure(.missingField(field)) }
            guard let s = raw as? String else { return .failure(.wrongType(field: field, expected: "string")) }
            return .success(s)
        }

        let id: String
        let typeRaw: String
        let path: String
        let op: String
        switch requireString("id") {
        case .success(let v): id = v
        case .failure(let e): return .failure(e)
        }
        switch requireString("type") {
        case .success(let v): typeRaw = v
        case .failure(let e): return .failure(e)
        }
        switch requireString("path") {
        case .success(let v): path = v
        case .failure(let e): return .failure(e)
        }
        switch requireString("op") {
        case .success(let v): op = v
        case .failure(let e): return .failure(e)
        }

        // `selector` is structured (`ElementInfo` shape) — require an object when present so it's
        // routable to the plugin's `selector.mjs.buildSelector(info)` unchanged. See #18. Absent
        // for Component Editor ops, which address a component/rule via `component` instead.
        let selector: JSONValue?
        if let rawSelector = dict["selector"] {
            guard let jv = JSONValue.from(rawSelector), case .object = jv else {
                return .failure(.wrongType(field: "selector", expected: "object"))
            }
            selector = jv
        } else {
            selector = nil
        }

        // `component` is structured (`{ path, baseVersion, ruleSpan, ... }`) — require an object
        // when present, mirroring `selector`.
        let component: JSONValue?
        if let rawComponent = dict["component"] {
            guard let jv = JSONValue.from(rawComponent), case .object = jv else {
                return .failure(.wrongType(field: "component", expected: "object"))
            }
            component = jv
        } else {
            component = nil
        }

        guard let type = MessageType(rawValue: typeRaw) else {
            return .failure(.unknownType(typeRaw))
        }

        // `value` is optional and polymorphic — accept anything `JSONValue.from` can model.
        let value: JSONValue?
        if let rawValue = dict["value"] {
            guard let jv = JSONValue.from(rawValue) else {
                return .failure(.wrongType(field: "value", expected: "JSON value"))
            }
            value = jv
        } else {
            value = nil
        }

        return .success(EditMessage(id: id, type: type, path: path, selector: selector, op: op, component: component, value: value))
    }
}
