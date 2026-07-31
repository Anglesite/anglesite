import Foundation

/// The page/post re-title pipeline: load the file, rewrite its title via `PageTitleEditor`, save,
/// then commit best-effort. I/O and git are injected so the flow is unit-testable; the defaults are
/// the real `FileDocumentIO` + `NativeContentOperations.processGitCommit`. Lives in AnglesiteCore
/// (not the app-target model) so `swift test` covers it — the same split as `TokenOnboarding`.
public struct NavigatorRenameService: Sendable {
    /// Why a rename couldn't complete. The first two mirror ``PageTitleEditor/RewriteError``
    /// one-to-one (they're user-recoverable validation feedback); `io` carries a string rather
    /// than the underlying `Error` so the enum stays `Equatable` for test assertions.
    public enum RenameError: Error, Equatable {
        /// The new title was empty (or whitespace-only) after trimming — writing it would
        /// leave the page untitled.
        case emptyTitle
        /// ``PageTitleEditor`` found no recognized place to write a title in this file type
        /// (unknown extension, or an `.astro`/`.html` file with no existing `title=` attribute).
        case noEditableLocation
        /// Loading or saving the file failed; the payload is the underlying error's description.
        case io(String)
    }

    /// A completed rename. Carries both content sides, not just the title, so the caller can
    /// register the rename as a `ContentUndoCoordinator.Mutation` for ⌘Z (#675) — this method
    /// already loads the file and computes the rewrite, so exposing them adds no work. A rename is
    /// an in-place title rewrite (`PageTitleEditor`), never a file move, which is what lets a
    /// single-file content snapshot describe it completely.
    public struct RenameOutcome: Sendable, Equatable {
        /// The trimmed title actually written.
        public let title: String
        /// File contents before the rewrite — the undo side.
        public let previousContents: String
        /// File contents after the rewrite — the redo side.
        public let newContents: String

        /// Memberwise initializer, public so tests can build expected outcomes directly.
        public init(title: String, previousContents: String, newContents: String) {
            self.title = title
            self.previousContents = previousContents
            self.newContents = newContents
        }
    }

    /// Re-exported commit-closure shape from ``NativeContentOperations`` so callers and tests
    /// can name the injection seam without importing the larger operations type's context.
    public typealias GitCommit = NativeContentOperations.GitCommit

    private let loadContents: @Sendable (URL) throws -> String
    private let saveContents: @Sendable (String, URL) throws -> Void
    private let gitCommit: GitCommit

    /// Creates the service. All three dependencies default to the production implementations
    /// (``FileDocumentIO`` load/save and ``NativeContentOperations``' process-based git commit);
    /// tests override them to drive the flow with no disk or git.
    public init(
        loadContents: @escaping @Sendable (URL) throws -> String = { try FileDocumentIO.load($0).contents },
        saveContents: @escaping @Sendable (String, URL) throws -> Void = { try FileDocumentIO.save($0, to: $1) },
        gitCommit: @escaping GitCommit = NativeContentOperations.processGitCommit
    ) {
        self.loadContents = loadContents
        self.saveContents = saveContents
        self.gitCommit = gitCommit
    }

    /// Runs the full rename flow: load → ``PageTitleEditor/rewrite(contents:fileExtension:newTitle:)``
    /// → save → best-effort commit. Returns `Result` rather than throwing so callers get the
    /// typed ``RenameError`` cases for inline validation UI.
    ///
    /// - Parameters:
    ///   - fileURL: The absolute location of the file to rewrite.
    ///   - fileExtension: Picks the rewrite strategy (frontmatter vs. `title=` attribute) —
    ///     passed separately rather than derived from `fileURL` so callers keep control of it.
    ///   - projectRoot: The site's `Source/` git repo, used as the commit's working directory.
    ///   - relativePath: The file's path relative to `projectRoot`, used to scope the commit.
    ///   - newTitle: The replacement title; trimmed before writing and in the commit message.
    /// - Returns: The completed ``RenameOutcome`` (including both content sides for undo
    ///   registration), or the ``RenameError`` explaining why nothing was written.
    public func rename(
        fileURL: URL,
        fileExtension: String,
        projectRoot: URL,
        relativePath: String,
        newTitle: String
    ) async -> Result<RenameOutcome, RenameError> {
        let contents: String
        do { contents = try loadContents(fileURL) }
        catch { return .failure(.io("\(error)")) }

        let rewritten: String
        switch PageTitleEditor.rewrite(contents: contents, fileExtension: fileExtension, newTitle: newTitle) {
        case .success(let s): rewritten = s
        case .failure(.emptyTitle): return .failure(.emptyTitle)
        case .failure(.noEditableLocation): return .failure(.noEditableLocation)
        }

        do { try saveContents(rewritten, fileURL) }
        catch { return .failure(.io("\(error)")) }

        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        // Best-effort: a failed commit (not a repo, rejecting hook, git missing) is ignored —
        // the file is saved and is the source of truth. Mirrors NativeContentOperations.
        _ = await gitCommit(projectRoot, relativePath, "anglesite: rename title to \"\(trimmed)\"")
        return .success(RenameOutcome(
            title: trimmed, previousContents: contents, newContents: rewritten))
    }
}
