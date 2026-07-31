import Foundation

/// Deterministic handling for an optional owner-supplied logo selected in the new-site wizard.
public enum LogoAsset {
    /// Where the copied logo lands inside the site. Astro serves `public/` verbatim at the
    /// site root, which is what makes ``publicURLPath(for:)`` a valid served path.
    public static let assetDirectoryRelativePath = "public"

    /// Why ``LogoAsset/install(from:siteName:siteDirectory:fileManager:)`` can fail; each case
    /// carries the URL that was checked so the error is actionable.
    public enum InstallError: Error, Sendable {
        /// The wizard-selected logo file no longer exists at the remembered URL.
        case sourceLogoNotFound(URL)
        /// The scaffolded homepage (`src/pages/index.astro`) is missing, so there is nowhere
        /// to insert the logo markup.
        case homepageNotFound(URL)
    }

    /// Canonical destination file name: always `logo` plus the source's lowercased extension,
    /// so installing a replacement logo overwrites the old file rather than accumulating one
    /// per install.
    public static func fileName(for logoURL: URL) -> String {
        let ext = logoURL.pathExtension.trimmingCharacters(in: .whitespacesAndNewlines)
        return ext.isEmpty ? "logo" : "logo.\(ext.lowercased())"
    }

    /// The root-relative URL path the installed logo is served at (`public/` maps to `/`).
    public static func publicURLPath(for logoURL: URL) -> String {
        "/\(fileName(for: logoURL))"
    }

    /// Inserts a `site-logo` `<img>` immediately after the template's hero open line.
    /// Deterministic and idempotent by construction: it returns `source` unchanged when the
    /// hero anchor is missing (a customized homepage the app shouldn't guess about) or a
    /// `site-logo` image is already present, so re-running never duplicates markup.
    public static func insertLogo(into source: String, urlPath: String, alt: String) -> String {
        guard source.contains(HeroImage.heroOpenLine) else { return source }
        guard !source.contains(#"class="site-logo""#) else { return source }
        let img = #"<img src="\#(HeroImage.attr(urlPath))" alt="\#(HeroImage.attr(alt))" class="site-logo" />"#
        return source.replacingOccurrences(of: HeroImage.heroOpenLine, with: HeroImage.heroOpenLine + "\n      " + img)
    }

    /// Copies the logo into `public/` and patches the homepage to reference it, returning the
    /// served URL path. Copy-then-patch ordering means a homepage failure never leaves markup
    /// pointing at a file that was never installed; the homepage write is skipped when
    /// ``insertLogo(into:urlPath:alt:)`` made no change, keeping a re-run diff-free.
    /// - Throws: ``InstallError`` when the source logo or the homepage is missing.
    public static func install(from logoURL: URL, siteName: String,
                               siteDirectory: URL, fileManager: FileManager = .default) throws -> String {
        guard fileManager.fileExists(atPath: logoURL.path) else {
            throw InstallError.sourceLogoNotFound(logoURL)
        }

        let publicDir = siteDirectory.appendingPathComponent(assetDirectoryRelativePath, isDirectory: true)
        try fileManager.createDirectory(at: publicDir, withIntermediateDirectories: true)
        let dest = publicDir.appendingPathComponent(fileName(for: logoURL))
        if dest.standardizedFileURL != logoURL.standardizedFileURL {
            if fileManager.fileExists(atPath: dest.path) { try fileManager.removeItem(at: dest) }
            try fileManager.copyItem(at: logoURL, to: dest)
        }

        let publicPath = publicURLPath(for: logoURL)
        let homepage = siteDirectory.appendingPathComponent("src/pages/index.astro")
        guard fileManager.fileExists(atPath: homepage.path) else {
            throw InstallError.homepageNotFound(homepage)
        }
        let src = try String(contentsOf: homepage, encoding: .utf8)
        let patched = insertLogo(into: src, urlPath: publicPath, alt: "\(siteName) logo")
        if patched != src {
            try patched.write(to: homepage, atomically: true, encoding: .utf8)
        }
        return publicPath
    }
}
