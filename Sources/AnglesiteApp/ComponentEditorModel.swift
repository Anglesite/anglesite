import Foundation
import AnglesiteCore
import Observation
// This whole target (`Sources/AnglesiteApp` → `AnglesiteAppCore`) is already gated on
// `canImport(Darwin)` in Package.swift, so CoreGraphics (for `CGPoint` drop locations, #824's
// moved drag/drop hit-testing) is safe to import unconditionally here.
import CoreGraphics

/// Everything MainPaneEditorView needs to host a component editor; built by
/// the site window from PreviewModel state.
struct ComponentEditorContext {
    let baseURL: URL?
    let modelClient: ComponentModelClient?
    let sourceRoot: URL
    /// The open site's identity/paths (#822's shared current-site value type), threaded in
    /// alongside `sourceRoot` rather than replacing it — `sourceRoot` predates `CurrentSite`.
    /// #824's draft/commit-state migration (PR #846) landed a much larger restructuring of
    /// `ComponentEditorModel` itself, but left this context struct untouched, so this field
    /// stays deliberately additive groundwork rather than a replacement for any existing
    /// plumbing: `nil` in tests/previews that don't construct it (matching
    /// `onOpenFile`/`duplicateComponent` below).
    var site: CurrentSite? = nil
    /// Routes canvas-originated edits (e.g. a style tweak from the Styles
    /// panel) to the running site's MCP server. At the production call site
    /// (`SiteWindow`) this is always `model.preview.editRouter` — the same
    /// registered, chat-history-wired router the preview canvas uses — so
    /// edits made through either canvas behave identically. `nil` only for
    /// tests/previews that construct a context without write capability;
    /// `ComponentCanvasView` falls back to `LoggingEditRouter()` in that case.
    let editRouter: EditRouter?
    /// Opens a different file in the main pane — used to implement "double-click a sealed
    /// component instance to edit its own definition" (spec §4.1). `nil` in
    /// tests/previews that don't need navigation.
    var onOpenFile: ((FileRef) -> Void)? = nil
    /// Duplicates a project-relative `.astro` component path, returning the new file's path/name
    /// on success (design spec §6.3: "duplicate-and-modify"). `nil` in tests/previews that don't
    /// need it — `ComponentEditorModel.duplicateComponent(path:)` no-ops when this is `nil`.
    var duplicateComponent: ((String) async -> ContentCreateResult)? = nil
}

@MainActor
@Observable
final class ComponentEditorModel {
    let file: FileRef
    let context: ComponentEditorContext

    /// Distinguishes "dev server/MCP client isn't up yet" (retryable, not a
    /// real failure — `ComponentEditorView`'s `loadKey` re-triggers `load()`
    /// once `context.baseURL`/the client become available) from an
    /// unparseable component (design spec §5: degrade to the Source tab with
    /// the compiler diagnostic in a banner, never a dead end) from any other
    /// genuine load failure worth showing as a full-pane error.
    enum LoadErrorReason: Equatable {
        case notConnected
        case unparseable
        case other
    }

    private(set) var model: ComponentModel?
    private(set) var loadError: String?
    private(set) var loadErrorReason: LoadErrorReason?
    private(set) var isLoading = false
    var selectedNodeID: String?
    var computedStyles: [String: String] = [:]
    var knobValues: [String: String] = [:]
    /// Set when a write op is refused as stale (the source changed outside Anglesite since
    /// `model` was fetched) — drives the "changed outside Anglesite — Reload" banner (design
    /// doc §5). `load()` is triggered automatically to refetch; the flag stays set until the
    /// caller acknowledges it (e.g. the panel dismisses it once the refreshed model renders).
    var conflict = false
    /// Set when a style write op fails for a reason other than staleness (invalid CSS value, a
    /// `no-match` on a drifted `ruleSpan`, a transient MCP/transport error). This is intentionally
    /// distinct from `loadError`/`loadErrorReason`: those drive `ComponentEditorView`'s full-pane
    /// `ContentUnavailableView` takeover, which would destroy the three-pane editor (outline/canvas/
    /// inspector) over a routine, retryable write failure and leave the user with no way to retry.
    /// `writeError` instead drives a small dismissible banner scoped to the Styles panel; `model`
    /// and `loadError` are left untouched so the editor pane stays live.
    var writeError: String?
    /// Sibling project components for the palette — scanned once per `load()`, not per render.
    private(set) var projectComponents: [FileRef] = []

