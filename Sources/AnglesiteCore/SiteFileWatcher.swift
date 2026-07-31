import Foundation

/// Shared rules for which project paths the knowledge index cares about. Lifted out of
/// `SiteKnowledgeIndex` so the file watcher and the index agree on what to skip.
public enum SiteIndexPaths {
    /// Build artifacts and dependency directories the index never reads.
    public static let skippedDirectoryNames: Set<String> = [
        ".astro", ".git", ".netlify", ".vercel", "dist", "node_modules",
    ]

    /// True when any path component is a skipped directory (e.g. `node_modules/...`, `dist/...`).
    public static func isSkipped(relativePath: String) -> Bool {
        relativePath.split(separator: "/").contains { skippedDirectoryNames.contains(String($0)) }
    }

    /// POSIX path of `url` relative to `root`, or `nil` if `url` is not under `root`. Unlike the
    /// index's internal helper, an out-of-tree path yields `nil` (the watcher drops it) rather
    /// than falling back to the absolute path.
    public static func relativePOSIXPath(of url: URL, under root: URL) -> String? {
        let urlComponents = url.standardizedFileURL.pathComponents
        let rootComponents = root.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: rootComponents), urlComponents.count > rootComponents.count else { return nil }
        return urlComponents.dropFirst(rootComponents.count).joined(separator: "/")
    }
}

/// Translates a `FileChangeBatch` into `SiteKnowledgeIndex` mutations, and (when supplied) mirrors
/// each mutation into the `SemanticRanker` so the lexical and semantic halves stay consistent after
/// incremental edits (#383). Kept free-standing (not on the runtime actor) so it is unit-testable
/// without spinning a runtime. Portable — reindexing has no platform-specific code; only the
/// watcher that feeds it (`Platform/SiteFileWatching.swift`) does.
public enum KnowledgeReindex {
    /// Reconciles one change batch against the index (and optional ranker): a bulk/coalesced
    /// batch triggers a full rebuild + ranker re-sync, while a per-file batch upserts or removes
    /// each unique in-tree path according to its current on-disk existence.
    ///
    /// - Parameters:
    ///   - batch: The coalesced watcher output. `needsFullRescan` means per-file granularity was
    ///     lost, so the whole site is rebuilt rather than guessing what changed.
    ///   - index: The lexical index to mutate.
    ///   - ranker: The semantic half to keep in lockstep (#383); `nil` skips vector maintenance
    ///     entirely (e.g. hosts without embedding support).
    ///   - siteID: The site whose documents are keyed in both stores.
    ///   - projectRoot: Root that watcher paths are relativized against; out-of-tree paths are
    ///     dropped.
    ///   - fileExists: Existence probe, injectable so tests can simulate deletes without
    ///     touching the filesystem. A missing file means "remove", not "skip".
    public static func apply(
        _ batch: FileChangeBatch,
        to index: SiteKnowledgeIndex,
        ranker: SemanticRanker? = nil,
        siteID: String,
        projectRoot: URL,
        fileExists: @Sendable (URL) -> Bool = { FileManager.default.fileExists(atPath: $0.path) }
    ) async {
        if batch.needsFullRescan {
            await index.rebuild(siteID: siteID, projectRoot: projectRoot)
            // A coalesced/bulk event drops per-file granularity, so re-sync the ranker against the
            // freshly-rebuilt document set rather than guessing which vectors changed. `sync` reuses
            // cached vectors for unchanged content, so this only re-embeds what actually moved.
            if let ranker {
                await ranker.sync(siteID: siteID, documents: await index.documents(siteID: siteID))
            }
            return
        }
        // A watcher can list the same path multiple times in one coalesced batch (e.g. write →
        // rename → write). Each index key only needs to be reconciled once against its current
        // on-disk state, so collapse duplicates before touching the index actor.
        var seen = Set<String>()
        for url in batch.paths {
            guard let relativePath = SiteIndexPaths.relativePOSIXPath(of: url, under: projectRoot),
                  !SiteIndexPaths.isSkipped(relativePath: relativePath),
                  seen.insert(relativePath).inserted
            else { continue }
            if fileExists(url) {
                await index.upsertFile(siteID: siteID, projectRoot: projectRoot, relativePath: relativePath)
                if let ranker {
                    // `upsertFile` may have dropped the path (now unreadable or a non-indexed kind);
                    // in that case there's no document to embed, so drop its vector instead.
                    if let document = await index.document(siteID: siteID, relativePath: relativePath) {
                        await ranker.upsert(siteID: siteID, document: document)
                    } else {
                        await ranker.remove(siteID: siteID, docID: SiteKnowledgeIndex.documentID(siteID: siteID, relativePath: relativePath))
                    }
                }
            } else {
                await index.removeFile(siteID: siteID, relativePath: relativePath)
                await ranker?.remove(siteID: siteID, docID: SiteKnowledgeIndex.documentID(siteID: siteID, relativePath: relativePath))
            }
        }
    }
}
