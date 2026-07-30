// Sources/AnglesiteApp/PageMetadataModel.swift
import Foundation
import SwiftUI
import Observation
import AnglesiteCore

/// Editor state for a plain (non-typed) page's title + description, plus the two shared
/// search/crawling toggles (#1093 — backed by `RobotsConfigFile`, not this page's own frontmatter).
/// Parallels `TypedEntryEditorModel`: loads/saves through `FileDocumentIO`, writes via
/// `PageMetadataEditor` (round-trip-safe), and commits each save. All disk IO runs off the main actor.
@MainActor
@Observable
final class PageMetadataModel: InspectorEditorModel {
    let file: FileRef
    let route: String
    private let sourceDirectory: URL
    private let gitCommit: NativeContentOperations.GitCommit

    var metadata = PageMetadata(title: "", description: "")
    private var savedMetadata = PageMetadata(title: "", description: "")
    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false
    private var fileSession = EditableFileSession()
    private var contents: String { fileSession.savedContents }
    /// Guards against a concurrent second `save()` capturing a stale `contents` base. `private(set)`
    /// so `SiteWindowModel.editCommandInFlight` can read it (PR #532 review).
    private(set) var isSaving = false
    private(set) var loadError: String?
    private(set) var isLoading = false
    var conflictDiskContents: String? {
        get { fileSession.conflictDiskContents }
        set { fileSession.conflictDiskContents = newValue }
    }

    var isDirty: Bool {
        (metadata != savedMetadata || noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled)
            && loadError == nil && !isLoading
    }

    init(file: FileRef,
         route: String,
         sourceDirectory: URL,
         gitCommit: @escaping NativeContentOperations.GitCommit = NativeContentOperations.processGitCommit) {
        self.file = file
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
        let newContents = PageMetadataEditor.write(metadata, into: contents)
        let url = file.url
        do {
            var session = fileSession
            try await session.save(newContents, to: url)
            fileSession = session
            savedMetadata = metadata
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
        switch change {
        case .some(.reloadable(let disk)):
            adopt(disk)
        case .some(.conflict(let disk)):
            conflictDiskContents = disk
        case .some(.none), nil:
            break
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

    // `[weak self]` — see the note in TypedEntryEditorModel: view-lifetime bindings on a model that
    // is replaced per selection.
    func titleBinding() -> Binding<String> {
        Binding(get: { [weak self] in self?.metadata.title ?? "" },
                set: { [weak self] in self?.metadata.title = $0 })
    }
    func descriptionBinding() -> Binding<String> {
        Binding(get: { [weak self] in self?.metadata.description ?? "" },
                set: { [weak self] in self?.metadata.description = $0 })
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
        .page(file: relativePath(of: file.url, under: sourceDirectory))
    }

    private func adopt(_ text: String) {
        let read = PageMetadataEditor.read(text)
        metadata = read
        savedMetadata = read
    }

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
        _ = await gitCommit(sourceDirectory, rel, "anglesite: edit page \(slug)")
    }

    private func relativePath(of url: URL, under root: URL) -> String {
        let u = url.standardizedFileURL.path(percentEncoded: false)
        let r = root.standardizedFileURL.path(percentEncoded: false)
        if u.hasPrefix(r) { return String(u.dropFirst(r.count)).drop(while: { $0 == "/" }).description }
        return url.lastPathComponent
    }

}
