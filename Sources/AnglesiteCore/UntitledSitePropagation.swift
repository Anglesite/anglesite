import Foundation

/// Best-effort propagation of a site's display-name rename into its `.site-config` and
/// `wrangler.toml`, for as long as the site hasn't touched Cloudflare yet (#1182). Distinct from
/// `WorkerNameRename`, which handles the post-deploy, collision-triggered rename flow and
/// deliberately leaves `SITE_NAME` untouched — this is the pre-deploy counterpart that keeps
/// `SITE_NAME` and `CF_PROJECT_NAME` in sync with the display name shown in the UI, whether the
/// site started out as the scaffold-time "Untitled" default or was scaffolded with a real name
/// and renamed again before its first publish.
public enum UntitledSitePropagation {
    /// Propagates `newDisplayName` into `SITE_NAME`/`CF_PROJECT_NAME` (and `wrangler.toml`'s
    /// `name` line) when — and only when — the site at `siteDirectory` hasn't touched Cloudflare
    /// yet (neither `CF_WORKER_DEPLOYED` nor `CF_WORKER_PROVISIONED` is set in `.site-config`)
    /// and `CF_PROJECT_NAME` still equals the slug derived from the *current* `SITE_NAME` — i.e.
    /// nothing has hand-customized the project name away from what the display name would
    /// derive. Silently does nothing otherwise, or if any file is missing/unreadable/unwritable,
    /// or if `newDisplayName` is blank once sanitized — a display-name rename must never fail or
    /// throw because of this.
    public static func propagateIfUntitled(
        newDisplayName: String,
        siteDirectory: URL,
        fileManager: FileManager = .default
    ) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        guard fileManager.fileExists(atPath: configURL.path),
              let config = try? String(contentsOf: configURL, encoding: .utf8) else { return }

        guard SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == nil,
              SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == nil else { return }

        guard let currentSiteName = SiteConfigFile.value(forKey: "SITE_NAME", in: config),
              let currentProjectName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config),
              currentProjectName == SiteSlug.derive(from: currentSiteName) else { return }

        // .site-config only stores single-line `KEY=value` entries — take the first line only, so
        // an embedded newline in newDisplayName (e.g. from a hand-edited plist string) can't
        // inject extra lines into this git-tracked file.
        let sanitizedName = (newDisplayName.components(separatedBy: .newlines).first ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sanitizedName.isEmpty else { return }

        let newSlug = SiteSlug.derive(from: sanitizedName)
        guard WorkerComposition.isValidSiteName(newSlug) else { return }

        // .site-config first: it's what DeployCoordinator.resolveWorkerSiteName actually reads at
        // publish time, so if the wrangler.toml write below fails, the site still deploys under
        // the new slug rather than silently keeping the stale one.
        let updatedConfig = SiteConfigFile.upsert(
            [("SITE_NAME", sanitizedName), ("CF_PROJECT_NAME", newSlug)],
            into: config
        )
        try? updatedConfig.write(to: configURL, atomically: true, encoding: .utf8)

        let wranglerURL = siteDirectory.appendingPathComponent("wrangler.toml")
        guard fileManager.fileExists(atPath: wranglerURL.path),
              let toml = try? String(contentsOf: wranglerURL, encoding: .utf8) else { return }
        var lines = toml.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let nameLineIndex = lines.firstIndex(where: { $0.hasPrefix("name = \"") }) else { return }
        lines[nameLineIndex] = "name = \"\(newSlug)\""
        try? lines.joined(separator: "\n").write(to: wranglerURL, atomically: true, encoding: .utf8)
    }
}
