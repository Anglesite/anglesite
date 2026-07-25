// Sources/AnglesiteCore/MicropubContentCommitter.swift
import Foundation

/// Writes Micropub posts resolved by `MicropubContentSync` into the site's local git working
/// copy as typed content files (`src/content/<collection>/<slug>.md`), then commits them in one
/// commit. This is the "commit resolved posts into git" half of #912 — mirrors
/// `ReceivedInteractionCommitter`'s full-set reconciliation, but per-collection and slug-aware:
/// its id-keyed `data/interactions/` has no collision risk, while `src/content/<collection>/` is
/// a directory humans hand-edit too. See
/// docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §4.
public enum MicropubContentCommitter {
    /// `Config/micropubSync.json`'s persisted shape: Micropub post URL → the `Source/`-relative
    /// path it was written to. A flat `[String: String]` (not a wrapper struct with a
    /// `pathsByURL` field) so the file on disk is exactly `{"<url>": "<relPath>", ...}` — simpler
    /// to inspect/decode directly (including from tests) than a nested shape would be. Read/
    /// written outside the git commit (it lives in `Config/`, never `Source/`) so a later
    /// re-sync of the same post updates that exact file instead of re-resolving (and potentially
    /// re-suffixing) its slug every time.
    typealias SyncState = [String: String]

    private static let stateFileName = "micropubSync.json"

    private static func loadState(from configDirectory: URL) -> SyncState {
        let url = configDirectory.appendingPathComponent(stateFileName)
        guard let data = try? Data(contentsOf: url),
              let state = try? JSONDecoder().decode(SyncState.self, from: data)
        else { return [:] }
        return state
    }

    private static func saveState(_ state: SyncState, to configDirectory: URL, fileManager: FileManager) {
        let url = configDirectory.appendingPathComponent(stateFileName)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(state) else { return }
        try? fileManager.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    /// Resolves the relative path a post should be written to: the path already recorded in
    /// `state` for its URL, or (first sync) a freshly slugified path — suffixed (`-2`, `-3`, …)
    /// until it names a nonexistent file, so a Micropub-created file never silently overwrites a
    /// hand-authored one (or a DIFFERENT Micropub post's own file) sharing the same slug. By the
    /// time this loop runs, `post.url` has no entry in `state` (the early return above already
    /// handled that case), so the only way a candidate path can already be on disk is that some
    /// other post — hand-authored or a different, already-synced Micropub post — owns it; a
    /// fresh post always suffixes past it regardless of who put it there.
    static func resolvePath(
        for post: MicropubContentSync.ResolvedPost,
        state: SyncState,
        siteDirectory: URL,
        fileManager: FileManager
    ) -> String {
        if let existing = state[post.url] { return existing }

        let baseSlug = MicropubContentSync.collectionAndSlug(from: post.url)?.slug ?? post.url
        var candidateSlug = baseSlug
        var attempt = 1
        while true {
            let relPath = ContentScaffold.postRelativePath(collection: post.collection, slug: candidateSlug)
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            if !fileManager.fileExists(atPath: fileURL.path) {
                return relPath
            }
            attempt += 1
            candidateSlug = "\(baseSlug)-\(attempt)"
        }
    }

    /// Reconciles `src/content/<collection>/` directories under `siteDirectory` against `posts`
    /// (the full, current, resolved set) and commits the result in one commit:
    /// - a new or changed post is written (or overwritten) at its resolved path
    /// - a previously-synced post (per `Config/micropubSync.json`) absent from `posts` has its
    ///   file deleted and its state entry removed
    /// - unchanged files are left untouched, so a sync with nothing new is a true no-op
    ///
    /// `micropubSync.json` is saved regardless of whether the git commit itself succeeds: the
    /// physical file write already happened, so a later retry must see that path as already
    /// resolved rather than re-deriving (and potentially re-suffixing) a fresh slug for the same
    /// post — only the *count this call reports* (and thus whether a caller treats it as "synced
    /// this round") depends on the commit having actually landed.
    @discardableResult
    public static func commit(
        posts: [MicropubContentSync.ResolvedPost],
        into siteDirectory: URL,
        configDirectory: URL,
        fileManager: FileManager = .default,
        now: @Sendable () -> Date = Date.init,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> Int {
        var state = loadState(from: configDirectory)
        let currentURLs = Set(posts.map(\.url))

        var relPaths: [String] = []
        var writtenCount = 0
        var deletedCount = 0

        // Delete files for URLs no longer in the current resolved set before writing, so a slug
        // freed by a deletion is immediately available to a same-round collision resolution.
        for (url, relPath) in state where !currentURLs.contains(url) {
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            guard (try? fileManager.removeItem(at: fileURL)) != nil else { continue }
            relPaths.append(relPath)
            deletedCount += 1
            state.removeValue(forKey: url)
        }

        for post in posts {
            let relPath = resolvePath(for: post, state: state, siteDirectory: siteDirectory, fileManager: fileManager)
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            let existingContents = try? String(contentsOf: fileURL, encoding: .utf8)
            let baseContents = existingContents
                ?? ContentScaffold.renderEntry(descriptor: post.descriptor, title: nil, now: now())
            let newContents = TypedContentEditor.write(post.values, into: baseContents, descriptor: post.descriptor)
            state[post.url] = relPath
            guard newContents != existingContents else { continue }
            try? fileManager.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            guard (try? newContents.data(using: .utf8)?.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(relPath)
            writtenCount += 1
        }

        guard !relPaths.isEmpty else {
            saveState(state, to: configDirectory, fileManager: fileManager)
            return 0
        }

        let message = Self.commitMessage(writtenCount: writtenCount, deletedCount: deletedCount)
        let committed = await gitCommitBatch(siteDirectory, relPaths, message) != nil
        saveState(state, to: configDirectory, fileManager: fileManager)
        return committed ? writtenCount + deletedCount : 0
    }

    static func commitMessage(writtenCount: Int, deletedCount: Int) -> String {
        switch (writtenCount, deletedCount) {
        case (let w, 0):
            return w == 1 ? "micropub: sync 1 post" : "micropub: sync \(w) posts"
        case (0, let d):
            return d == 1 ? "micropub: remove 1 post" : "micropub: remove \(d) posts"
        case (let w, let d):
            return "micropub: sync \(w) post\(w == 1 ? "" : "s"), remove \(d)"
        }
    }
}
