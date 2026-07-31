import Foundation

/// Shared lifecycle state for text-backed app editors.
///
/// The app models own domain-specific parsing, validation, bindings, and commit messages. This
/// session owns the raw file mechanics they share: off-main load/save, saved contents, modification
/// date tracking, external-change decisions, conflict retention, and keep/reload resolution.
public struct EditableFileSession: Sendable, Equatable {
    /// The contents as last persisted (loaded, saved, or adopted from a reload) — the baseline
    /// an owning model compares its live buffer against to decide "dirty".
    public private(set) var savedContents: String
    /// The file's modification date at the last load/save. `nil` means the date couldn't be
    /// read, which disables external-change detection for this file — see
    /// ``missingModificationDateWarning(after:path:)`` for the log copy owners surface then.
    public private(set) var lastModified: Date?
    /// The disk copy retained while an edit conflict is unresolved; non-`nil` means a
    /// keep-mine/reload question is pending. Settable (not `private(set)`) so an owning model
    /// can bind its conflict sheet's presentation directly to this field.
    public var conflictDiskContents: String?

    /// Starts a session in the given state. The defaults describe "no file loaded yet";
    /// non-default values exist for tests and for models that restore state.
    public init(savedContents: String = "", lastModified: Date? = nil, conflictDiskContents: String? = nil) {
        self.savedContents = savedContents
        self.lastModified = lastModified
        self.conflictDiskContents = conflictDiskContents
    }

    /// Loads the file off the main actor, resets the session baseline to what's on disk, and
    /// clears any pending conflict (a fresh load supersedes it). Returns the loaded contents
    /// for the model to parse into its own state; `@discardableResult` for callers that only
    /// need the session's bookkeeping updated.
    @discardableResult
    public mutating func load(from url: URL) async throws -> String {
        let loaded = try await Task.detached(priority: .userInitiated) {
            try FileDocumentIO.load(url)
        }.value
        savedContents = loaded.contents
        lastModified = loaded.modificationDate
        conflictDiskContents = nil
        return loaded.contents
    }

    /// Saves off the main actor and adopts `contents` as the new baseline, recording the
    /// post-write modification date so the session's own write isn't later misread as an
    /// external change. Clears any pending conflict — an explicit save is the caller choosing
    /// its buffer over the disk copy.
    public mutating func save(_ contents: String, to url: URL) async throws {
        let mtime = try await Task.detached(priority: .userInitiated) {
            try FileDocumentIO.save(contents, to: url)
        }.value
        savedContents = contents
        lastModified = mtime
        conflictDiskContents = nil
    }

    /// Checks the file against ``lastModified`` and applies the standard external-change
    /// policy: a change under a clean buffer is adopted silently (baseline swapped to the disk
    /// copy), a change under a dirty buffer is retained in ``conflictDiskContents`` for the
    /// owner to put to the user. Returns what was detected so the model can react (re-parse,
    /// present its sheet), or `nil` when the check itself failed (file unreadable/gone) —
    /// deliberately indistinguishable from "nothing to do", since there's no useful recovery
    /// at this layer.
    public mutating func externalChange(at url: URL, bufferIsDirty: Bool) async -> FileDocumentIO.ExternalChange? {
        let known = lastModified
        let change = try? await Task.detached(priority: .userInitiated) {
            try FileDocumentIO.externalChange(
                at: url,
                lastKnownModificationDate: known,
                bufferIsDirty: bufferIsDirty
            )
        }.value
        guard let change else { return nil }

        switch change {
        case .none:
            break
        case .reloadable(let disk):
            savedContents = disk
            lastModified = await freshModificationDate(for: url)
            conflictDiskContents = nil
        case .conflict(let disk):
            conflictDiskContents = disk
        }
        return change
    }

    /// Whether a dirty buffer may be flushed to disk on the way out (switching files, closing
    /// the editor) without clobbering someone else's edit. Runs a last external-change check
    /// first; `false` means a conflict was just detected (and retained in
    /// ``conflictDiskContents``) — the owner must resolve it instead of writing. A clean
    /// buffer is always flushable (trivially: there's nothing to write).
    public mutating func canFlushBeforeLeaving(file url: URL, bufferIsDirty: Bool) async -> Bool {
        guard bufferIsDirty else { return true }
        let change = await externalChange(at: url, bufferIsDirty: true)
        if case .conflict = change {
            return false
        }
        return true
    }

    /// Resolves a pending conflict in favor of the in-app buffer: the retained disk copy is
    /// discarded, and the caller's next ``save(_:to:)`` overwrites the external edit. Purely
    /// local — nothing is written here.
    public mutating func keepMyChanges() {
        conflictDiskContents = nil
    }

    /// Resolves a pending conflict in favor of the disk copy: adopts the retained contents as
    /// the new baseline (with a fresh modification date) and returns them for the model to
    /// re-parse into its buffer. Returns `nil` when no conflict was pending, so a stale sheet
    /// action degrades to a no-op instead of clobbering state.
    public mutating func reloadFromConflict(file url: URL) async -> String? {
        guard let disk = conflictDiskContents else { return nil }
        savedContents = disk
        lastModified = await freshModificationDate(for: url)
        conflictDiskContents = nil
        return disk
    }

    /// Shared log copy for the ``lastModified``-is-`nil` situation, so every editor model
    /// (FileEditorModel, PageMetadataModel, TypedEntryEditorModel) reports the degraded state
    /// in identical words rather than three drifting variants.
    public static func missingModificationDateWarning(after operation: String, path: String) -> String {
        "No modification date for \(path) after \(operation); external-change detection is disabled for this file."
    }

    /// Fire-and-forget save for paths where nothing is left alive to await or surface an
    /// error (teardown, last-chance flushes). Static and non-mutating on purpose: it bypasses
    /// session bookkeeping entirely, so it's only safe when the session is being discarded
    /// anyway — anywhere else, use ``save(_:to:)``.
    public static func saveBestEffort(_ contents: String, to url: URL) {
        Task.detached(priority: .userInitiated) {
            try? FileDocumentIO.save(contents, to: url)
        }
    }

    private func freshModificationDate(for url: URL) async -> Date? {
        try? await Task.detached(priority: .userInitiated) {
            try FileDocumentIO.load(url).modificationDate
        }.value
    }
}
