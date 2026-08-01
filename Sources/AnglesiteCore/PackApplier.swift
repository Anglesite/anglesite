import Foundation

/// Copies a theme pack's overlay (`packs/<id>/` in the template) over a freshly scaffolded
/// site. Scaffold-time only: after the copy the site is just "the chassis with different
/// files" — no pack concept remains in the site
/// (spec: docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §3).
public enum PackApplier {
    /// Failure cases for ``apply(packNamed:templateURL:siteDirectory:fileManager:)``.
    public enum PackError: Error, Sendable {
        /// `packs/<id>` isn't in the template — the associated value is the path checked.
        case packNotFound(String)
    }

    /// Site-root file the pack's `LICENSE` is copied to, so the MIT attribution travels
    /// with the site's git repo rather than staying behind in the app bundle.
    public static let licenseFileName = "THEME-LICENSE"

    /// Overlays `packs/<pack>/src/**` onto `<siteDirectory>/src/` (per-file replace, never
    /// deletes site files the pack doesn't override) and copies the pack's `LICENSE` to
    /// ``licenseFileName``. Throws ``PackError/packNotFound(_:)`` when the pack directory
    /// is absent; a pack without `src/` or `LICENSE` copies whatever it does have.
    public static func apply(packNamed pack: String, templateURL: URL, siteDirectory: URL,
                             fileManager: FileManager = .default) throws {
        let packDir = templateURL.appendingPathComponent("packs/\(pack)", isDirectory: true)
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: packDir.path, isDirectory: &isDir), isDir.boolValue else {
            throw PackError.packNotFound(packDir.path)
        }
        let srcRoot = packDir.appendingPathComponent("src", isDirectory: true)
        if fileManager.fileExists(atPath: srcRoot.path) {
            try copyTree(from: srcRoot,
                         to: siteDirectory.appendingPathComponent("src", isDirectory: true),
                         fileManager: fileManager)
        }
        let license = packDir.appendingPathComponent("LICENSE")
        if fileManager.fileExists(atPath: license.path) {
            try replaceFile(at: siteDirectory.appendingPathComponent(licenseFileName),
                            with: license, fileManager: fileManager)
        }
    }

    private static func copyTree(from source: URL, to destination: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        for name in try fileManager.contentsOfDirectory(atPath: source.path) where name != ".DS_Store" {
            let src = source.appendingPathComponent(name)
            let dst = destination.appendingPathComponent(name)
            var isDir: ObjCBool = false
            fileManager.fileExists(atPath: src.path, isDirectory: &isDir)
            if isDir.boolValue {
                try copyTree(from: src, to: dst, fileManager: fileManager)
            } else {
                try replaceFile(at: dst, with: src, fileManager: fileManager)
            }
        }
    }

    private static func replaceFile(at destination: URL, with source: URL, fileManager: FileManager) throws {
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: source, to: destination)
    }
}
