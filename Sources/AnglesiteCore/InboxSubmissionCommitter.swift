import Foundation
#if canImport(Darwin)
import SwiftGit2
#endif

/// Writes staged inbox submissions (`InboxKVClient.Submission`) into the site's local git
/// working copy as Keystatic-format Markdoc files (`src/content/inbox/<slug>.md`, matching the
/// `inbox` collection schema injected by `IntegrationCatalog.inbox`,
/// `Sources/AnglesiteCore/IntegrationCatalog.swift:652-665`), then commits them in one commit.
/// This is the "commit staged submissions into the site's local git working copy" half of #587
/// — it operates on the host's `Source/` directory directly (the same `siteDirectory`
/// `SiteRuntime` implementations pass to `start`), committing the same way
/// `NativeContentOperations.processGitCommit` does for a single file: in-process SwiftGit2
/// (libgit2) on Darwin, where `/usr/bin/git` cannot execute under App Sandbox (#640), and
/// subprocess git off-Darwin.
public enum InboxSubmissionCommitter {
    /// A URL/filename-safe slug derived from the subject, suffixed with the first 8 characters
    /// of the submission id to avoid collisions between two submissions with the same subject
    /// text. This value becomes the `<slug>.md` filename only — Keystatic's `fields.slug`
    /// serializer writes the human-entered subject text, not this slug, into frontmatter.
    public static func slug(for submission: InboxKVClient.Submission) -> String {
        let lowered = submission.subject.lowercased()
        let sluggedScalars = lowered.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) ? Character(scalar) : "-"
        }
        var collapsed = String(sluggedScalars).replacingOccurrences(
            of: "-+", with: "-", options: .regularExpression)
        collapsed = collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        if collapsed.isEmpty { collapsed = "message" }
        let suffix = submission.id.prefix(8)
        return "\(collapsed)-\(suffix)"
    }

    /// Keystatic frontmatter + Markdoc body for one submission, matching the `inbox` collection's
    /// schema: `subject` (the human-entered subject text — `fields.slug`'s serializer writes the
    /// name, not the derived slug, into frontmatter), `from`, `receivedDate` (YYYY-MM-DD), `status`
    /// (`new` for every freshly-synced submission), and the `message` markdoc body.
    public static func markdocContent(for submission: InboxKVClient.Submission) -> String {
        let receivedDate = String(submission.receivedAt.prefix(10))  // "2026-07-10T00:00:00Z" -> "2026-07-10"
        let escapedSubject = escapeYAMLDoubleQuoted(submission.subject)
        let escapedFrom = escapeYAMLDoubleQuoted(submission.from)
        return """
        ---
        subject: "\(escapedSubject)"
        from: "\(escapedFrom)"
        receivedDate: \(receivedDate)
        status: new
        ---
        \(submission.message)
        """
    }

    /// Escapes a raw string for embedding in a YAML double-quoted scalar. Backslashes must be
    /// escaped first — escaping quotes before backslashes would double-process the backslashes
    /// introduced by the quote-escaping step, and would leave a user-supplied backslash (e.g. one
    /// ending the string, or preceding a character YAML treats as an escape like `\n`) to combine
    /// with the following character or the closing quote, producing malformed frontmatter.
    ///
    /// Also escapes the C0 control characters significant inside a YAML double-quoted scalar —
    /// literal newline, carriage return, and tab — to their `\n`/`\r`/`\t` escapes. A visitor-
    /// supplied `subject`/`from` can contain a literal newline (a JSON request body's `\n` becomes
    /// a real newline once the Worker's `JSON.parse` runs; `validateInboxFields`'s `.trim()` only
    /// trims leading/trailing whitespace, not embedded characters), which would otherwise spill
    /// the double-quoted scalar across multiple lines and produce invalid frontmatter. These three
    /// replacements don't overlap with each other or with the backslash/quote ones above, so their
    /// relative order doesn't matter as long as they run after the backslash escape.
    private static func escapeYAMLDoubleQuoted(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
    }

    /// Writes each submission to `src/content/inbox/<slug>.md` under `siteDirectory`, stages and
    /// commits all of them in a single commit, and returns the ids that were part of that commit
    /// (safe for the caller to delete from KV staging). Returns an empty array — never throws —
    /// if there was nothing to write or the commit failed, so callers leave undeleted ids staged
    /// for the next site-open's pull rather than losing them.
    /// - Parameters:
    ///   - submissions: The inbox submissions to write and commit.
    ///   - siteDirectory: The site's `Source/` directory the submissions are written under.
    ///   - fileManager: Used only to create the `src/content/inbox` directory; per-submission
    ///     file writes go through `Data.write(to:options:)` directly and do not go through this.
    ///   - gitCommitBatch: Injectable for tests; defaults to the real git commit implementation.
    public static func commit(
        submissions: [InboxKVClient.Submission],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = processGitCommitBatch
    ) async -> [String] {
        guard !submissions.isEmpty else { return [] }
        let inboxDir = siteDirectory.appendingPathComponent("src/content/inbox", isDirectory: true)
        try? fileManager.createDirectory(at: inboxDir, withIntermediateDirectories: true)

        var relPaths: [String] = []
        var ids: [String] = []
        for submission in submissions {
            let submissionSlug = slug(for: submission)
            let relPath = "src/content/inbox/\(submissionSlug).md"
            let fileURL = siteDirectory.appendingPathComponent(relPath, isDirectory: false)
            guard let data = markdocContent(for: submission).data(using: .utf8) else { continue }
            guard (try? data.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(relPath)
            ids.append(submission.id)
        }
        guard !relPaths.isEmpty else { return [] }

        let message = ids.count == 1
            ? "inbox: capture 1 visitor submission"
            : "inbox: capture \(ids.count) visitor submissions"
        guard await gitCommitBatch(siteDirectory, relPaths, message) != nil else { return [] }
        return ids
    }

    #if canImport(Darwin)
    /// Stages and commits multiple relative paths in one commit — the batched counterpart to
    /// `NativeContentOperations.processGitCommit`, which only ever commits a single path.
    /// Via SwiftGit2 (in-process libgit2, #640): `/usr/bin/git` cannot execute at all under App
    /// Sandbox. Same two behavioral caveats as `processGitCommit` (commits whatever is staged
    /// rather than a path-scoped commit; no shell hooks) — see its doc comment for why both are
    /// acceptable here.
    @Sendable public static func processGitCommitBatch(
        _ projectRoot: URL, _ relPaths: [String], _ message: String
    ) async -> String? {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(projectRoot) else { return nil }
        for relPath in relPaths {
            guard case .success = repo.add(path: relPath) else { return nil }
        }
        let signature = await GitIdentity.signature(for: repo)
        guard case .success(let commit) = repo.commit(message: message, signature: signature) else { return nil }
        return commit.oid.description
    }
    #else
    /// Stages and commits multiple relative paths in one commit — the batched counterpart to
    /// `NativeContentOperations.processGitCommit`, which only ever commits a single path.
    /// Off-Darwin there's no App Sandbox to route around, so plain subprocess git remains
    /// correct here rather than a gap to fill.
    @Sendable public static func processGitCommitBatch(
        _ projectRoot: URL, _ relPaths: [String], _ message: String
    ) async -> String? {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        func run(_ args: [String]) async -> ProcessSupervisor.RunResult? {
            let result = try? await ProcessSupervisor.shared.run(
                executable: git, arguments: args, currentDirectoryURL: projectRoot)
            guard let result, result.exitCode == 0 else { return nil }
            return result
        }
        guard await run(["rev-parse", "--git-dir"]) != nil,
              await run(["add", "--"] + relPaths) != nil,
              await run(["commit", "-m", message, "--"] + relPaths) != nil,
              let head = await run(["rev-parse", "HEAD"])
        else { return nil }
        return head.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    #endif
}
