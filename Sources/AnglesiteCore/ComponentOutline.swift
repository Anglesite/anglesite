import Foundation
// CoreTransferable is Darwin-only; ComponentOutline is in the Linux-portable target set
// (Package.swift's cross-platform-port purity sweep), so the drag-payload Transferable types
// below — pure data used by SwiftUI .draggable/.dropDestination in the app target (Task
// 16/17/18) — are gated off the off-Darwin build rather than pulled in unconditionally.
#if canImport(CoreTransferable)
import CoreTransferable
import UniformTypeIdentifiers
#endif

/// Pure presentation logic for the Component Editor, kept in Core so it is
/// testable without the app target (hosted app tests don't run on CI).
public enum ComponentOutline {
    /// One flattened outline entry — the tree pre-walked into a flat list (with explicit
    /// ``depth``) because SwiftUI's `List` renders and indents a flat array far more
    /// predictably than a recursive `OutlineGroup` for this editor's needs.
    public struct Row: Sendable, Equatable, Identifiable {
        /// The model node this row presents.
        public let node: ComponentModel.Node
        /// Nesting depth for indentation. 0 is the component's top-level markup — the synthetic
        /// fragment root is skipped by ``ComponentOutline/rows(from:)``.
        public let depth: Int
        /// True for a `kind == .component` node — its children are real markup (slot-fill
        /// content authored at the use site), but the outline treats the instance as opaque
        /// (spec §4.1): configure it via its attrs/props, or double-click to edit the
        /// component's own definition.
        public let isSealed: Bool
        /// `Identifiable` conformance — the node's own parser-assigned id, so SwiftUI selection
        /// state survives a model refetch (ids are stable across re-parses of unchanged nodes).
        public var id: String { node.id }

        /// Memberwise initializer — public for tests; production rows come from
        /// ``ComponentOutline/rows(from:)``, which is what enforces the sealing walk.
        public init(node: ComponentModel.Node, depth: Int, isSealed: Bool = false) {
            self.node = node
            self.depth = depth
            self.isSealed = isSealed
        }
    }

    /// Depth-first rows for a flat SwiftUI List; the synthetic fragment root
    /// is skipped so depth 0 is the component's top-level markup. A
    /// `kind == .component` node's children are never visited — the instance
    /// is sealed (spec §4.1), so its slot-fill markup never becomes rows.
    public static func rows(from root: ComponentModel.Node) -> [Row] {
        var rows: [Row] = []
        func visit(_ node: ComponentModel.Node, depth: Int) {
            let sealed = node.kind == .component
            rows.append(Row(node: node, depth: depth, isSealed: sealed))
            guard !sealed else { return }
            for child in node.children { visit(child, depth: depth + 1) }
        }
        let topLevel = root.kind == .fragment ? root.children : [root]
        for node in topLevel { visit(node, depth: 0) }
        return rows
    }

    /// Whether `node` can be extracted into its own component. Restricted to
    /// `.element` and `.component` kinds: the outline root is a `.fragment` (nothing to extract),
    /// and `.slot`/`.expression`/`.text` nodes have no meaningful standalone extraction. The
    /// plugin op also permits a bare `<slot />`, but that isn't a useful first-pass UI affordance,
    /// so the trigger is narrowed to elements and component instances. (A sealed component
    /// instance's own slot-fill children never surface as outline rows — see `rows(from:)` above
    /// — so there are no "rows inside a sealed instance" to guard against; the instance row
    /// itself stays extractable.)
    public static func isExtractable(_ node: ComponentModel.Node) -> Bool {
        switch node.kind {
        case .element, .component: return true
        case .fragment, .slot, .expression, .text: return false
        }
    }

    /// Source-loc match — the canvas reports the loc Astro's dev server
    /// stamps on the rendered element via `data-astro-source-loc`, which is
    /// the END of the element's opening tag (verified against
    /// `@astrojs/compiler`'s `transform(..., { annotateSourceFile: true })`:
    /// an element parsed at line L column 1 is annotated `L:C` for some
    /// `C > 1`). The parser's own `loc` on `ComponentModel.Node` is the START
    /// of the tag, so lines always match but columns never do exactly.
    ///
    /// Match by line; among same-line candidates whose column is at or
    /// before the reported column (the annotation column is always ≥ the
    /// parse column of the same element), pick the greatest column — i.e.
    /// the closest preceding start position. An exact line+column match
    /// always wins first, in case some future emitter does annotate the
    /// start position.
    public static func node(atLine line: Int, column: Int, in root: ComponentModel.Node) -> ComponentModel.Node? {
        var exact: ComponentModel.Node?
        var bestOffset: ComponentModel.Node?
        var bestOffsetColumn = Int.min

        func visit(_ node: ComponentModel.Node) {
            if let loc = node.loc, loc.line == line {
                if loc.column == column, exact == nil {
                    exact = node
                } else if loc.column <= column, loc.column > bestOffsetColumn {
                    bestOffsetColumn = loc.column
                    bestOffset = node
                }
            }
            for child in node.children { visit(child) }
        }
        visit(root)

        return exact ?? bestOffset
    }

