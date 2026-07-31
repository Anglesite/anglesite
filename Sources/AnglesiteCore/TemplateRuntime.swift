import Foundation

/// Locates the website template that ships with the app.
///
/// The template (Astro project skeleton, themes, scaffold script, pre-deploy check) is committed
/// directly to this repo at `Resources/Template/`. It was previously part of the sibling plugin
/// checkout and bundled at build time — now it's a first-class app resource.
///
/// The Settings → Advanced → Template path override lets template authors point a running app at
/// a working copy without rebuilding.
public enum TemplateRuntime {
    /// The outcome of one template lookup — the location *and* its provenance, so callers can
    /// log or display which copy of the template a site is actually using (a dev override
    /// silently shadowing the bundle would otherwise be invisible).
    public struct Resolution: Sendable, Equatable {
        /// Where the template came from, in the priority order ``TemplateRuntime/resolve(settings:bundle:)`` tries.
        public enum Source: Sendable, Equatable {
            /// The Settings → Advanced template path override — a template author's working
            /// copy, honored ahead of the bundled copy so edits show up without rebuilding.
            case override(URL)
            /// The committed template shipped in the app bundle (`Resources/Template/`) — the
            /// normal case for every end user.
            case bundled(URL)
            /// Neither candidate held a valid template (broken install, or a stale override
            /// with no bundled fallback) — callers must surface this, not scaffold from nothing.
            case missing
        }

        /// Which candidate won (or that none did).
        public let source: Source

        /// The resolved template root, or `nil` when no valid template was found — the
        /// provenance-free accessor for callers that only need a working directory.
        public var url: URL? {
            switch source {
            case .override(let url), .bundled(let url): return url
            case .missing: return nil
            }
        }

        /// Human-readable provenance ("override: …" / "bundled: …" / "not found") for logs and
        /// diagnostics.
        public var description: String {
            switch source {
            case .override(let url): return "override: \(url.path)"
            case .bundled(let url):  return "bundled: \(url.path)"
            case .missing:           return "not found"
            }
        }
    }

    /// Resolves the template root, preferring a *valid* Settings override over the bundled copy.
    /// An override that no longer passes ``isTemplateDirectory(_:)`` (moved, deleted, or never a
    /// template) is skipped in favor of the bundle rather than treated as an error — a stale dev
    /// override must never break template resolution for a working app. Both parameters default
    /// to the live app values; they're injectable for tests.
    public static func resolve(settings: AppSettings = .shared, bundle: Bundle = .main) -> Resolution {
        if let override = settings.templatePathOverride, isTemplateDirectory(override) {
            return Resolution(source: .override(override))
        }
        if let bundled = bundledURL(in: bundle), isTemplateDirectory(bundled) {
            return Resolution(source: .bundled(bundled))
        }
        return Resolution(source: .missing)
    }

    /// The `Template/` directory inside the bundle's resources, or `nil` when the bundle has no
    /// such directory at all. This only checks existence-as-directory; ``resolve(settings:bundle:)``
    /// separately validates that it actually *is* the template via ``isTemplateDirectory(_:)``.
    public static func bundledURL(in bundle: Bundle = .main) -> URL? {
        guard let resourceURL = bundle.resourceURL else { return nil }
        let candidate = resourceURL.appendingPathComponent("Template", isDirectory: true)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue else {
            return nil
        }
        return candidate
    }

    /// True if `url` looks like the Anglesite website template — has the scaffold script and themes.
    public static func isTemplateDirectory(_ url: URL) -> Bool {
        let themes = url.appendingPathComponent("scripts/themes.ts")
        return FileManager.default.fileExists(atPath: themes.path)
    }
}
