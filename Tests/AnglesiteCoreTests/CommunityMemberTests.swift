import Testing
import Foundation
@testable import AnglesiteCore

@Suite("CommunityMember")
struct CommunityMemberTests {
    @Test("round-trips through JSON encoding")
    func jsonRoundTrip() throws {
        let member = try CommunityMember(
            id: "member-abc123",
            actorURL: URL(string: "https://member.example/actor")!,
            name: "Jane Doe",
            photo: URL(string: "https://member.example/photo.jpg")
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(member)
        let decoded = try JSONDecoder().decode(CommunityMember.self, from: data)
        #expect(decoded == member)
    }

    @Test("gitPath produces the expected file path")
    func gitPath() throws {
        let member = try CommunityMember(
            id: "member-abc123", actorURL: URL(string: "https://member.example/actor")!,
            name: nil, photo: nil)
        #expect(member.gitPath == "data/community-members/member-abc123.json")
    }

    @Test("rejects IDs containing path-traversal sequences")
    func rejectsPathTraversal() {
        #expect(throws: CommunityMember.ValidationError.self) {
            try CommunityMember(
                id: "../../etc/passwd", actorURL: URL(string: "https://member.example/actor")!,
                name: nil, photo: nil)
        }
    }

    @Test("rejects an actorURL with a non-http(s) scheme")
    func rejectsInsecureActorURL() {
        #expect(throws: CommunityMember.ValidationError.self) {
            try CommunityMember(
                id: "member-abc123", actorURL: URL(string: "javascript:alert(document.cookie)")!,
                name: nil, photo: nil)
        }
    }

    @Test("rejects a photo with a non-http(s) scheme")
    func rejectsInsecurePhotoURL() {
        #expect(throws: CommunityMember.ValidationError.self) {
            try CommunityMember(
                id: "member-abc123", actorURL: URL(string: "https://member.example/actor")!,
                name: "Evil", photo: URL(string: "javascript:alert(1)"))
        }
    }

    @Test("accepts a plain http (not just https) actorURL")
    func acceptsPlainHTTP() throws {
        let member = try CommunityMember(
            id: "member-abc123", actorURL: URL(string: "http://member.example/actor")!,
            name: "Jane", photo: nil)
        #expect(member.actorURL.scheme == "http")
    }

    @Test("name and photo are optional")
    func optionalFields() throws {
        let member = try CommunityMember(
            id: "member-abc123", actorURL: URL(string: "https://member.example/actor")!,
            name: nil, photo: nil)
        #expect(member.name == nil)
        #expect(member.photo == nil)
    }
}
