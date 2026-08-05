import Foundation

/// Writes a hosted community's current membership into the site's local git working copy as
/// `data/community-members/{id}.json` files (V-5.1b, #907), mirroring `AnnouncedPostCommitter`
/// (#908) exactly. Like that committer, this reconciles against the *full current set* every
/// call rather than draining a staging queue: the Worker's followers collection stays the
/// permanent operational store, so a member who left (or was banned, #370) simply drops out of
/// the fetched set and their stale snapshot file must be removed on the next reconcile too.
public enum CommunityMemberCommitter {
    /// JSON encoding for one member's snapshot file: sorted keys (stable, clean diffs), matching
    /// the Astro template's zod schema (`Resources/Template/src/lib/communityMembers.ts`) and
    /// `CommunityMemberTests`'s own round-trip fixture.
    public static func jsonData(for member: CommunityMember) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(member)
    }

    /// Reconciles `data/community-members/` under `siteDirectory` against `members` (the full,
    /// current set from the community's own Worker followers collection) and commits the result
    /// in one commit:
    /// - a new or changed member is written (or overwritten) at its `gitPath`
    /// - an existing snapshot file whose id is absent from `members` is deleted
    /// - unchanged files are left untouched, so a sync with nothing new is a true no-op — no
    ///   empty commit, no git subprocess/libgit2 call at all
    ///
    /// Returns every id actually touched by the resulting commit — written (new or changed) or
    /// deleted (no longer a member) — empty (never throws) if there was nothing to reconcile, or
    /// if the git commit closure failed, so an interrupted or failed sync simply re-attempts the
    /// same reconcile next time rather than losing state.
    @discardableResult
    public static func commit(
        members: [CommunityMember],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> [String] {
        let membersDir = siteDirectory.appendingPathComponent("data/community-members", isDirectory: true)
        let currentIDs = Set(members.map(\.id))

        var relPaths: [String] = []
        var writtenIDs: [String] = []
        var deletedIDs: [String] = []

        let existingFiles = (try? fileManager.contentsOfDirectory(at: membersDir, includingPropertiesForKeys: nil)) ?? []
        for file in existingFiles where file.pathExtension == "json" {
            let id = file.deletingPathExtension().lastPathComponent
            guard !currentIDs.contains(id) else { continue }
            guard (try? fileManager.removeItem(at: file)) != nil else { continue }
            relPaths.append("data/community-members/\(id).json")
            deletedIDs.append(id)
        }

        if !members.isEmpty {
            try? fileManager.createDirectory(at: membersDir, withIntermediateDirectories: true)
        }
        for member in members {
            guard let data = try? jsonData(for: member) else { continue }
            let fileURL = membersDir.appendingPathComponent("\(member.id).json")
            if let existing = try? Data(contentsOf: fileURL), existing == data { continue }
            guard (try? data.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(member.gitPath)
            writtenIDs.append(member.id)
        }

        guard !relPaths.isEmpty else { return [] }

        let message = Self.commitMessage(writtenCount: writtenIDs.count, deletedCount: deletedIDs.count)
        guard await gitCommitBatch(siteDirectory, relPaths, message) != nil else { return [] }
        return writtenIDs + deletedIDs
    }

    /// Describes what actually changed, since a reconcile can be a pure write (new members), a
    /// pure delete (members who left/were banned), or both at once.
    static func commitMessage(writtenCount: Int, deletedCount: Int) -> String {
        switch (writtenCount, deletedCount) {
        case (let w, 0):
            return w == 1 ? "chore: snapshot 1 community member" : "chore: snapshot \(w) community members"
        case (0, let d):
            return d == 1 ? "chore: remove 1 community member" : "chore: remove \(d) community members"
        case (let w, let d):
            return "chore: snapshot \(w) community member\(w == 1 ? "" : "s"), remove \(d)"
        }
    }
}