    /// True when a canvas selection's `file` (vite-rooted, e.g.
    /// "/src/components/Card.astro", or an absolute filesystem path ending in
    /// that) refers to the component at `relativePath` (project-relative,
    /// e.g. "src/components/Card.astro") — compared via suffix, not equality,
    /// so a selection elsewhere in the harness page (chrome, a nested child
    /// component's own markup) never line-matches against the wrong outline.
    public static func fileMatches(_ file: String?, relativePath: String) -> Bool {
        guard let file, !file.isEmpty else { return false }
        let normalized = file.hasPrefix("/") ? String(file.dropFirst()) : file
        return normalized == relativePath || normalized.hasSuffix("/" + relativePath)
    }

    /// Three-way classification of a drop point within an outline row (Task 16), shared by
    /// drag-reorder and palette-insert. Kept here (not the View) so the geometry and the
    /// index math it feeds are unit-testable.
    public enum DropZone: Equatable, Sendable {
        /// Insert as the row's preceding sibling (top third of the row).
        case before
        /// Insert as the row's child (middle third) — reparenting, not reordering.
        case into
        /// Insert as the row's following sibling (bottom third).
        case after
    }

    /// Classifies `y` (row-local, per SwiftUI's `dropDestination` contract) into a `DropZone`:
    /// top third = before, bottom third = after, middle third = into. `rowHeight` is a fixed
    /// reference (the sidebar row's approximate rendered height) rather than measured
    /// geometry — acceptable imprecision for a coarse three-way split.
    public static func dropZone(y: Double, rowHeight: Double = 22) -> DropZone {
        if y < rowHeight / 3 { return .before }
        if y > rowHeight * 2 / 3 { return .after }
        return .into
    }

    /// Finds `nodeID`'s parent id by walking `root`. Returns nil if `nodeID` is `root` itself
    /// or isn't found.
    public static func parentID(of nodeID: String, in root: ComponentModel.Node) -> String? {
        if root.children.contains(where: { $0.id == nodeID }) { return root.id }
        for child in root.children {
            if let found = parentID(of: nodeID, in: child) { return found }
        }
        return nil
    }

    /// The index of `nodeID` among `parentID`'s children, or nil if either id isn't found.
    public static func childIndex(of nodeID: String, underParent parentID: String, in root: ComponentModel.Node) -> Int? {
        guard let parent = findNode(parentID, in: root) else { return nil }
        return parent.children.firstIndex { $0.id == nodeID }
    }

    /// True when `candidateID` is `ancestorID` itself, or nested anywhere in its subtree.
    /// Used to refuse a reparent that would create a structural cycle — dragging a node onto
    /// (or before/after a descendant of) its own descendant.
    public static func isNodeOrDescendant(_ candidateID: String, of ancestorID: String, in root: ComponentModel.Node) -> Bool {
        guard let ancestor = findNode(ancestorID, in: root) else { return false }
        return containsNode(candidateID, in: ancestor)
    }

    /// Adjusts a computed before/after sibling index for a reorder move: the plugin's
    /// `move-node` handler removes the dragged node from its old position before re-inserting,
    /// and computes the target index against that post-removal list. `targetIndex` here is the
    /// target's position in the *current* (pre-removal) list, so when the dragged node is
    /// already an earlier sibling of the target under the same parent, its removal shifts every
    /// later sibling (including the target) down by one — this corrects for that so the drop
    /// lands in the same visual spot.
    public static func adjustedMoveIndex(targetIndex: Int, draggedIndex: Int?) -> Int {
        guard let draggedIndex, draggedIndex < targetIndex else { return targetIndex }
        return targetIndex - 1
    }

    private static func findNode(_ id: String, in node: ComponentModel.Node) -> ComponentModel.Node? {
        if node.id == id { return node }
        for child in node.children {
            if let found = findNode(id, in: child) { return found }
        }
        return nil
    }

    private static func containsNode(_ id: String, in node: ComponentModel.Node) -> Bool {
        if node.id == id { return true }
        return node.children.contains { containsNode(id, in: $0) }
    }
}

