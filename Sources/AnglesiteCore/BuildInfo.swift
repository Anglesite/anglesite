import Foundation

/// Compile-time build identity — the "which build am I looking at" values the About panel and
/// diagnostics render. Lives in AnglesiteCore (not the app target) so it's available without a
/// bundle, e.g. under SwiftPM tests, where `Bundle.main` metadata doesn't exist.
public enum BuildInfo {
    /// The product name as shown in the About panel. A literal rather than a `Bundle` lookup so
    /// it holds anywhere this module runs, bundle or not.
    public static let appName = "Anglesite"
    /// Current build-plan phase. Bump manually at each phase milestone (tracked in
    /// docs/build-plan.md).
    public static let phase = "10"

    /// One-line identity string for logs and diagnostics: app name, phase, and the host OS
    /// version. Computed (not stored) so the OS version reflects the machine it runs on rather
    /// than a build-time snapshot.
    public static var summary: String {
        "\(appName) · phase \(phase) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
    }
}
