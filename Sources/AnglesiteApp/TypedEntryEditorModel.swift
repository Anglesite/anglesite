// Sources/AnglesiteApp/TypedEntryEditorModel.swift
import Foundation
import SwiftUI
import Observation
import AnglesiteCore

/// Editor state for one open *typed* content file. Parallels `FileEditorModel` but exposes the
/// file as per-field `TypedContentEditor.Values` (bound by `TypedEntryEditorView`) and commits each
/// save to git. The raw loaded `contents` is retained so writes go through
/// `TypedContentEditor.write`, which preserves untouched keys, unknown keys, and the body verbatim.
/// All disk IO runs off the main actor.
@MainActor
@Observable
final class TypedEntryEditorModel: InspectorEditorModel {
    let file: FileRef
    let descriptor: ContentTypeDescriptor
    let route: String
    /// Command/find seam for the body field's markdown editor.
    let markdownController = MarkdownEditorController()
    private let sourceDirectory: URL
    private let gitCommit: NativeContentOperations.GitCommit

    var values: TypedContentEditor.Values = .init()
    private var savedValues: TypedContentEditor.Values = .init()
    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false
    private var fileSession = EditableFileSession()
    private var contents: String { fileSession.savedContents } // last-loaded/saved file text (verbatim base)
    private var numberDrafts: [String: String] = [:]
    /// Guards against a concurrent second `save()` capturing a stale `contents` base while an
    /// earlier save is still in flight (e.g. ⌘S mash, or a teardown flush racing a save). `private(set)`
    /// so `SiteWindowModel.editCommandInFlight` can read it (PR #532 review).
    private(set) var isSaving = false
    private(set) var loadError: String?
    private(set) var isLoading = false
    var conflictDiskContents: String? {
        get { fileSession.conflictDiskContents }
        set { fileSession.conflictDiskContents = newValue }
    }

    var isDirty: Bool {
        (values != savedValues || noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled)
            && loadError == nil && !isLoading
    }

    init(file: FileRef,
         descriptor: ContentTypeDescriptor,
         route: String,
         sourceDirectory: URL,
         gitCommit: @escaping NativeContentOperations.GitCommit = NativeContentOperations.processGitCommit) {
        self.file = file
        self.descriptor = descriptor
        self.route = route
        self.sourceDirectory = sourceDirectory
        self.gitCommit = gitCommit
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        let url = file.url
        do {
            var session = fileSession
            let loaded = try await session.load(from: url)
            fileSession = session
            adopt(loaded)
            loadError = nil
            warnIfNoModificationDate(after: "load")
        } catch {
            loadError = error.localizedDescription
        }
        let flags = RobotsConfigFile.flags(for: robotsSource, under: sourceDirectory)
        noindexEnabled = flags.noindex
        savedNoindexEnabled = flags.noindex
        disallowCrawlEnabled = flags.disallowCrawl
        savedDisallowCrawlEnabled = flags.disallowCrawl
    }

