import Testing
@testable import AnglesiteCore

@Suite("DisplayString")
struct DisplayStringTests {
    @Test("removes a right-to-left override character")
    func removesRightToLeftOverride() throws {
        let poisoned = "alice\u{202E}evil"
        #expect(DisplayString.safe(poisoned) == "aliceevil")
    }

    @Test("removes bidi isolate control characters")
    func removesBidiIsolates() throws {
        let poisoned = "\u{2066}alice\u{2069}"
        #expect(DisplayString.safe(poisoned) == "alice")
    }

    @Test("removes left-to-right and right-to-left marks")
    func removesDirectionalMarks() throws {
        let poisoned = "a\u{200E}b\u{200F}c"
        #expect(DisplayString.safe(poisoned) == "abc")
    }

    @Test("removes soft hyphen")
    func removesSoftHyphen() throws {
        let poisoned = "soft\u{00AD}hyphen"
        #expect(DisplayString.safe(poisoned) == "softhyphen")
    }

    @Test("leaves ordinary ASCII text untouched")
    func leavesAsciiUntouched() throws {
        #expect(DisplayString.safe("alice") == "alice")
    }

    @Test("leaves non-ASCII international text untouched")
    func leavesInternationalTextUntouched() throws {
        #expect(DisplayString.safe("José") == "José")
    }

    @Test("leaves emoji untouched")
    func leavesEmojiUntouched() throws {
        #expect(DisplayString.safe("alice🐘") == "alice🐘")
    }

    @Test("returns empty string when input is entirely format characters")
    func returnsEmptyForAllFormatCharacters() throws {
        let poisoned = "\u{202E}\u{2066}\u{2069}"
        #expect(DisplayString.safe(poisoned) == "")
    }
}
