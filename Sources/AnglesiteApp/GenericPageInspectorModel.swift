// Sources/AnglesiteApp/GenericPageInspectorModel.swift
import Foundation
import SwiftUI
import Observation
import AnglesiteCore

/// Inspector for a selected page/entry that isn't a registered content type (`ContentTypeResolver`)
/// or a plain frontmatter page (`.md`/`.mdx`/`.markdown`) — most commonly a hand-authored `.astro`
/// page. There's no safe generic way to parse and rewrite an Astro component's script frontmatter
/// (it's JS, not YAML), so title/description/body stay permanently read-only (#1100). The two
/// search/crawling toggles are the one exception (#1093): they're backed by the shared
/// `RobotsConfigFile`, never by this page's own file, so editing them needs no Astro-aware parsing.
@MainActor
@Observable
final class GenericPageInspectorModel: InspectorEditorModel {
    let file: FileRef
    let route: String
    private let sourceDirectory: URL
    private let gitCommit: NativeContentOperations.GitCommit

    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false

    private(set) var isSaving = false
    /// Nothing here can fail to *load* (this model reads no page file of its own), but a failed
    /// robots-config write has to reach `InspectorChrome` somehow — same `"Save failed: …"` channel
    /// `PageMetadataModel`/`TypedEntryEditorModel` use.
    private(set) var loadError: String?
    private(set) var isLoading = false
    var conflictDiskContents: String? {
        get { nil }
        set { }
    }

    var isDirty: Bool {
        noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled
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
        loadError = nil
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
        do {
            let robotsChanged = try RobotsConfigFile.apply(
                source: robotsSource, noindex: noindexEnabled, disallowCrawl: disallowCrawlEnabled,
                path: route, under: sourceDirectory
            )
            savedNoindexEnabled = noindexEnabled
            savedDisallowCrawlEnabled = disallowCrawlEnabled
            if robotsChanged {
                _ = await gitCommit(sourceDirectory, RobotsConfigFile.relativePath, "anglesite: update robots-config.json")
            }
            return true
        } catch {
            loadError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    func flushBeforeLeaving() async -> Bool { await save() }
    func checkExternalChange() async {}
    func keepMyChanges() {}
    func reloadFromDisk() async {}

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

    private func relativePath(of url: URL, under root: URL) -> String {
        let u = url.standardizedFileURL.path(percentEncoded: false)
        let r = root.standardizedFileURL.path(percentEncoded: false)
        if u.hasPrefix(r) { return String(u.dropFirst(r.count)).drop(while: { $0 == "/" }).description }
        return url.lastPathComponent
    }
}
