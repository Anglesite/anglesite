import Foundation

/// Writes the Worker's D1 inbox (`WebmentionInboxD1Client`) into the site's local git working
/// copy as `data/interactions/{id}.json` files, per the received-interaction canonicality design
/// (`docs/specs/2026-06-29-c3-received-interaction-canonicality.md`) — the "snapshot to git" half
/// of #362. This is the counterpart to `InboxSubmissionCommitter` (#587), but reconciles against
/// the *full current set* every call rather than draining a staging queue: D1 stays the permanent
/// operational store (there's nothing to delete from it after a successful commit), so a stale
/// snapshot file — one whose interaction was later unverified or its source deleted — must be
/// removed on the next reconcile too, per the design doc's "sender-side delete" behavior.
public enum ReceivedInteractionCommitter {
    /// JSON encoding for one interaction's snapshot file: sorted keys (stable, clean diffs) and
    /// ISO 8601 dates, matching the Astro template's zod schema
    /// (`Resources/Template/src/lib/interactions.ts`) and `ReceivedInteractionTests`'s own
    /// round-trip fixture.
    public static func jsonData(for interaction: ReceivedInteraction) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(interaction)
    }

    /// Reconciles `data/interactions/` under `siteDirectory` against `interactions` (the full,
    /// current, verified set from D1) and commits the result in one commit:
    /// - a new or changed interaction is written (or overwritten) at its `gitPath`
    /// - an existing snapshot file whose id is absent from `interactions` is deleted
    /// - unchanged files are left untouched, so a sync with nothing new is a true no-op — no
    ///   empty commit, no git subprocess/libgit2 call at all
    ///
    /// Returns every id actually touched by the resulting commit — written (new or changed
    /// content) or deleted (stale, no longer in `interactions`) — empty (never throws) if there
    /// was nothing to reconcile, or if the git commit closure failed, so an interrupted or failed
    /// sync simply re-attempts the same reconcile next time rather than losing state. An id whose
    /// file was already up to date is not included: it wasn't part of this commit.
    @discardableResult
    public static func commit(
        interactions: [ReceivedInteraction],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> [String] {
        let interactionsDir = siteDirectory.appendingPathComponent("data/interactions", isDirectory: true)
        let currentIDs = Set(interactions.map(\.id))

        var relPaths: [String] = []
        var writtenIDs: [String] = []
        var deletedIDs: [String] = []

        let existingFiles = (try? fileManager.contentsOfDirectory(at: interactionsDir, includingPropertiesForKeys: nil)) ?? []
        for file in existingFiles where file.pathExtension == "json" {
            let id = file.deletingPathExtension().lastPathComponent
            guard !currentIDs.contains(id) else { continue }
            guard (try? fileManager.removeItem(at: file)) != nil else { continue }
            relPaths.append("data/interactions/\(id).json")
            deletedIDs.append(id)
        }

        if !interactions.isEmpty {
            try? fileManager.createDirectory(at: interactionsDir, withIntermediateDirectories: true)
        }
        for interaction in interactions {
            guard let data = try? jsonData(for: interaction) else { continue }
            let fileURL = interactionsDir.appendingPathComponent("\(interaction.id).json")
            if let existing = try? Data(contentsOf: fileURL), existing == data { continue }
            guard (try? data.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(interaction.gitPath)
            writtenIDs.append(interaction.id)
        }

        guard !relPaths.isEmpty else { return [] }

        let message = Self.commitMessage(writtenCount: writtenIDs.count, deletedCount: deletedIDs.count)
        guard await gitCommitBatch(siteDirectory, relPaths, message) != nil else { return [] }
        return writtenIDs + deletedIDs
    }

    /// Describes what actually changed, since a reconcile can be a pure write, a pure delete
    /// (every interaction from a source was unverified/removed), or both at once.
    static func commitMessage(writtenCount: Int, deletedCount: Int) -> String {
        switch (writtenCount, deletedCount) {
        case (let w, 0):
            return w == 1 ? "chore: snapshot 1 received interaction" : "chore: snapshot \(w) received interactions"
        case (0, let d):
            return d == 1 ? "chore: remove 1 received interaction" : "chore: remove \(d) received interactions"
        case (let w, let d):
            return "chore: snapshot \(w) received interaction\(w == 1 ? "" : "s"), remove \(d)"
        }
    }
}
