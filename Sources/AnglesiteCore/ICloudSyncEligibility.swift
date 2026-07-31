#if canImport(Darwin)
import Foundation
import AnglesiteSiteModel

/// Whether a `.anglesite` package should ever get a `SyncScheduler`/`SyncEngine` at all (#881,
/// design doc §5): only a package that actually lives in iCloud Drive. A plain local package
/// (anywhere outside an iCloud container, including the `~/Sites/` fallback used when iCloud is
/// unavailable) has no `source.bundle` peer to sync with, and — per #881's acceptance criteria —
/// must see **zero** sync activity, not merely a quiet one. Since #865 defaults new sites *into*
/// the iCloud container, this is now `true` for most sites rather than only deliberately-relocated
/// ones. The app layer checks this once per site open/relocate
/// and only constructs sync machinery when it's `true`; `SyncScheduler` itself has no idea this
/// check exists.
public enum ICloudSyncEligibility {
    /// `true` when `package.url` is inside a ubiquity container (`FileManager.isUbiquitousItem`).
    /// A package that hasn't finished being indexed by iCloud yet (freshly moved into Drive) can
    /// transiently answer `false`; callers re-check on the next site open rather than caching this
    /// for a window's whole lifetime.
    public static func isEligible(package: AnglesitePackage, fileManager: FileManager = .default) -> Bool {
        fileManager.isUbiquitousItem(at: package.url)
    }
}
#endif
