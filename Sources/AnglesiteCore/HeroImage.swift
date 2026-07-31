import Foundation

/// Deterministic, OS-API-free logic for the optional "Generate hero image" feature (#92).
///
/// The actual pixels come from Apple Intelligence's Image Playground (an OS API invoked from the
/// app target, gated by availability). Everything that *can* be unit-tested lives here: building
/// the generation concepts from the draft, resolving where the file is saved in the Astro project,
/// and patching the homepage to reference it. No Claude / LLM tokens are involved.
public enum HeroImage {
    /// Where a generated image belongs in an Astro project. We save to `public/` because the
    /// scaffolded `index.astro` references it with a root-relative URL (`/hero.png`), which needs
    /// no bundler import; `src/assets/` would require an `import` + `<Image>` rewrite.
    public static let assetDirectoryRelativePath = "public"

    /// Stable filename for the generated hero image (PNG — Image Playground emits PNG).
    public static let fileName = "hero.png"

    /// Root-relative URL the homepage uses to reference the saved image.
    public static var publicURLPath: String { "/\(fileName)" }

    /// Relative path (from the site `Source/` dir) of the saved image file.
    public static var assetRelativePath: String { "\(assetDirectoryRelativePath)/\(fileName)" }

    /// Build the natural-language concepts handed to `ImagePlaygroundConcept.text(_:)`.
    ///
    /// Image Playground works best with short, descriptive phrases rather than one long sentence.
    /// Avoid words such as "website", "screen", and "interface" in the default concepts because
    /// they often produce a fake UI screenshot rather than an image that works as a page hero.
    public static func concepts(name: String, siteType: SiteType, tagline: String, imageDescription: String = "") -> [String] {
        var out: [String] = []
        let custom = imageDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let t = tagline.trimmingCharacters(in: .whitespacesAndNewlines)
        if !custom.isEmpty {
            out.append(custom)
        } else if !isGenericSiteName(n) {
            out.append(n)
        }
        out.append(styleHint(for: siteType))
        if !t.isEmpty { out.append(t) }
        out.append("wide decorative header background")
        out.append("no text, no letters, no website interface")
        return out
    }

    /// A single concatenated prompt string, for the fallback `extracted(from:)` text path and
    /// for logging. Concepts joined with commas.
    public static func prompt(name: String, siteType: SiteType, tagline: String, imageDescription: String = "") -> String {
        concepts(name: name, siteType: siteType, tagline: tagline, imageDescription: imageDescription).joined(separator: ", ")
    }

    /// Per-type visual styling hint that keeps the generated image on-brand.
    static func styleHint(for siteType: SiteType) -> String {
        switch siteType {
        case .business:     return "modern professional abstract illustration"
        case .personal:     return "warm friendly personal abstract illustration"
        case .blog:         return "editorial abstract header illustration"
        case .portfolio:    return "creative abstract portfolio illustration"
        case .organization: return "welcoming community abstract illustration"
        case .blank:        return "simple abstract geometric illustration"
        }
    }

    private static func isGenericSiteName(_ name: String) -> Bool {
        let normalized = name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return normalized.isEmpty || normalized == "my website" || normalized == "a website" || normalized == "website"
    }

    /// The exact hero `<section>` the template ships, anchoring a targeted (non-fuzzy) insert.
    static let heroOpenLine = #"<section class="hero">"#

    /// Inserts a hero `<img>` right after the opening `<section class="hero">` tag.
    ///
    /// Idempotent: if an `<img>` already references `publicURLPath`, the source is returned
    /// unchanged. Returns the input untouched if the anchor isn't present (the template drifted),
    /// so this is always safe to run.
    public static func insertHeroImage(into source: String,
                                       urlPath: String = publicURLPath,
                                       alt: String) -> String {
        guard source.contains(heroOpenLine) else { return source }
        guard !source.contains(#"src="\#(urlPath)""#) else { return source }
        let img = #"<img src="\#(urlPath)" alt="\#(attr(alt))" class="hero-image" />"#
        if let logoRange = source.range(of: #"<img[^>]*class="site-logo"[^>]*>"#, options: .regularExpression) {
            return source.replacingCharacters(in: logoRange, with: String(source[logoRange]) + "\n      " + img)
        }
        return source.replacingOccurrences(of: heroOpenLine, with: heroOpenLine + "\n      " + img)
    }

    /// Escape for a double-quoted HTML attribute.
    static func attr(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// Failures from ``HeroImage/install(from:headline:siteName:siteDirectory:fileManager:)``. Hero
    /// generation is an optional scaffolder step, so callers surface these as warnings, never as
    /// scaffold failures.
    public enum InstallError: Error, Sendable {
        /// The generated image isn't at the URL Image Playground reported — nothing to copy.
        case sourceImageNotFound(URL)
        /// `src/pages/index.astro` is missing, so there's no homepage to patch. A *drifted* (but
        /// present) homepage is not an error — the anchor-guarded patch just no-ops.
        case homepageNotFound(URL)
    }

    /// Copy a generated image into the site's `public/` dir and patch the homepage to reference it.
    ///
    /// Non-destructive: the copy overwrites a prior `hero.png`, and the homepage patch is
    /// idempotent + anchor-guarded (a no-op if the template drifted). Run as an optional,
    /// non-blocking scaffolder step — any throw is surfaced as a warning, not a failure.
    public static func install(from imageURL: URL, headline: String, siteName: String,
                               siteDirectory: URL, fileManager: FileManager = .default) throws {
        guard fileManager.fileExists(atPath: imageURL.path) else {
            throw InstallError.sourceImageNotFound(imageURL)
        }
        let publicDir = siteDirectory.appendingPathComponent(assetDirectoryRelativePath, isDirectory: true)
        try fileManager.createDirectory(at: publicDir, withIntermediateDirectories: true)
        let dest = publicDir.appendingPathComponent(fileName)
        if fileManager.fileExists(atPath: dest.path) { try fileManager.removeItem(at: dest) }
        try fileManager.copyItem(at: imageURL, to: dest)

        // Patch the homepage. Missing homepage is a hard error here (caller treats as warning);
        // an unmatched anchor is a silent no-op via insertHeroImage.
        let homepage = siteDirectory.appendingPathComponent("src/pages/index.astro")
        guard fileManager.fileExists(atPath: homepage.path) else {
            throw InstallError.homepageNotFound(homepage)
        }
        let alt = headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? siteName : headline
        let src = try String(contentsOf: homepage, encoding: .utf8)
        let patched = insertHeroImage(into: src, alt: alt)
        if patched != src {
            try patched.write(to: homepage, atomically: true, encoding: .utf8)
        }
    }
}
