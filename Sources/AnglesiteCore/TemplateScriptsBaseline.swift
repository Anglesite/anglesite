import Foundation

/// Reads/writes `Config/template-scripts-baseline.json` — a per-file content-hash snapshot the
/// scripts/ refresh mechanism (design doc, #1053) uses to tell "stale" apart from "the owner
/// edited this." App-owned state, never committed to the site's git repo (`Config/` sits outside
/// `Source/` — see the `.anglesite` package model), mirroring `Config/dependency-baseline.json`'s
/// placement rationale.
public struct TemplateScriptsBaseline: Codable, Equatable, Sendable {
    /// The baseline record for one app-owned `scripts/` file: the last reconciled template
    /// content hash, plus (when set) a divergence the owner already declined.
    public struct Entry: Codable, Equatable, Sendable {
        /// Hash (`VectorMath.stableHash`) of the template content this file was last
        /// successfully reconciled against — at scaffold time, at a prior silent refresh, or
        /// backfilled from the site's own content the first time this mechanism inspected it.
        public var baselineHash: String
        /// Set only after the owner picks "keep my version" for a divergent file — the template
        /// hash they declined, so the same divergence isn't re-asked until the template file
        /// changes again past this point.
        public var acknowledgedTemplateHash: String?

        /// Creates an entry; the default `nil` acknowledgement is the normal freshly-reconciled
        /// state — an acknowledgement only appears after the owner declines an update.
        public init(baselineHash: String, acknowledgedTemplateHash: String? = nil) {
            self.baselineHash = baselineHash
            self.acknowledgedTemplateHash = acknowledgedTemplateHash
        }
    }

    /// The baseline's filename inside `Config/` — public so tests and diagnostics can locate the
    /// file without duplicating the string.
    public static let filename = "template-scripts-baseline.json"

    /// One ``Entry`` per app-owned file, keyed by template-relative path (e.g.
    /// `scripts/pre-deploy-check.ts`). A missing key means the file was never reconciled — the
    /// checker backfills it on first encounter.
    public var files: [String: Entry]

    /// Creates a baseline; the empty default is the never-recorded state ``load(from:)`` also
    /// falls back to.
    public init(files: [String: Entry] = [:]) {
        self.files = files
    }

    /// Never fails — an absent or corrupt baseline file reads as "no baseline recorded for any
    /// file yet," which is exactly the legacy-site case the checker already handles explicitly.
    public static func load(from configDirectory: URL) -> TemplateScriptsBaseline {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(TemplateScriptsBaseline.self, from: data)
        else { return TemplateScriptsBaseline() }
        return decoded
    }

    /// Writes the baseline atomically into `configDirectory` — unlike ``load(from:)`` this does
    /// throw, since silently losing a just-reconciled baseline would re-prompt the owner about
    /// divergences they already resolved.
    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }
}
