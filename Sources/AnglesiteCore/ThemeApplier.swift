import Foundation

/// Applies a `Theme` to a site's `src/styles/global.css` by rewriting the values of the
/// `--<key>` custom properties the theme provides. Properties without a matching theme key
/// (spacing, radius, shadows, type scale) are left untouched. Pure + idempotent.
public enum ThemeApplier {
    /// Failure modes for the file-writing overload.
    public enum ApplyError: Error, Sendable {
        /// `src/styles/global.css` doesn't exist at the expected path — the site isn't a
        /// recognizable template layout, so nothing is written rather than creating a stray file.
        case cssNotFound(URL)
    }

    /// The pure string transform: rewrites each `--<key>` declaration's value in `css` to the
    /// theme's. Split out from the file overload so it's testable without a filesystem. Assumes
    /// one declaration per line ending in `;` (true of all template-generated `global.css`
    /// files); unknown theme keys and unmatched properties pass through untouched.
    public static func apply(_ theme: Theme, toCSS css: String) -> String {
        var result = css
        for (key, value) in theme.cssVars {
            // Match `--key:` then everything up to the line-ending `;`, replace the value.
            // Pattern assumes one declaration per line with a trailing `;` (true of all
            // Astro-generated global.css files); multi-line values are intentionally not matched.
            let pattern = "(--" + NSRegularExpression.escapedPattern(for: key) + ":)[^;\\n]*;"
            guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
            let ns = result as NSString
            // `$1` keeps `--key:`; template is literal so escape backslashes/$ in the value.
            let safeValue = value.replacingOccurrences(of: "\\", with: "\\\\")
                                 .replacingOccurrences(of: "$", with: "\\$")
            result = re.stringByReplacingMatches(
                in: result,
                range: NSRange(location: 0, length: ns.length),
                withTemplate: "$1 " + safeValue + ";"
            )
        }
        return result
    }

    /// Rewrites `siteDirectory`'s `src/styles/global.css` in place via ``apply(_:toCSS:)``.
    /// Throws ``ApplyError/cssNotFound(_:)`` rather than creating the file — a missing
    /// `global.css` means this isn't a template-shaped site, and writing one wouldn't be loaded
    /// by anything.
    public static func apply(_ theme: Theme, siteDirectory: URL, fileManager: FileManager = .default) throws {
        let cssURL = siteDirectory.appendingPathComponent("src/styles/global.css")
        guard fileManager.fileExists(atPath: cssURL.path) else {
            throw ApplyError.cssNotFound(cssURL)
        }
        let css = try String(contentsOf: cssURL, encoding: .utf8)
        let updated = apply(theme, toCSS: css)
        try updated.write(to: cssURL, atomically: true, encoding: .utf8)
    }
}