    // MARK: - Draft state (moved from ComponentEditorView — #824)
    //
    // The panes are pure renderers over this state: they read a draft's current text via the
    // `…Draft(for:)`/`…Draft(node:name:)` accessors below, write keystrokes back via the
    // matching `set…Draft` calls, and trigger a commit (on submit / blur / explicit Save) via
    // the `commit…`/`save…` methods, which themselves decide whether there's anything dirty to
    // send and build the `Task` that awaits the underlying write op. None of this needs a live
    // view to exist, so it's covered directly by `ComponentEditorModelDraftStateTests`.

    /// In-progress edits to a rule's selector, keyed by `Self.spanKey(rule.span)`, pending
    /// commit (on focus loss) to `setRuleSelector`.
    var selectorDrafts: [String: String] = [:]
    /// In-progress edits to a declaration's property name, keyed by `Self.spanKey(decl.span)`,
    /// pending commit to `setStyleProperty`.
    var propertyDrafts: [String: String] = [:]
    /// In-progress edits to a declaration's value, keyed by `Self.spanKey(decl.span)`.
    var valueDrafts: [String: String] = [:]
    /// In-progress edits to an attribute value, keyed by `Self.attrKey(nodeId:name:)`, pending
    /// commit (on submit) to `setAttr`.
    var attrValueDrafts: [String: String] = [:]
    /// Pending debounced commit from a `ColorPicker` drag, keyed by `Self.spanKey(decl.span)`.
    /// macOS `ColorPicker` updates its binding continuously while the system color panel is
    /// being dragged, so committing on every change would fire a burst of redundant
    /// `setStyleProperty` round-trips (and risk spurious `.failed`/stale-`baseVersion` conflicts).
    /// Each new picker value cancels the previous pending commit and restarts the delay, so only
    /// the settled value after the drag pauses actually commits.
    private var colorCommitTasks: [String: Task<Void, Never>] = [:]
    /// Editable draft of the component's Props interface (Props form), seeded from
    /// `model?.frontmatter?.props` whenever a fresh model loads (`reconcileDrafts`) and
    /// reconciled back via an explicit "Save Props" action (`savePropsDraft`) — the op replaces
    /// the whole interface atomically, so there's no per-field auto-commit the way the Styles
    /// panel's declaration rows have.
    var propsDraft: [PropDraft] = []
    /// Editable drafts for the two code panes, keyed by zone — dirty-tracked like
    /// `FileEditorModel` (design spec §5) and saved explicitly via `setScriptZone`, not on blur.
    var codeDrafts: [CodeZone: String] = [.frontmatter: "", .client: ""]

    /// One row in the Props form. `id` is a stable SwiftUI identity for `ForEach`/drafting —
    /// excluded from `==` (see the custom `Equatable` below) so draft-vs-model dirty checks
    /// compare content only, not incidental per-row identity.
    struct PropDraft: Identifiable, Equatable {
        let id = UUID()
        var name: String
        var type: String
        var optional: Bool
        var defaultValue: String

        init(name: String, type: String, optional: Bool, defaultValue: String) {
            self.name = name
            self.type = type
            self.optional = optional
            self.defaultValue = defaultValue
        }

        init(_ prop: ComponentModel.Prop) {
            self.init(name: prop.name, type: prop.type, optional: prop.optional, defaultValue: prop.defaultValue ?? "")
        }

        static func == (lhs: PropDraft, rhs: PropDraft) -> Bool {
            lhs.name == rhs.name && lhs.type == rhs.type && lhs.optional == rhs.optional && lhs.defaultValue == rhs.defaultValue
        }
    }

    /// The two code panes' zones (design spec §4.3): frontmatter TS ("Props & Data") and the
    /// client `<script>` ("Behavior"). Maps 1:1 to `EditMessage.Op.setScriptZone`'s wire values —
    /// `rawValue` is passed straight through to `setScriptZone(zone:source:)`. The in-pane code
    /// UI that once rendered these zones (`ComponentEditorCodePane`) was retired with the unified
    /// inspector (#714 slice 3); this drafts/dirty/save API stays as the seam for a future surface
    /// (Design/Source mode covers source editing today).
    enum CodeZone: String, CaseIterable, Hashable {
        case frontmatter, client
    }

    init(file: FileRef, context: ComponentEditorContext) {
        self.file = file
        self.context = context
    }

    /// Path of this component relative to the site's Source/ root.
    var relativePath: String { relativePath(for: file) }

