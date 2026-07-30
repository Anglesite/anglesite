import XCTest
@testable import AnglesiteCore

final class SecurityScopedBookmarkTests: XCTestCase {
    /// On non-sandboxed test runs, bookmarks created with .withSecurityScope still produce
    /// resolvable Data; they just don't actually scope anything. That's enough to verify the
    /// create/resolve round-trip on the SPM test runner.
    func test_create_and_resolve_roundTrip() throws {
        let tmp = try FileManager.default.url(
            for: .itemReplacementDirectory,
            in: .userDomainMask,
            appropriateFor: URL(fileURLWithPath: "/tmp"),
            create: true
        )
        defer { try? FileManager.default.removeItem(at: tmp) }

        let bookmark = try SecurityScopedBookmark.create(for: tmp)
        XCTAssertFalse(bookmark.isEmpty)

        let resolved = try SecurityScopedBookmark.resolve(bookmark)
        XCTAssertEqual(
            resolved.url.standardizedFileURL.resolvingSymlinksInPath().path,
            tmp.standardizedFileURL.resolvingSymlinksInPath().path
        )
        XCTAssertFalse(resolved.isStale)
    }

    func test_resolve_corruptData_throws() {
        let garbage = Data([0x01, 0x02, 0x03, 0x04])
        XCTAssertThrowsError(try SecurityScopedBookmark.resolve(garbage))
    }

    /// #1068: without `LocalizedError` conformance, `.localizedDescription` on this enum bridges
    /// to a generic NSError ("The operation couldn't be completed. (AnglesiteCore.
    /// SecurityScopedBookmarkError error 0.)") and silently drops the actual underlying reason —
    /// exactly the message users saw in the bug report, on both the recovery ("Locate…") and
    /// brand-new-site paths.
    func test_createFailed_localizedDescription_surfacesUnderlyingMessage() {
        let error: Error = SecurityScopedBookmarkError.createFailed("the real underlying reason")
        XCTAssertEqual(error.localizedDescription, "the real underlying reason")
    }

    func test_resolveFailed_localizedDescription_surfacesUnderlyingMessage() {
        let error: Error = SecurityScopedBookmarkError.resolveFailed("the real underlying reason")
        XCTAssertEqual(error.localizedDescription, "the real underlying reason")
    }
}
