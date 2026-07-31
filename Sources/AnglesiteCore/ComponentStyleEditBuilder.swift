import Foundation

/// Builds the wire-format `EditMessage` payloads for the four Component Editor CSS write ops
/// (`set-style-property`, `remove-style-property`, `add-style-rule`, `set-rule-selector`).
/// Pure and testable — no MCP/router dependency. `ComponentEditorModel` (AnglesiteApp) calls
/// this to construct the message, then hands it to `context.editRouter`.
public enum ComponentStyleEditBuilder {
    /// `ruleSpan` is the target rule's byte span (`[start, end]`, either may be `nil`) — the wire
    /// format encodes each element as a JSON number or `null`.
    private static func ruleSpanValue(_ ruleSpan: [Int?]) -> JSONValue {
        .array(ruleSpan.map { $0.map(JSONValue.int) ?? .null })
    }

    /// Builds the `set-style-property` message: set (or add) one declaration in the rule at
    /// `ruleSpan`. Rules are addressed by byte span rather than selector text so two rules
    /// with identical selectors stay unambiguous; `baseVersion` is the model's content hash
    /// (``ComponentModel/version``), which the plugin checks so a stale span can never patch
    /// the wrong bytes.
    public static func setStyleProperty(
        id: String,
        path: String,
        baseVersion: String,
        ruleSpan: [Int?],
        property: String,
        value: String
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.setStyleProperty,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "ruleSpan": ruleSpanValue(ruleSpan),
                "property": .string(property),
                "value": .string(value),
            ]),
            value: nil
        )
    }

    /// Builds the `remove-style-property` message: delete one declaration from the rule at
    /// `ruleSpan`. Same span-addressing and `baseVersion` staleness guard as
    /// ``setStyleProperty(id:path:baseVersion:ruleSpan:property:value:)``.
    public static func removeStyleProperty(
        id: String,
        path: String,
        baseVersion: String,
        ruleSpan: [Int?],
        property: String
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.removeStyleProperty,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "ruleSpan": ruleSpanValue(ruleSpan),
                "property": .string(property),
            ]),
            value: nil
        )
    }

    /// Builds the `set-rule-selector` message: rewrite the selector of the rule at `ruleSpan`,
    /// leaving its declarations untouched. Span addressing is what makes this safe — a
    /// selector-addressed rename couldn't distinguish the rule being renamed from a duplicate.
    public static func setRuleSelector(
        id: String,
        path: String,
        baseVersion: String,
        ruleSpan: [Int?],
        newSelector: String
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.setRuleSelector,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "ruleSpan": ruleSpanValue(ruleSpan),
                "selector": .string(newSelector),
            ]),
            value: nil
        )
    }

    /// Builds the `add-style-rule` message: append a new rule (optionally inside an `@media`
    /// block) with the given declarations. The only CSS op with no `ruleSpan` — there is no
    /// existing rule to address yet. `media` is omitted from the payload entirely when `nil`
    /// (top-level rule), not sent as null.
    public static func addStyleRule(
        id: String,
        path: String,
        baseVersion: String,
        selector: String,
        media: String?,
        declarations: [(property: String, value: String)]
    ) -> EditMessage {
        var payload: [String: JSONValue] = [
            "path": .string(path),
            "baseVersion": .string(baseVersion),
            "selector": .string(selector),
            "declarations": .array(declarations.map {
                .object(["property": .string($0.property), "value": .string($0.value)])
            }),
        ]
        if let media { payload["media"] = .string(media) }
        return EditMessage(id: id, path: path, selector: nil, op: EditMessage.Op.addStyleRule, component: .object(payload), value: nil)
    }
}