/// Builds harness-route URLs for the component canvas (route injected by the
/// template's anglesite-harness integration).
public enum HarnessURL {
    /// Builds the harness route for one component, or `nil` for a path the harness can't render
    /// — only `.astro` files under `src/components/` or `src/layouts/` have harness routes, so
    /// a `nil` here is the caller's signal to show no canvas rather than a 404. Props travel as
    /// a single JSON blob in one `props` query parameter, percent-encoded strictly (see the
    /// inline comment) so values containing `+`/`&`/`=` survive the harness's
    /// `URLSearchParams` decoding intact.
    public static func build(base: URL, componentPath: String, props: [String: String]) -> URL? {
        let prefixes = ["src/components/", "src/layouts/"]
        guard let prefix = prefixes.first(where: { componentPath.hasPrefix($0) }),
              componentPath.hasSuffix(".astro")
        else { return nil }
        let name = String(componentPath.dropFirst(prefix.count).dropLast(".astro".count))
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/_anglesite/component/" + name
        if !props.isEmpty,
           let data = try? JSONSerialization.data(withJSONObject: props, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) {
            // `URLComponents.queryItems` percent-encodes via `.urlQueryAllowed`, which treats RFC
            // 3986 sub-delims (`+`, `&`, `=`, `;`, …) as unreserved and leaves them literal — but
            // the harness decodes the query with `URLSearchParams`, which follows form-encoding
            // semantics: an unescaped `+` becomes a space, and `&`/`=` are parsed as extra
            // parameter delimiters, corrupting the JSON payload. Percent-encode everything except
            // RFC 3986 unreserved characters (unlike `.urlQueryAllowed`, this doesn't special-case
            // "query-safe" delimiters) so any prop value survives the round-trip intact.
            var allowedCharacters = CharacterSet.alphanumerics
            allowedCharacters.insert(charactersIn: "-._~")
            guard let encodedJSON = json.addingPercentEncoding(withAllowedCharacters: allowedCharacters) else { return nil }
            components.percentEncodedQuery = "props=" + encodedJSON
        }
        return components.url
    }
}

/// Sample prop values that make any component render standalone.
public enum KnobDefaults {
    /// Initial knob value for `prop`: the component's own declared default (quotes stripped —
    /// ``ComponentModel/Prop/defaultValue`` carries them as written in source) when there is
    /// one, else a benign per-type sample so the harness never renders `undefined` into the
    /// preview. Unknown types get `""` rather than a guess.
    public static func value(for prop: ComponentModel.Prop) -> String {
        if let declared = prop.defaultValue {
            return declared.trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
        }
        switch prop.type {
        case "string": return "Sample"
        case "number": return "1"
        case "boolean": return "false"
        default: return ""
        }
    }
}

#if canImport(CoreTransferable)
/// Drag payload for an outline row being reordered/reparented (Task 16) — identifies the
/// component file being edited (guards against a cross-editor drop landing on the wrong
/// component's tree) and the node being moved.
public struct ComponentDragItem: Codable, Sendable, Transferable {
    /// Identifies the component file whose tree the node belongs to — the drop target compares
    /// this against its own file and refuses a mismatch (the cross-editor guard).
    public let fileID: String
    /// The dragged node's id within that file's model tree.
    public let nodeID: String

    /// Memberwise initializer for the drag source.
    public init(fileID: String, nodeID: String) {
        self.fileID = fileID
        self.nodeID = nodeID
    }

    /// Codable transfer under the app's own exported UTI, so this payload only matches
    /// Anglesite's own drop targets — a drop into another app carries nothing it would render.
    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .anglesiteComponentDragItem)
    }
}

/// Drag payload for a palette row being dropped into the outline or onto the canvas (Task 17/18).
public struct PaletteDragPayload: Codable, Sendable, Transferable {
    /// The palette item's display label, carried along for drop-feedback UI.
    public let label: String
    /// What to insert on drop — feeds straight into
    /// `ComponentStructureEditBuilder.insertNode`'s `node` parameter.
    public let kind: ComponentStructureEditBuilder.NodeSpec

    /// Memberwise initializer for the palette drag source.
    public init(label: String, kind: ComponentStructureEditBuilder.NodeSpec) {
        self.label = label
        self.kind = kind
    }

    /// Codable transfer under the app's own exported UTI — same Anglesite-only matching
    /// rationale as `ComponentDragItem`.
    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .anglesitePaletteDragPayload)
    }
}

/// Unified drag payload for the outline row drop target (Task 16), which must accept drops
/// from two different drag sources — an outline row being reordered (`ComponentDragItem`) and
/// a palette item being inserted (`PaletteDragPayload`). SwiftUI's `.dropDestination(for:)` on
/// macOS does not compose when chained for two different `Transferable` types on the same view
/// (only the first-registered type actually receives drops at the AppKit level), so both drag
/// sources must share one `Transferable` type and one `.dropDestination` call.
public enum OutlineDragPayload: Codable, Sendable, Transferable {
    /// An existing outline row being reordered/reparented.
    case move(ComponentDragItem)
    /// A palette item being inserted as a new node.
    case insert(PaletteDragPayload)

    /// Codable transfer under its own exported UTI — distinct from the two wrapped payloads'
    /// UTIs, since this is the type the shared `.dropDestination` registers for.
    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .anglesiteOutlineDragPayload)
    }
}
#endif
