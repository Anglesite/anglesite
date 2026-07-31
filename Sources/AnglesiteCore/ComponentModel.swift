import Foundation

/// Decoded result of the plugin's `get_component_model` MCP tool — a
/// read-only structured view of one `.astro` component (spec §2.2).
public struct ComponentModel: Sendable, Equatable, Codable {
    /// Content hash of the component file this model was parsed from. Every structure/style
    /// write op sends it back as `baseVersion` — the plugin rejects an edit whose base no longer
    /// matches the file on disk, so a model gone stale (external edit, concurrent editor) can
    /// never silently clobber newer content.
    public let version: String
    /// Project-relative path of the `.astro` file (e.g. `src/components/Card.astro`) — the
    /// same path the write ops address, so model and edits always name the file identically.
    public let path: String
    /// Root of the markup tree — a synthetic `.fragment` wrapping the top-level nodes (skipped
    /// by ``ComponentOutline/rows(from:)`` so outline depth 0 is real markup).
    public let template: Node
    /// The `---`-fenced frontmatter block, or `nil` when the component has none.
    public let frontmatter: Frontmatter?
    /// Rules parsed from the component's scoped `<style>` blocks, in source order — each rule's
    /// span is the address the CSS write ops (``ComponentStyleEditBuilder``) target.
    public let styles: [StyleRule]
    /// The component's client-side `<script>` block, or `nil` when there isn't one. Surfaced
    /// read-only — the editor has no structured script ops; scripts are edited as source.
    public let clientScript: ScriptZone?

    /// One markup node. `Identifiable` by the parser-assigned ``id``, which is also how the
    /// structure write ops (``ComponentStructureEditBuilder``) address nodes — valid only
    /// against the model ``ComponentModel/version`` they came from.
    public struct Node: Sendable, Equatable, Codable, Identifiable {
        /// Parser-assigned stable identifier, the address every structure edit uses.
        public let id: String
        /// What sort of node this is — drives sealing, extractability, and palette behavior
        /// (see ``Kind``).
        public let kind: Kind
        /// Tag or component name; `nil` for kinds that have none (fragment, expression, text).
        public let tag: String?
        /// The opening tag's attributes, in source order. Empty (never absent) after decoding.
        public let attrs: [Attr]
        /// Byte span of the node's full source extent, for source-tab highlighting and
        /// span-addressed edits.
        public let span: Span
        /// Line/column of the START of the opening tag — deliberately different from the
        /// canvas's `data-astro-source-loc` (END of the opening tag); the reconciliation lives
        /// in ``ComponentOutline/node(atLine:column:in:)``.
        public let loc: Loc?
        /// Literal text for `.text` nodes (and raw source for `.expression`); `nil` otherwise.
        public let text: String?
        /// Child nodes in document order. Empty (never absent) after decoding. For a
        /// `.component` node these are the slot-fill markup authored at the use site — real
        /// content, but sealed off in the outline (spec §4.1).
        public let children: [Node]

        /// Node taxonomy from the plugin's parser. The distinctions matter to the editor:
        /// `.component` seals its subtree, only `.element`/`.component` are extractable, and
        /// `.fragment` exists solely as the synthetic root.
        public enum Kind: String, Sendable, Codable {
            /// Synthetic grouping node with no tag of its own — the tree root wrapping the
            /// component's top-level markup.
            case fragment
            /// A plain HTML element.
            case element
            /// An imported component instance — sealed in the outline: configured via
            /// attrs/props, its definition edited in its own editor, never inline.
            case component
            /// A `{…}` template expression — dynamic output the structured editor can't
            /// safely rewrite, surfaced as an opaque node.
            case expression
            /// A `<slot>` outlet marking where a parent's slot-fill content lands.
            case slot
            /// A literal text run.
            case text
        }

        /// Memberwise initializer — public so tests can build trees directly; production trees
        /// come from decoding the plugin's `get_component_model` payload.
        public init(id: String, kind: Kind, tag: String?, attrs: [Attr], span: Span, loc: Loc?, text: String?, children: [Node]) {
            self.id = id
            self.kind = kind
            self.tag = tag
            self.attrs = attrs
            self.span = span
            self.loc = loc
            self.text = text
            self.children = children
        }

