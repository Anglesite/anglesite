#if canImport(Darwin)
import Foundation

/// Resolves an iCloud ubiquity container URL. A thin seam over
/// `FileManager.url(forUbiquityContainerIdentifier:)` (#865) so callers — `AppSettings.sitesRoot`
/// today — can be tested against both "iCloud available" and "iCloud unavailable" (not signed in,
/// iCloud Drive off, or the container's entitlement/provisioning isn't present — true of every
/// ad-hoc-signed Debug build, which has no Team ID) deterministically, without depending on the
/// real iCloud account state of the machine running the test. Darwin-only: this `FileManager`
/// method doesn't exist in swift-corelibs-foundation, and `AnglesiteCore` also builds on Linux.
public protocol UbiquityContainerResolving {
    /// Mirrors `FileManager`'s method of the same name: returns the container's root URL, or
    /// `nil` when the container isn't available for any reason. `containerIdentifier: nil` means
    /// "the app's first `com.apple.developer.icloud-container-identifiers` entry".
    func url(forUbiquityContainerIdentifier containerIdentifier: String?) -> URL?
}

extension FileManager: UbiquityContainerResolving {}
#endif
