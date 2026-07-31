import Foundation

/// The running app's short version string (`CFBundleShortVersionString`), used to
/// stamp/compare against a site's `.site-config` `ANGLESITE_VERSION` (spec §3.1).
public enum AppVersion {
    /// Reads the short version string from `bundle`. Optional because a SwiftPM test bundle (or
    /// any non-app host) has no `CFBundleShortVersionString` — callers must treat "unknown
    /// version" as a real case, not force-unwrap. The `bundle` parameter exists for exactly that
    /// test seam; production uses the default `.main`.
    public static func current(in bundle: Bundle = .main) -> String? {
        bundle.infoDictionary?["CFBundleShortVersionString"] as? String
    }
}
