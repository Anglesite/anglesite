#if canImport(Darwin)
import Testing
import Foundation
@testable import AnglesiteCore

@Test("FileManager conforms to UbiquityContainerResolving")
func fileManagerConformsToUbiquityContainerResolving() {
    let resolver: UbiquityContainerResolving = FileManager.default
    // No real iCloud entitlement in the test bundle, so this must return nil rather than throw
    // or hang — the whole point of the seam is that AppSettings can treat "no entitlement" and
    // "not signed into iCloud" identically, as an ordinary nil result.
    #expect(resolver.url(forUbiquityContainerIdentifier: "iCloud.io.dwk.anglesite") == nil)
}
#endif
