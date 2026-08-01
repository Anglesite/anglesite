import Foundation

/// Best-effort propagation of a site's display-name rename into its `.site-config` and
/// `wrangler.toml`, but only while the site is still carrying its scaffold-time "Untitled"
/// defaults and hasn't touched Cloudflare yet (#1182). Distinct from `WorkerNameRename`, which
/// handles the post-deploy, collision-triggered rename flow and deliberately leaves `SITE_NAME`
/// untouched — this is the pre-deploy counterpart that updates both `SITE_NAME` and
/// `CF_PROJECT_NAME`.
public enum UntitledSitePropagation {
    /// Propagates `newDisplayName` into `SITE_NAME`/`CF_PROJECT_NAME` (and `wrangler.toml`'s
    /// `name` line) when — and only when — the site at `siteDirectory` is still untouched since
    /// scaffold: neither `CF_WORKER_DEPLOYED` nor `CF_WORKER_PROVISIONED` is set, `SITE_NAME`
    /// still matches the scaffold-time "Untitled"/"Untitled N" pattern (`NewSiteWizardModel`'s
    /// `untitledName`), and `CF_PROJECT_NAME` still equals the slug derived from that name (i.e.
    /// nothing has hand-customized it). Silently does nothing otherwise, or if any file is
    /// missing/unreadable/unwritable, or if the derived slug is invalid — a display-name rename
    /// must never fail or throw because of this.
    public static func propagateIfUntitled(
        newDisplayName: String,
        siteDirectory: URL,
        fileManager: FileManager = .default
    ) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        guard let config = try? String(contentsOf: configURL, encoding: .utf8) else { return }

        guard SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == nil,
              SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == nil else { return }

        guard let currentSiteName = SiteConfigFile.value(forKey: "SITE_NAME", in: config),
              isUntitledPattern(currentSiteName) else { return }

        guard let currentProjectName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config),
              currentProjectName == SiteSlug.derive(from: currentSiteName) else { return }

        let newSlug = SiteSlug.derive(from: newDisplayName)
        guard WorkerComposition.isValidSiteName(newSlug) else { return }

        let wranglerURL = siteDirectory.appendingPathComponent("wrangler.toml")
        if let toml = try? String(contentsOf: wranglerURL, encoding: .utf8) {
            var lines = toml.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            if let nameLineIndex = lines.firstIndex(where: { $0.hasPrefix("name = \"") }) {
                lines[nameLineIndex] = "name = \"\(newSlug)\""
                try? lines.joined(separator: "\n").write(to: wranglerURL, atomically: true, encoding: .utf8)
            }
        }

        let updatedConfig = SiteConfigFile.upsert(
            [("SITE_NAME", newDisplayName), ("CF_PROJECT_NAME", newSlug)],
            into: config
        )
        try? updatedConfig.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Matches exactly the pattern `NewSiteWizardModel.untitledName` generates: `"Untitled"` or
    /// `"Untitled "` followed by an integer.
    private static func isUntitledPattern(_ name: String) -> Bool {
        if name == "Untitled" { return true }
        guard name.hasPrefix("Untitled ") else { return false }
        let suffix = name.dropFirst("Untitled ".count)
        return !suffix.isEmpty && suffix.allSatisfy(\.isNumber)
    }
}