        /// Custom decoding that defaults `attrs`/`children` to empty and `span` to an unknown
        /// span when the wire omits them — the plugin elides empty collections, and the Swift
        /// side prefers non-optional collections over sprinkling `?? []` at every use site.
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            kind = try c.decode(Kind.self, forKey: .kind)
            tag = try c.decodeIfPresent(String.self, forKey: .tag)
            attrs = try c.decodeIfPresent([Attr].self, forKey: .attrs) ?? []
            span = try c.decodeIfPresent(Span.self, forKey: .span) ?? Span(start: nil, end: nil)
            loc = try c.decodeIfPresent(Loc.self, forKey: .loc)
            text = try c.decodeIfPresent(String.self, forKey: .text)
            children = try c.decodeIfPresent([Node].self, forKey: .children) ?? []
        }
    }

    /// One attribute on a node's opening tag.
    public struct Attr: Sendable, Equatable, Codable {
        /// Attribute name as written in source.
        public let name: String
        /// Attribute value; `nil` for a boolean/valueless attribute (`disabled`), which is
        /// distinct from an empty string (`alt=""`).
        public let value: String?
        /// Memberwise initializer — public for tests; production values decode from the wire.
        public init(name: String, value: String?) {
            self.name = name
            self.value = value
        }
    }

    /// Wire format is a two-element array `[start, end]`, either may be null.
    public struct Span: Sendable, Equatable, Codable {
        /// Byte offset of the span's start in the source file; `nil` when the parser couldn't
        /// determine it.
        public let start: Int?
        /// Byte offset one past the span's end; `nil` when the parser couldn't determine it.
        public let end: Int?

        /// Memberwise initializer — public for tests; production values decode from the wire's
        /// `[start, end]` array form.
        public init(start: Int?, end: Int?) {
            self.start = start
            self.end = end
        }

        /// Decodes the wire's positional `[start, end]` array (see the type-level doc) —
        /// `Codable` synthesis would expect a keyed `{start, end}` object instead.
        public init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            start = try c.decodeIfPresent(Int.self) ?? nil
            end = try c.decodeIfPresent(Int.self) ?? nil
        }

        /// Re-encodes the positional array form, keeping round-trips byte-compatible with the
        /// wire format (explicit `null` for a missing element, never a dropped one).
        public func encode(to encoder: Encoder) throws {
            var c = encoder.unkeyedContainer()
            try c.encode(start)
            try c.encode(end)
        }
    }

    /// A 1-based line/column source position — the START of a node's opening tag, which is why
    /// canvas-selection matching can't compare columns directly (the canvas annotation is the
    /// END of the opening tag; see ``ComponentOutline/node(atLine:column:in:)``).
    public struct Loc: Sendable, Equatable, Codable {
        /// 1-based source line.
        public let line: Int
        /// 1-based source column of the opening tag's start.
        public let column: Int
        /// Memberwise initializer — public for tests; production values decode from the wire.
        public init(line: Int, column: Int) {
            self.line = line
            self.column = column
        }
    }

    /// The component's `---`-fenced frontmatter: raw source for the Source tab plus the parsed
    /// `Props` interface, which is what drives the editor's prop knobs (``Prop``).
    public struct Frontmatter: Sendable, Equatable, Codable {
        /// The frontmatter's raw TypeScript source, verbatim.
        public let source: String
        /// Byte span of the frontmatter block within the file.
        public let span: Span
        /// Props parsed from the frontmatter's `Props` interface; empty when none is declared.
        public let props: [Prop]
    }

    /// One declared prop from the frontmatter's `Props` interface — enough for the editor to
    /// render a knob and pick a sample value (`KnobDefaults`) without re-parsing TypeScript.
    public struct Prop: Sendable, Equatable, Codable {
        /// The prop's name as declared.
        public let name: String
        /// The declared TypeScript type, as source text — matched by string (`"string"`,
        /// `"number"`, …) for knob defaults, not resolved semantically.
        public let type: String
        /// True when the declaration is optional (`name?:`).
        public let optional: Bool
        /// The default value's source text from a destructuring default, if any — quoted as
        /// written, so consumers strip quotes themselves (see `KnobDefaults`). Decoded from the
        /// wire key `default`, which is a Swift keyword.
        public let defaultValue: String?

        enum CodingKeys: String, CodingKey {
            case name, type, optional
            case defaultValue = "default"
        }

        /// Memberwise initializer — public for tests; production values decode from the wire.
        public init(name: String, type: String, optional: Bool, defaultValue: String?) {
            self.name = name
            self.type = type
            self.optional = optional
            self.defaultValue = defaultValue
        }
    }

    /// One CSS rule from the component's scoped `<style>` block. Its ``span`` is the rule's
    /// address for the CSS write ops — ``ComponentStyleEditBuilder`` sends it as `ruleSpan`
    /// rather than a selector string, so two rules with identical selectors stay unambiguous.
    public struct StyleRule: Sendable, Equatable, Codable {
        /// The rule's selector text, verbatim.
        public let selector: String
        /// The enclosing `@media` condition, or `nil` for a top-level rule.
        public let media: String?
        /// Byte span of the whole rule in the file — the identity the write ops target.
        public let span: Span
        /// The rule's declarations in source order.
        public let declarations: [Declaration]
    }

    /// One `property: value` declaration inside a ``StyleRule``.
    public struct Declaration: Sendable, Equatable, Codable {
        /// The CSS property name.
        public let property: String
        /// The declared value, verbatim.
        public let value: String
        /// Byte span of this declaration within the file.
        public let span: Span
    }

    /// The component's client-side `<script>` block, kept as raw source — the structured editor
    /// has no script ops, so this exists for display and source-tab navigation only.
    public struct ScriptZone: Sendable, Equatable, Codable {
        /// The script's source text, verbatim.
        public let source: String
        /// Byte span of the script block within the file.
        public let span: Span
    }
}
