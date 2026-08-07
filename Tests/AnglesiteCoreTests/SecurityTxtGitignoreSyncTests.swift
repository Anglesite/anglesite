import Testing
@testable import AnglesiteCore

@Suite struct SecurityTxtGitignoreSyncTests {
    @Test func addingToEmptyContentsWritesHeaderAndLine() {
        let result = SecurityTxtGitignoreSync.addingIgnoreEntry(to: "")
        #expect(result == "# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\n")
    }

    @Test func addingAppendsAfterExistingContentWithoutTouchingIt() {
        let existing = "node_modules/\ndist/\n"
        let result = SecurityTxtGitignoreSync.addingIgnoreEntry(to: existing)
        #expect(result == "node_modules/\ndist/\n\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\n")
    }

    @Test func addingIsANoOpWhenAlreadyPresent() {
        let existing = "node_modules/\npublic/.well-known/security.txt\n"
        #expect(SecurityTxtGitignoreSync.addingIgnoreEntry(to: existing) == existing)
    }

    @Test func removingDropsOnlyTheOneLine() {
        let existing = "node_modules/\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\npublic/.well-known/mta-sts.txt\n"
        let result = SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing)
        #expect(result == "node_modules/\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/mta-sts.txt\n")
    }

    @Test func removingIsANoOpWhenAbsent() {
        let existing = "node_modules/\n"
        #expect(SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing) == existing)
    }

    @Test func removingFromContentsThatBecomeEmptyReturnsEmptyString() {
        let existing = "public/.well-known/security.txt\n"
        #expect(SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing) == "")
    }
}