    /// Project-relative path of `file` under `context.sourceRoot` — the general form of
    /// `relativePath` above (which is always `relativePath(for: self.file)`).
    private func relativePath(for file: FileRef) -> String {
        let root = context.sourceRoot.path(percentEncoded: false)
        let full = file.url.path(percentEncoded: false)
        guard full.hasPrefix(root) else { return file.name }
        return String(full.dropFirst(root.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    var outlineRows: [ComponentOutline.Row] {
        guard let model else { return [] }
        return ComponentOutline.rows(from: model.template)
    }

    var harnessURL: URL? {
        guard let base = context.baseURL else { return nil }
        return HarnessURL.build(base: base, componentPath: relativePath, props: knobValues)
    }

    var selectedNode: ComponentModel.Node? {
        guard let id = selectedNodeID else { return nil }
        return outlineRows.first(where: { $0.node.id == id })?.node
    }

    func load() async {
        guard let client = context.modelClient else {
            loadError = "Site is not running yet."
            loadErrorReason = .notConnected
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await client.fetch(path: relativePath)
            setModel(fetched)
            loadError = nil
            loadErrorReason = nil
            knobValues = Dictionary(
                uniqueKeysWithValues: (fetched.frontmatter?.props ?? []).map {
                    ($0.name, KnobDefaults.value(for: $0))
                }
            )
            projectComponents = SiteFileTree.scan(siteRoot: context.sourceRoot)[.components] ?? []
        } catch let error as ComponentModelClient.ModelError {
            loadError = error.friendlyMessage
            switch error {
            case .notConnected: loadErrorReason = .notConnected
            case .toolFailed(let reason, _): loadErrorReason = reason == "parse-failed" ? .unparseable : .other
            case .decodeFailed: loadErrorReason = .other
            }
        } catch {
            loadError = "Couldn't load this component: \(error.localizedDescription)"
            loadErrorReason = .other
        }
    }

    /// Every successful write/fetch replaces `model` through this single choke point instead of
    /// a bare `model = …` assignment, so the Props form / code pane drafts reconcile exactly
    /// once per genuine version change — matching the old view's
    /// `.onChange(of: model?.model?.version)` (fires on old-value != new-value, including a
    /// nil→non-nil first load), not on every reassignment. A version that comes back unchanged
    /// (e.g. a redundant `load()`) intentionally leaves in-progress drafts alone.
    private func setModel(_ newModel: ComponentModel?) {
        let previousVersion = model?.version
        model = newModel
        if newModel?.version != previousVersion {
            reconcileDrafts()
        }
    }

    /// Re-seeds `propsDraft`/`codeDrafts` from the freshly adopted `model`. Any in-progress,
    /// unsaved edits in either are intentionally discarded here — the same tradeoff a stale-write
    /// "Reload" already makes elsewhere in this editor (see design spec §5).
    private func reconcileDrafts() {
        propsDraft = (model?.frontmatter?.props ?? []).map(PropDraft.init)
        codeDrafts = [
            .frontmatter: model?.frontmatter?.source ?? "",
            .client: model?.clientScript?.source ?? "",
        ]
    }

    func canvasSelected(_ message: CanvasSelectionMessage) {
        guard let model,
              ComponentOutline.fileMatches(message.file, relativePath: relativePath),
              let line = message.line,
              let column = message.column
        else {
            selectedNodeID = nil
            return
        }
        selectedNodeID = ComponentOutline.node(atLine: line, column: column, in: model.template)?.id
    }

    /// Resolves `tag` (a component instance's tag name, e.g. "Badge") against `projectComponents`
    /// and asks the host to open it. No-op if the tag can't be resolved or navigation isn't wired.
    func openReferencedComponent(tag: String?) {
        guard let tag, let match = projectComponents.first(where: { $0.name == "\(tag).astro" }) else { return }
        context.onOpenFile?(match)
    }

    /// Duplicates `path` (a project-relative `.astro` path, e.g. from a palette item's
    /// `componentPath`) via `context.duplicateComponent` and, on success, refreshes
    /// `projectComponents` and opens the new file through `context.onOpenFile` — "duplicate-and-
    /// modify" (design spec §6.3). No-op (returns `nil`) if duplication isn't wired
    /// (`context.duplicateComponent == nil`, true in tests/previews without write capability).
    @discardableResult
    func duplicateComponent(path: String) async -> ContentCreateResult? {
        guard let duplicateComponent = context.duplicateComponent else { return nil }
        let result = await duplicateComponent(path)
        if case .created(let filePath, _) = result {
            projectComponents = SiteFileTree.scan(siteRoot: context.sourceRoot)[.components] ?? []
            if let match = projectComponents.first(where: { relativePath(for: $0) == filePath }) {
                context.onOpenFile?(match)
            }
        }
        return result
    }

    // MARK: - Style writes

    /// Set (or add) a CSS declaration's value within a `<style>` rule identified by `ruleSpan`.
    /// Returns whether the write actually applied — see `applyComponentStyleEdit`.
    @discardableResult
    func setStyleProperty(ruleSpan: [Int?], property: String, value: String) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStyleEditBuilder.setStyleProperty(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                ruleSpan: ruleSpan,
                property: property,
                value: value
            )
        )
    }

    /// Remove a CSS declaration from a rule identified by `ruleSpan`.
    /// Returns whether the write actually applied — see `applyComponentStyleEdit`.
    @discardableResult
    func removeStyleProperty(ruleSpan: [Int?], property: String) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStyleEditBuilder.removeStyleProperty(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                ruleSpan: ruleSpan,
                property: property
            )
        )
    }

    /// Rewrite a rule's selector.
    /// Returns whether the write actually applied — see `applyComponentStyleEdit`.
    @discardableResult
    func setRuleSelector(ruleSpan: [Int?], newSelector: String) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStyleEditBuilder.setRuleSelector(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                ruleSpan: ruleSpan,
                newSelector: newSelector
            )
        )
    }

    /// Add a new CSS rule to the component's `<style>` block.
    /// Returns whether the write actually applied — see `applyComponentStyleEdit`.
    @discardableResult
    func addStyleRule(selector: String, media: String?, declarations: [(property: String, value: String)]) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStyleEditBuilder.addStyleRule(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                selector: selector,
                media: media,
                declarations: declarations
            )
        )
    }

    /// The span of a style rule at `index` in the current `model`, or `nil` if the model isn't
    /// loaded or `index` is out of range. Used to re-derive a rule's span after a prior write in
    /// the same gesture may have shifted byte offsets within the file (see `ComponentEditorView
    /// .commitDeclaration`'s rename path, which removes then re-adds a declaration on the same
    /// rule — the remove shifts the rule's own end offset, so the follow-up add must target the
    /// freshly reloaded span, not the one captured before either write).
    func ruleSpan(atIndex index: Int) -> ComponentModel.Span? {
        guard let styles = model?.styles, styles.indices.contains(index) else { return nil }
        return styles[index].span
    }

    // MARK: - Styles panel drafts & commits (moved from ComponentEditorView — #824)

    /// `ComponentModel.Span` isn't `CustomStringConvertible`, so build a stable dictionary key
    /// from its optional start/end offsets directly.
    static func spanKey(_ span: ComponentModel.Span) -> String {
        "\(span.start ?? -1)-\(span.end ?? -1)"
    }

    private func spanArray(_ span: ComponentModel.Span) -> [Int?] {
        [span.start, span.end]
    }

    /// Current selector text for `rule` — the in-progress draft if there is one, otherwise the
    /// model's own value.
    func selectorDraft(for rule: ComponentModel.StyleRule) -> String {
        selectorDrafts[Self.spanKey(rule.span)] ?? rule.selector
    }

    func setSelectorDraft(_ text: String, for rule: ComponentModel.StyleRule) {
        selectorDrafts[Self.spanKey(rule.span)] = text
    }

    /// Commits `selectorDrafts` for `rule` via `setRuleSelector` if it actually differs from the
    /// model's current selector — called on the selector field's `onSubmit`.
    func commitSelector(rule: ComponentModel.StyleRule) {
        let key = Self.spanKey(rule.span)
        let newSelector = selectorDrafts[key] ?? rule.selector
        guard newSelector != rule.selector else { return }
        Task { await setRuleSelector(ruleSpan: spanArray(rule.span), newSelector: newSelector) }
    }

    func propertyDraft(for decl: ComponentModel.Declaration) -> String {
        propertyDrafts[Self.spanKey(decl.span)] ?? decl.property
    }

    func setPropertyDraft(_ text: String, for decl: ComponentModel.Declaration) {
        propertyDrafts[Self.spanKey(decl.span)] = text
    }

    func valueDraft(for decl: ComponentModel.Declaration) -> String {
        valueDrafts[Self.spanKey(decl.span)] ?? decl.value
    }

    func setValueDraft(_ text: String, for decl: ComponentModel.Declaration) {
        valueDrafts[Self.spanKey(decl.span)] = text
    }

    /// Commits both the property-name and value drafts for a declaration. Called from either
    /// field's `onSubmit` so an edit to just the property name (value unchanged) still lands,
    /// not only edits to the value field.
    ///
    /// A property rename is a remove-then-add sequence against the *same* rule: removing the
    /// old declaration shifts byte offsets within the file (including, in general, the rule's
    /// own end offset), so the second write must target the rule's freshly reloaded span, not
    /// the one captured before either op ran — reusing the stale span would make the add
    /// mismatch or fail outright on essentially every rename. `ruleIndex` (the rule's stable
    /// ordinal position — these two ops never add/remove/reorder rules) is used to re-derive the
    /// fresh span from `model` after the remove completes. If the remove itself failed, the
    /// rename is abandoned rather than adding the new name anyway, which would otherwise leave
    /// both the old and new declarations present.
    func commitDeclaration(ruleIndex: Int, rule: ComponentModel.StyleRule, decl: ComponentModel.Declaration) async {
        let key = Self.spanKey(decl.span)
        let property = propertyDrafts[key] ?? decl.property
        let value = valueDrafts[key] ?? decl.value
        guard property != decl.property || value != decl.value else { return }
        let ruleSpan = spanArray(rule.span)
        let oldProperty = decl.property
        if property != oldProperty {
            let removed = await removeStyleProperty(ruleSpan: ruleSpan, property: oldProperty)
            guard removed else { return }
            let freshSpan = self.ruleSpan(atIndex: ruleIndex).map(spanArray) ?? ruleSpan
            await setStyleProperty(ruleSpan: freshSpan, property: property, value: value)
        } else {
            await setStyleProperty(ruleSpan: ruleSpan, property: property, value: value)
        }
    }

    /// Cancels any pending debounced `ColorPicker` commit and discards the in-progress drafts
    /// for `decl` before removing it. Without this, a declaration removed mid-drag (before the
    /// `debounceColorCommit` delay elapses) would have its pending commit fire afterward and
    /// resurrect the just-deleted declaration via `setStyleProperty`.
    func removeDeclaration(rule: ComponentModel.StyleRule, decl: ComponentModel.Declaration) {
        let key = Self.spanKey(decl.span)
        colorCommitTasks[key]?.cancel()
        colorCommitTasks[key] = nil
        valueDrafts[key] = nil
        propertyDrafts[key] = nil
        Task { await removeStyleProperty(ruleSpan: spanArray(rule.span), property: decl.property) }
    }

    /// Debounces `ColorPicker` writes: cancels any pending commit for this declaration and
    /// schedules a new one after a short pause, so only the settled value after a drag gesture
    /// actually calls `commitDeclaration` (see `colorCommitTasks`'s doc comment). `onSettled` lets
    /// the canvas pane clear its temporary scrub overlay once the real commit lands — the only
    /// piece of this that still needs the live `WKWebView`, so it stays a view-supplied callback
    /// rather than something this (webview-less) model can do itself.
    func debounceColorCommit(
        ruleIndex: Int,
        rule: ComponentModel.StyleRule,
        decl: ComponentModel.Declaration,
        onSettled: @escaping () -> Void = {}
    ) {
        let key = Self.spanKey(decl.span)
        colorCommitTasks[key]?.cancel()
        colorCommitTasks[key] = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await commitDeclaration(ruleIndex: ruleIndex, rule: rule, decl: decl)
            onSettled()
            colorCommitTasks[key] = nil
        }
    }

    // MARK: - Structure writes

    /// Insert a new node as the child at `index` under `parentId` (the fragment root's id for
    /// a top-level insert). Returns whether the write actually applied.
    @discardableResult
    func insertNode(parentId: String, index: Int, node: ComponentStructureEditBuilder.NodeSpec) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStructureEditBuilder.insertNode(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                parentId: parentId,
                index: index,
                node: node
            )
        )
    }

    /// Reorder/reparent an existing node. Returns whether the write actually applied.
    @discardableResult
    func moveNode(nodeId: String, newParentId: String, newIndex: Int) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStructureEditBuilder.moveNode(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                nodeId: nodeId,
                newParentId: newParentId,
                newIndex: newIndex
            )
        )
    }

    /// Delete a node (the plugin prunes any now-unused component imports). Returns whether the
    /// write actually applied.
    @discardableResult
    func removeNode(nodeId: String) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStructureEditBuilder.removeNode(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                nodeId: nodeId
            )
        )
    }

    /// Set (`value` non-nil) or remove (`value == nil`) an attribute/prop at the use-site.
    /// Returns whether the write actually applied.
    @discardableResult
    func setAttr(nodeId: String, name: String, value: String?) async -> Bool {
        await applyComponentStyleEdit(
            ComponentStructureEditBuilder.setAttr(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                nodeId: nodeId,
                name: name,
                value: value
            )
        )
    }

    // MARK: - Attribute drafts & commits (moved from ComponentEditorView — #824)

    private static func attrKey(nodeID: String, name: String) -> String { "\(nodeID):\(name)" }

    func attrValueDraft(node: ComponentModel.Node, name: String) -> String {
        let key = Self.attrKey(nodeID: node.id, name: name)
        let current = node.attrs.first(where: { $0.name == name })?.value ?? ""
        return attrValueDrafts[key] ?? current
    }

    func setAttrValueDraft(_ text: String, node: ComponentModel.Node, name: String) {
        attrValueDrafts[Self.attrKey(nodeID: node.id, name: name)] = text
    }

    func commitAttr(node: ComponentModel.Node, name: String) {
        let key = Self.attrKey(nodeID: node.id, name: name)
        guard let draft = attrValueDrafts[key] else { return }
        let current = node.attrs.first(where: { $0.name == name })?.value ?? ""
        guard draft != current else { return }
        Task { await setAttr(nodeId: node.id, name: name, value: draft) }
    }

    /// Discards any in-progress draft for `name` before removing the attribute. Without this, a
    /// stale draft (typed but never submitted) would linger in `attrValueDrafts` and resurface if
    /// the same attribute name is later re-added via "Add attribute" — `attrValueDraft`'s getter
    /// would render the discarded draft instead of the freshly-committed value, and committing it
    /// would silently overwrite the new value. Mirrors `removeDeclaration`'s draft-clearing.
    func removeAttr(node: ComponentModel.Node, name: String) {
        attrValueDrafts[Self.attrKey(nodeID: node.id, name: name)] = nil
        Task { await setAttr(nodeId: node.id, name: name, value: nil) }
    }

    // MARK: - Outline & canvas drag/drop (moved from ComponentEditorView — #824)
    //
    // `dropZone`/the parent+sibling-index lookups are pure geometry/tree queries over
    // `ComponentOutline` (Core, already unit-tested there); what moved here is the *decision*
    // logic that turns a drop location into an `insertNode`/`moveNode` call. The canvas JS
    // bridging itself (evaluating `window.anglesiteCanvas?.dropTargetAt?.(...)` against the live
    // `WKWebView` and decoding its JSON reply) stays in `ComponentEditorCanvasPane` — this model
    // has no webview handle — but everything downstream of that decode (resolving the drop
    // target to a node id, the sealed-instance zone redirect, dispatching the op) lives here so
    // it's testable without a live canvas.

    /// Top third of the row = insert before (same parent as the target); bottom third = insert
    /// after (same parent); middle third = reparent as the target's last child. A sealed row's
    /// middle third is redirected to `.after` — the outline hides a sealed component instance's
    /// slot-fill children (spec §4.1), so an `.into` drop there would silently vanish (it lands as
    /// markup with nowhere to render).
    func dropZone(at location: CGPoint, for row: ComponentOutline.Row) -> ComponentOutline.DropZone {
        let zone = ComponentOutline.dropZone(y: Double(location.y))
        if row.isSealed && zone == .into { return .after }
        return zone
    }

    /// Finds `nodeID`'s parent id by walking `model?.template` — the outline's flat `Row` list
    /// doesn't carry parent links (per `ComponentOutline.Row`'s shape).
    private func parentID(of nodeID: String) -> String? {
        guard let root = model?.template else { return nil }
        return ComponentOutline.parentID(of: nodeID, in: root)
    }

    private func childIndex(of nodeID: String, underParent parentID: String) -> Int? {
        guard let root = model?.template else { return nil }
        return ComponentOutline.childIndex(of: nodeID, underParent: parentID, in: root)
    }

    /// Handles an outline-row reorder/reparent drop (dragging one outline row onto another).
    /// The caller (`ComponentEditorOutlinePane`) has already checked the drag payload is for
    /// this file and isn't a self-drop before calling this.
    func performMove(draggedNodeID: String, targetRow: ComponentOutline.Row, location: CGPoint) async {
        guard let dragged = outlineRows.first(where: { $0.node.id == draggedNodeID }) else { return }
        // Refuse a reparent that would create a structural cycle — dragging a node onto (or
        // before/after within) its own subtree.
        guard let root = model?.template, !ComponentOutline.isNodeOrDescendant(targetRow.node.id, of: dragged.node.id, in: root) else { return }
        switch dropZone(at: location, for: targetRow) {
        case .into:
            await moveNode(nodeId: dragged.node.id, newParentId: targetRow.node.id, newIndex: targetRow.node.children.count)
        case .before, .after:
            guard let parentID = parentID(of: targetRow.node.id), let siblingIndex = childIndex(of: targetRow.node.id, underParent: parentID) else { return }
            let zone = dropZone(at: location, for: targetRow)
            let targetIndex = zone == .before ? siblingIndex : siblingIndex + 1
            let draggedIndex = childIndex(of: dragged.node.id, underParent: parentID)
            let newIndex = ComponentOutline.adjustedMoveIndex(targetIndex: targetIndex, draggedIndex: draggedIndex)
            await moveNode(nodeId: dragged.node.id, newParentId: parentID, newIndex: newIndex)
        }
    }

    /// Handles a palette-item drop onto an outline row (insert as sibling or child).
    func performInsert(payload: ComponentStructureEditBuilder.NodeSpec, targetRow: ComponentOutline.Row, location: CGPoint) async {
        switch dropZone(at: location, for: targetRow) {
        case .into:
            await insertNode(parentId: targetRow.node.id, index: targetRow.node.children.count, node: payload)
        case .before, .after:
            guard let parentID = parentID(of: targetRow.node.id), let siblingIndex = childIndex(of: targetRow.node.id, underParent: parentID) else { return }
            let zone = dropZone(at: location, for: targetRow)
            let index = zone == .before ? siblingIndex : siblingIndex + 1
            await insertNode(parentId: parentID, index: index, node: payload)
        }
    }

    /// Resolves a canvas drop point (already mapped by the overlay to a source line/column, the
    /// same way `canvasSelected` maps a click) to an insertion target, redirects a sealed
    /// instance's `"into"` zone to `"after"` (same reasoning as `dropZone(at:for:)` — the outline
    /// path's geometry-level redirect doesn't apply here since the canvas overlay's own zone
    /// classification has no notion of sealed instances), and issues the `insertNode` op.
    func performCanvasDrop(atLine line: Int, column: Int, zone: String, payload: ComponentStructureEditBuilder.NodeSpec) async {
        guard let root = model?.template, let node = ComponentOutline.node(atLine: line, column: column, in: root) else { return }
        let effectiveZone = (node.kind == .component && zone == "into") ? "after" : zone
        switch effectiveZone {
        case "into":
            await insertNode(parentId: node.id, index: node.children.count, node: payload)
        case "before", "after":
            guard let parentID = parentID(of: node.id), let siblingIndex = childIndex(of: node.id, underParent: parentID) else { return }
            let index = effectiveZone == "before" ? siblingIndex : siblingIndex + 1
            await insertNode(parentId: parentID, index: index, node: payload)
        default:
            break
        }
    }

    // MARK: - Props & code writes

    /// Codegen/replace the `Props` interface + `Astro.props` destructure from a structured props
    /// array (the Props form). An empty array removes both. `applyComponentStyleEdit`'s
    /// piggybacked-model path adopts the fresh model but doesn't otherwise know to touch
    /// `knobValues` (it's op-agnostic), so this op resyncs the knobs bar itself on success:
    /// existing knob values survive for props that still exist (by name), renamed/removed props
    /// drop out, and newly added props get their type-based default. Returns whether the write
    /// applied.
    @discardableResult
    func setPropsInterface(props: [ComponentModel.Prop]) async -> Bool {
        let applied = await applyComponentStyleEdit(
            ComponentCodeEditBuilder.setPropsInterface(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                props: props
            )
        )
        if applied { syncKnobValues() }
        return applied
    }

    /// Rebuilds `knobValues` against the current `model`'s props, keyed by name — see
    /// `setPropsInterface`'s doc comment for why this is needed after that op specifically.
    private func syncKnobValues() {
        let props = model?.frontmatter?.props ?? []
        var next: [String: String] = [:]
        for prop in props {
            next[prop.name] = knobValues[prop.name] ?? KnobDefaults.value(for: prop)
        }
        knobValues = next
    }

    /// Replace a whole script zone (`"frontmatter"` or `"client"`) wholesale — a code-pane save.
    /// Returns whether the write actually applied.
    @discardableResult
    func setScriptZone(zone: String, source: String) async -> Bool {
        await applyComponentStyleEdit(
            ComponentCodeEditBuilder.setScriptZone(
                id: UUID().uuidString,
                path: relativePath,
                baseVersion: model?.version ?? "",
                zone: zone,
                source: source
            )
        )
    }

    // MARK: - Props form & code pane drafts (moved from ComponentEditorView — #824)

    /// True when `propsDraft` differs from the current model's props — gates "Save Props" so it
    /// only enables once there's something to save (and disables again once the piggybacked
    /// model from a successful save re-seeds the draft via `reconcileDrafts`).
    var propsDraftDirty: Bool {
        propsDraft != (model?.frontmatter?.props ?? []).map(PropDraft.init)
    }

    /// Commits `propsDraft` via `setPropsInterface`, dropping any row with a blank name or type
    /// (an in-progress "Add Prop" row the user hasn't filled in yet) rather than sending it as a
    /// malformed prop the plugin would refuse outright. Returns whether the write applied.
    @discardableResult
    func savePropsDraft() async -> Bool {
        let props = propsDraft.compactMap { draft -> ComponentModel.Prop? in
            let name = draft.name.trimmingCharacters(in: .whitespaces)
            let type = draft.type.trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty, !type.isEmpty else { return nil }
            let defaultValue = draft.defaultValue.trimmingCharacters(in: .whitespaces)
            return ComponentModel.Prop(name: name, type: type, optional: draft.optional, defaultValue: defaultValue.isEmpty ? nil : defaultValue)
        }
        return await setPropsInterface(props: props)
    }

    private func currentZoneSource(_ zone: CodeZone) -> String {
        switch zone {
        case .frontmatter: model?.frontmatter?.source ?? ""
        case .client: model?.clientScript?.source ?? ""
        }
    }

    func codeDraftDirty(zone: CodeZone) -> Bool {
        (codeDrafts[zone] ?? "") != currentZoneSource(zone)
    }

    /// Saves the given zone's draft via `setScriptZone`. Returns whether the write applied.
    @discardableResult
    func saveCodeDraft(zone: CodeZone) async -> Bool {
        await setScriptZone(zone: zone.rawValue, source: codeDrafts[zone] ?? "")
    }

    /// Routes a built `EditMessage` to `context.editRouter` and reconciles the result. Shared by
    /// the style writes, the structure writes (`insertNode`/`moveNode`/`removeNode`/`setAttr`),
    /// and the props/code writes above (`setPropsInterface`/`setScriptZone`) — the name is a
    /// slice-2 holdover, but the reconciliation logic is op-agnostic:
    /// - `.applied` with a piggybacked `reply.model` adopts it directly (no second fetch).
    /// - `.applied` without one falls back to `load()`.
    /// - `.failed` with reason `"stale"` (the plugin's machine-readable refusal code — see
    ///   `EditReply.reason`) triggers a `load()` refetch and flips `conflict` so the UI can
    ///   surface a "changed outside Anglesite — Reload" banner.
    /// - Any other `.failed` (or `.ambiguous`/`.preview`, which these ops never return) is a
    ///   routine, recoverable write failure — surfaced via `writeError`, NOT `loadError`/
    ///   `loadErrorReason` (see `writeError`'s doc comment for why).
    ///
    /// Returns whether the op actually applied — callers that must sequence a follow-up op
    /// against a rule this call may have mutated (e.g. a property rename's remove-then-add)
    /// use this to avoid compounding a failure and to know a fresh `model` is available.
    @discardableResult
    private func applyComponentStyleEdit(_ message: EditMessage) async -> Bool {
        guard let editRouter = context.editRouter else { return false }
        let reply = await editRouter.apply(message)
        switch reply.status {
        case .applied:
            conflict = false
            writeError = nil
            if let freshModel = reply.model {
                setModel(freshModel)
            } else {
                await load()
            }
            return true
        case .failed where reply.reason == "stale":
            conflict = true
            await load()
            return false
        default:
            writeError = reply.message ?? "The edit couldn't be applied."
            return false
        }
    }

    // MARK: - Extract into component

    /// Extract the subtree rooted at `nodeId` into a brand-new `.astro` component. `newName` is a
    /// bare PascalCase identifier — the plugin derives the full `src/components/<newName>.astro`
    /// path itself. The plugin applies this as one atomic two-file edit; the reconciliation here
    /// mirrors the other structure writes (`applyComponentStyleEdit`) — adopt a piggybacked fresh
    /// `model` for the original file or reload; a `stale` refusal flips `conflict` and reloads.
    /// Because this op creates a brand-new component file, the piggybacked-model fast path also
    /// rescans `projectComponents` so the palette immediately reflects the new component (the
    /// `load()` fallback already does this). The `newName` client-side validation lives in
    /// `ExtractComponentSheet`; the plugin's own `invalid-input`/`already-exists`/`dynamic-expression`
    /// refusals still surface here via `writeError` (they flow through the generic failure branch,
    /// like every other op's non-`stale` refusal). Returns whether the extraction applied.
    @discardableResult
    func extractComponent(nodeId: String, newName: String) async -> Bool {
        guard let editRouter = context.editRouter else { return false }
        let message = ComponentStructureEditBuilder.extractComponent(
            id: UUID().uuidString,
            path: relativePath,
            baseVersion: model?.version ?? "",
            nodeId: nodeId,
            newName: newName
        )
        let reply = await editRouter.apply(message)
        switch reply.status {
        case .applied:
            conflict = false
            writeError = nil
            if let freshModel = reply.model {
                setModel(freshModel)
                projectComponents = SiteFileTree.scan(siteRoot: context.sourceRoot)[.components] ?? []
            } else {
                await load()
            }
            return true
        case .failed where reply.reason == "stale":
            conflict = true
            await load()
            return false
        default:
            writeError = reply.message ?? "The component couldn't be extracted."
            return false
        }
    }

    /// Whether the outline `row` can be extracted into its own component. Delegates to
    /// `ComponentOutline.isExtractable(_:)` (Core), which hosts the actual gating logic so it's
    /// unit-testable on CI (app-target Swift tests don't run there).
    func canExtractComponent(_ row: ComponentOutline.Row) -> Bool {
        ComponentOutline.isExtractable(row.node)
    }
}
