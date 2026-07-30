// Sources/AnglesiteApp/InspectorContext.swift
import Foundation
import AnglesiteCore

/// Shared surface the inspector chrome (load/save/conflict) and File ▸ Save (SaveCommands) drive,
/// so one chrome wraps both the typed descriptor form and the plain page metadata form.
@MainActor
protocol InspectorEditorModel: AnyObject {
    var file: FileRef { get }
    var isDirty: Bool { get }
    /// True while a save's off-main write is in flight — File ▸ Save / Revert disable during it
    /// rather than racing the write with a concurrent `load()` (PR #532 review).
    var isSaving: Bool { get }
    var loadError: String? { get }
    var isLoading: Bool { get }
    var conflictDiskContents: String? { get set }
    func load() async
    @discardableResult func save() async -> Bool
    func flushBeforeLeaving() async -> Bool
    func checkExternalChange() async
    func keepMyChanges()
    func reloadFromDisk() async
}

/// What the right-hand inspector is editing for the current selection.
@MainActor
enum InspectorContext: Identifiable {
    case typed(TypedEntryEditorModel)
    case page(PageMetadataModel)
    /// A routed page/entry with no typed descriptor or frontmatter form — e.g. a plain `.astro`
    /// page. Read-only identity only; see `GenericPageInspectorModel` (#1100).
    case generic(GenericPageInspectorModel)

    var model: any InspectorEditorModel {
        switch self {
        case .typed(let m): m
        case .page(let m): m
        case .generic(let m): m
        }
    }
    var id: String { model.file.id }
}