    @discardableResult
    func save() async -> Bool {
        guard isDirty, !isSaving else { return true }
        isSaving = true
        defer { isSaving = false }
        let descriptor = self.descriptor
        let base = contents
        let edited = values
        let newContents = TypedContentEditor.write(edited, into: base, descriptor: descriptor)
        let url = file.url
        do {
            var session = fileSession
            try await session.save(newContents, to: url)
            fileSession = session
            savedValues = edited
            warnIfNoModificationDate(after: "save")
            try RobotsConfigFile.apply(
                source: robotsSource, noindex: noindexEnabled, disallowCrawl: disallowCrawlEnabled,
                path: route, under: sourceDirectory
            )
            savedNoindexEnabled = noindexEnabled
            savedDisallowCrawlEnabled = disallowCrawlEnabled
            await commit()
            return true
        } catch {
            loadError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    func flushBeforeLeaving() async -> Bool {
        guard isDirty else { return true }
        var session = fileSession
        let canFlush = await session.canFlushBeforeLeaving(file: file.url, bufferIsDirty: true)
        fileSession = session
        guard canFlush else { return false }
        return await save()
    }

    func checkExternalChange() async {
        guard loadError == nil else { return }
        let dirty = isDirty
        var session = fileSession
        let change = await session.externalChange(at: file.url, bufferIsDirty: dirty)
        fileSession = session
        guard let change else { return }
        switch change {
        case .none:
            break
        case .reloadable(let disk):
            adopt(disk)
        case .conflict(let disk):
            conflictDiskContents = disk
        }
    }

    func keepMyChanges() { fileSession.keepMyChanges() }

    func reloadFromDisk() async {
        var session = fileSession
        guard let disk = await session.reloadFromConflict(file: file.url) else {
            fileSession = session
            return
        }
        fileSession = session
        adopt(disk)
    }

    // MARK: Bindings used by the view

    // Binding closures capture `self` weakly: SwiftUI holds a binding for the view's lifetime, and
    // the model is replaced per selection — `[weak self]` avoids keeping a stale model alive and
    // keeps the closures safe under Swift 6's non-isolated-closure checking.
    func textBinding(_ name: String) -> Binding<String> {
        Binding(get: { [weak self] in if case .text(let s)? = self?.values[name] { return s }; return "" },
                set: { [weak self] in self?.values[name] = .text($0) })
    }
    func boolBinding(_ name: String) -> Binding<Bool> {
        Binding(get: { [weak self] in if case .flag(let b)? = self?.values[name] { return b }; return false },
                set: { [weak self] in self?.values[name] = .flag($0) })
    }
    func dateBinding(_ name: String) -> Binding<Date> {
        Binding(get: { [weak self] in if case .date(let d?)? = self?.values[name] { return d }; return Date(timeIntervalSince1970: 0) },
                set: { [weak self] in self?.values[name] = .date($0) })
    }
    func numberBinding(_ name: String) -> Binding<String> {
        Binding(
            get: { [weak self] in
                guard let self else { return "" }
                if let draft = self.numberDrafts[name] { return draft }
                if case .number(let n?)? = self.values[name] { return Self.displayNumber(n) }
                return ""
            },
            set: { [weak self] raw in
                guard let self else { return }
                self.numberDrafts[name] = raw
                let trimmed = raw.trimmingCharacters(in: .whitespaces)
                // Only overwrite the stored value when the draft parses (or is cleared). A mid-edit
                // unparseable draft like "3." must not clobber a previously valid number with nil.
                if trimmed.isEmpty {
                    self.values[name] = .number(nil)
                } else if let parsed = Double(trimmed) {
                    self.values[name] = .number(parsed)
                }
            }
        )
    }
    func listBinding(_ name: String) -> Binding<[String]> {
        Binding(get: { [weak self] in if case .list(let a)? = self?.values[name] { return a }; return [] },
                set: { [weak self] in self?.values[name] = .list($0) })
    }
    func recordsBinding(_ name: String) -> Binding<[[String: TypedContentEditor.FieldValue]]> {
        Binding(get: { [weak self] in if case .records(let r)? = self?.values[name] { return r }; return [] },
                set: { [weak self] in self?.values[name] = .records($0) })
    }
    func noindexBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.noindexEnabled ?? false },
                set: { [weak self] in self?.noindexEnabled = $0 })
    }
    func disallowCrawlBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.disallowCrawlEnabled ?? false },
                set: { [weak self] in self?.disallowCrawlEnabled = $0 })
    }

    private var robotsSource: RobotsConfigSource {
        let slug = file.url.deletingPathExtension().lastPathComponent
        if let collection = descriptor.collection {
            return .collection(collection, id: slug)
        }
        return .page(file: relativePath(of: file.url, under: sourceDirectory))
    }

    // MARK: Private

    private func adopt(_ text: String) {
        let read = TypedContentEditor.read(text, descriptor: descriptor)
        values = read
        savedValues = read
        numberDrafts.removeAll()
    }

    /// Formats a number for the editor field: integral values render without a decimal point,
    /// guarding the `Int(_:)` overflow trap for out-of-range magnitudes.
    private static func displayNumber(_ n: Double) -> String {
        if n == n.rounded(), abs(n) < 1e15 { return String(Int(n)) }
        return String(n)
    }

    /// Surface (in the debug pane) when a file has no modification date after a successful load/save:
    /// `FileDocumentIO.externalChange` keys on mtime, so a `nil` here silently disables external-change
    /// detection for this file. "Logs are sacred" — make it visible rather than failing quietly.
    private func warnIfNoModificationDate(after op: String) {
        guard fileSession.lastModified == nil else { return }
        let path = file.url.path(percentEncoded: false)
        Task {
            await LogCenter.shared.append(
                source: "editor", stream: .stderr,
                text: EditableFileSession.missingModificationDateWarning(after: op, path: path)
            )
        }
    }

    private func commit() async {
        let rel = relativePath(of: file.url, under: sourceDirectory)
        let slug = file.url.deletingPathExtension().lastPathComponent
        _ = await gitCommit(sourceDirectory, rel, "anglesite: edit \(descriptor.id) \(slug)")
    }

    private func relativePath(of url: URL, under root: URL) -> String {
        let u = url.standardizedFileURL.path(percentEncoded: false)
        let r = root.standardizedFileURL.path(percentEncoded: false)
        if u.hasPrefix(r) { return String(u.dropFirst(r.count)).drop(while: { $0 == "/" }).description }
        return url.lastPathComponent
    }

}
