import Foundation

/// Reads/writes `Config/template-scripts-baseline.json` — a per-file content-hash snapshot the
/// scripts/ refresh mechanism (design doc, #1053) uses to tell "stale" apart from "the owner
/// edited this." App-owned state, never committed to the site's git repo (`Config/` sits outside
/// `Source/` — see the `.anglesite` package model), mirroring `Config/dependency-baseline.json`'s
/// placement rationale.
public struct TemplateScriptsBaseline: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        /// Hash (`VectorMath.stableHash`) of the template content this file was last
        /// successfully reconciled against — at scaffold time, at a prior silent refresh, or
        /// backfilled from the site's own content the first time this mechanism inspected it.
        public var baselineHash: String
        /// Set only after the owner picks "keep my version" for a divergent file — the template
        /// hash they declined, so the same divergence isn't re-asked until the template file
        /// changes again past this point.
        public var acknowledgedTemplateHash: String?

        public init(baselineHash: String, acknowledgedTemplateHash: String? = nil) {
            self.baselineHash = baselineHash
            self.acknowledgedTemplateHash = acknowledgedTemplateHash
        }
    }

    public static let filename = "template-scripts-baseline.json"

    public var files: [String: Entry]

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

    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }
}
