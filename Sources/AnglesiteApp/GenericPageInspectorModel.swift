// Sources/AnglesiteApp/GenericPageInspectorModel.swift
import Foundation
import Observation
import AnglesiteCore

/// Read-only inspector fallback for a selected page/entry that isn't a registered content type
/// (`ContentTypeResolver`) or a plain frontmatter page (`.md`/`.mdx`/`.markdown`) — most commonly
/// a hand-authored `.astro` page. There's no safe generic way to parse and rewrite an Astro
/// component's script frontmatter (it's JS, not YAML), so this path never edits; it exists so
/// `View ▸ Inspector ▸ Show Inspector` (#1100) is available for every routed page instead of only
/// the two typed/markdown cases, showing the same identity info Finder or the navigator already
/// shows rather than leaving the panel permanently disabled.
@MainActor
@Observable
final class GenericPageInspectorModel: InspectorEditorModel {
    let file: FileRef
    let route: String

    let isDirty = false
    let isSaving = false
    let loadError: String? = nil
    let isLoading = false
    var conflictDiskContents: String? {
        get { nil }
        set { }
    }

    init(file: FileRef, route: String) {
        self.file = file
        self.route = route
    }

    func load() async {}
    @discardableResult func save() async -> Bool { true }
    func flushBeforeLeaving() async -> Bool { true }
    func checkExternalChange() async {}
    func keepMyChanges() {}
    func reloadFromDisk() async {}
}
