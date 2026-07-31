import Foundation

/// Applies a Worker-name change to an already-scaffolded site's `wrangler.toml` and
/// `.site-config`, after a Worker-name collision is detected at first deploy (#740).
///
/// Only the `name = "..."` line in `wrangler.toml` is rewritten — not a full regenerate via
/// `WorkerComposition.generateWranglerToml` — because there is no reader that reconstructs the
/// `[Feature]` list or provisioned D1/KV resource IDs from an already-written file, and a full
/// regenerate would silently drop any social-feature config a user provisioned (via
/// `SocialWorkerProvisionCommand`) before their first deploy.
public enum WorkerNameRename {
    /// Ways ``WorkerNameRename/apply(newName:siteDirectory:fileManager:)`` can refuse — all
    /// thrown before any write, so a failed rename never leaves the two files half-updated.
    public enum RenameError: Error, Equatable, Sendable {
        /// `newName` doesn't satisfy `WorkerComposition`'s `[A-Za-z0-9_-]+` constraint.
        case invalidName(String)
        /// No `wrangler.toml` at the site root — the site was never scaffolded for deploy, so
        /// there is nothing to rename.
        case wranglerConfigMissing
        /// `wrangler.toml` exists but has no `name = "..."` line to rewrite — surfaced rather
        /// than appending one, since a hand-edited file shouldn't be silently restructured.
        case nameLineNotFound
    }

    /// Rewrites `wrangler.toml`'s `name = "..."` line and `.site-config`'s `CF_PROJECT_NAME` to
    /// `newName`. Throws `.invalidName` before touching any file if `newName` doesn't match
    /// `WorkerComposition`'s `[A-Za-z0-9_-]+` constraint, so a rejected name never gets partially
    /// written.
    public static func apply(newName: String, siteDirectory: URL, fileManager: FileManager = .default) throws {
        guard WorkerComposition.isValidSiteName(newName) else {
            throw RenameError.invalidName(newName)
        }

        let wranglerURL = siteDirectory.appendingPathComponent("wrangler.toml")
        guard fileManager.fileExists(atPath: wranglerURL.path) else {
            throw RenameError.wranglerConfigMissing
        }
        let toml = try String(contentsOf: wranglerURL, encoding: .utf8)
        var lines = toml.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let nameLineIndex = lines.firstIndex(where: { $0.hasPrefix("name = \"") }) else {
            throw RenameError.nameLineNotFound
        }
        lines[nameLineIndex] = "name = \"\(newName)\""
        try lines.joined(separator: "\n").write(to: wranglerURL, atomically: true, encoding: .utf8)

        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([("CF_PROJECT_NAME", newName)], into: config)
        try updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
