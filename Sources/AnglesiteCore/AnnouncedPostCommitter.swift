import Foundation

/// Writes a hosted community's own announced-post outbox into the site's local git working
/// copy as `data/community-posts/{id}.json` files — the "snapshot to git" half of #908, per the
/// canonicality design (`docs/superpowers/specs/2026-07-22-v5-communities-design.md` §4.3). Like
/// `ReceivedInteractionCommitter` (#362), this reconciles against the *full current set* every
/// call rather than draining a staging queue: the Worker's outbox stays the permanent
/// operational store, so a post a moderator un-announced (`Undo(Announce)`, #370) simply drops
/// out of the fetched set and its stale snapshot file must be removed on the next reconcile too.
public enum AnnouncedPostCommitter {
    /// JSON encoding for one post's snapshot file: sorted keys (stable, clean diffs) and ISO 8601
    /// dates, matching the Astro template's zod schema
    /// (`Resources/Template/src/lib/communityPosts.ts`) and `AnnouncedPostTests`'s own round-trip
    /// fixture.
    public static func jsonData(for post: AnnouncedPost) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(post)
    }

    /// Reconciles `data/community-posts/` under `siteDirectory` against `posts` (the full,
    /// current set from the community's own Worker outbox) and commits the result in one commit:
    /// - a new or changed post is written (or overwritten) at its `gitPath`
    /// - an existing snapshot file whose id is absent from `posts` is deleted
    /// - unchanged files are left untouched, so a sync with nothing new is a true no-op — no
    ///   empty commit, no git subprocess/libgit2 call at all
    ///
    /// Returns every id actually touched by the resulting commit — written (new or changed
    /// content) or deleted (no longer in the outbox) — empty (never throws) if there was nothing
    /// to reconcile, or if the git commit closure failed, so an interrupted or failed sync simply
    /// re-attempts the same reconcile next time rather than losing state. An id whose file was
    /// already up to date is not included: it wasn't part of this commit.
    @discardableResult
    public static func commit(
        posts: [AnnouncedPost],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> [String] {
        let postsDir = siteDirectory.appendingPathComponent("data/community-posts", isDirectory: true)
        let currentIDs = Set(posts.map(\.id))

        var relPaths: [String] = []
        var writtenIDs: [String] = []
        var deletedIDs: [String] = []

        let existingFiles = (try? fileManager.contentsOfDirectory(at: postsDir, includingPropertiesForKeys: nil)) ?? []
        for file in existingFiles where file.pathExtension == "json" {
            let id = file.deletingPathExtension().lastPathComponent
            guard !currentIDs.contains(id) else { continue }
            guard (try? fileManager.removeItem(at: file)) != nil else { continue }
            relPaths.append("data/community-posts/\(id).json")
            deletedIDs.append(id)
        }

        if !posts.isEmpty {
            try? fileManager.createDirectory(at: postsDir, withIntermediateDirectories: true)
        }
        for post in posts {
            guard let data = try? jsonData(for: post) else { continue }
            let fileURL = postsDir.appendingPathComponent("\(post.id).json")
            if let existing = try? Data(contentsOf: fileURL), existing == data { continue }
            guard (try? data.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(post.gitPath)
            writtenIDs.append(post.id)
        }

        guard !relPaths.isEmpty else { return [] }

        let message = Self.commitMessage(writtenCount: writtenIDs.count, deletedCount: deletedIDs.count)
        guard await gitCommitBatch(siteDirectory, relPaths, message) != nil else { return [] }
        return writtenIDs + deletedIDs
    }

    /// Describes what actually changed, since a reconcile can be a pure write, a pure delete
    /// (every post from a member was un-announced/banned away), or both at once.
    static func commitMessage(writtenCount: Int, deletedCount: Int) -> String {
        switch (writtenCount, deletedCount) {
        case (let w, 0):
            return w == 1 ? "chore: snapshot 1 announced post" : "chore: snapshot \(w) announced posts"
        case (0, let d):
            return d == 1 ? "chore: remove 1 announced post" : "chore: remove \(d) announced posts"
        case (let w, let d):
            return "chore: snapshot \(w) announced post\(w == 1 ? "" : "s"), remove \(d)"
        }
    }
}
