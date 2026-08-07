import Foundation

/// Narrow `.gitignore` migration for `public/.well-known/security.txt` — the one entry the
/// security.txt Adopt/Preserve decision needs (design doc "`.gitignore` migration"). Purely
/// additive on adopt, mirroring `SiteActions.ensureImportGitignore`'s pattern (header comment
/// plus the missing line, nothing else ever touched, never rewritten if already present). The one
/// deliberate exception is ``removingIgnoreEntry(from:)``, which drops exactly that one line when
/// a legacy file is classified as hand-authored, so it can actually be committed — "Preserve...
/// makes the file normally git-trackable" is false if it silently stays ignored.
public enum SecurityTxtGitignoreSync {
    private static let ignoredPath = "public/.well-known/security.txt"
    private static let header =
        "# Generated at build by scripts/edge-artifacts.ts (Expires changes every build)."

    /// Adds the header comment and ignore line if `ignoredPath` isn't already listed on its own
    /// line; returns `contents` byte-for-byte unchanged otherwise.
    public static func addingIgnoreEntry(to contents: String) -> String {
        var lines = normalizedLines(contents)
        guard !lines.contains(ignoredPath) else { return contents }
        if !lines.isEmpty { lines.append("") }
        lines.append(header)
        lines.append(ignoredPath)
        return lines.joined(separator: "\n") + "\n"
    }

    /// Removes exactly the `ignoredPath` line, if present; every other line — including the
    /// header comment, even if it becomes orphaned — is left untouched. Returns `contents`
    /// byte-for-byte unchanged if the line isn't there.
    public static func removingIgnoreEntry(from contents: String) -> String {
        var lines = normalizedLines(contents)
        guard lines.contains(ignoredPath) else { return contents }
        lines.removeAll { $0 == ignoredPath }
        return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    }

    /// Splits into lines with a normalized (absent) trailing empty element, so both functions can
    /// append/join without producing a doubled blank line at the end.
    private static func normalizedLines(_ contents: String) -> [String] {
        var lines = contents.isEmpty ? [] : contents.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        return lines
    }
}
