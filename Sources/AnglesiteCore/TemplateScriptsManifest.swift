import Foundation

/// Enumerates the exact set of files `scripts/scaffold.sh`'s `rsync` copies from
/// `Resources/Template/scripts/` into a scaffolded site — the "app-owned" set this refresh
/// mechanism keeps current (design doc §Scope). Mirrors `scaffold.sh`'s own exclude list
/// (`Resources/Template/scripts/scaffold.sh:40-46`) rather than re-parsing the shell script; the
/// two lists are kept in sync by hand, the same way every other template-path consumer
/// (`TemplateRuntime`, `ThemeCatalog`) already duplicates path knowledge rather than sharing it
/// with the shell script.
public enum TemplateScriptsManifest {
    /// Names excluded only when they sit directly inside `scripts/` itself — matches rsync's own
    /// anchoring rules for a pattern containing a slash (`scripts/themes.ts` does not match
    /// `scripts/embeds/themes.ts`). The `.test.ts` suffix exclusion below is applied with the same
    /// top-level-only restriction, deliberately reproducing the anchoring quirk `scaffold.sh` has
    /// today (design doc §Scope) rather than silently fixing it as a side effect of this feature.
    private static let topLevelExcludedNames: Set<String> = ["scaffold.sh", "themes.ts", "themes.json"]

    /// Relative paths (e.g. `"scripts/pre-deploy-check.ts"`, `"scripts/embeds/adapters.ts"`),
    /// sorted for deterministic iteration order. Returns `[]` if `templateRoot/scripts` doesn't
    /// exist or can't be enumerated.
    public static func appOwnedRelativePaths(templateRoot: URL) -> [String] {
        let scriptsRoot = templateRoot.appendingPathComponent("scripts")
        guard let enumerator = FileManager.default.enumerator(
            at: scriptsRoot,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        let scriptsRootPath = scriptsRoot.standardizedFileURL.path
        var results: [String] = []
        for case let fileURL as URL in enumerator {
            let isDirectory = (try? fileURL.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory { continue }

            let standardizedPath = fileURL.standardizedFileURL.path
            guard standardizedPath.hasPrefix(scriptsRootPath + "/") else { continue }
            let relativeToScripts = String(standardizedPath.dropFirst(scriptsRootPath.count + 1))

            let isTopLevel = !relativeToScripts.contains("/")
            if isTopLevel && topLevelExcludedNames.contains(relativeToScripts) { continue }
            if isTopLevel && relativeToScripts.hasSuffix(".test.ts") { continue }

            results.append("scripts/" + relativeToScripts)
        }
        return results.sorted()
    }
}
