import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel Inbox Capture toggle (#764)")
@MainActor
struct PlistEditorModelInboxCaptureTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private struct Fixture {
        let model: PlistEditorModel
        let configDirectory: URL
        let keychainService: String
    }

    private func makeFixture(
        settings: SiteSettings? = nil,
        token: String? = "test-token",
        proberTransport: @escaping CloudflareTransport = { _ in
            (Data(#"{"success":true,"result":[]}"#.utf8), HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelInboxCaptureTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let settings {
            try await SiteConfigStore(configDirectory: configDir).save(settings)
        }
        let keychainService = "io.dwk.anglesite.test-\(UUID().uuidString)"
        let keychain = KeychainStore(service: keychainService)
        if let token {
            try keychain.writeCloudflareToken(token)
        }
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            keychain: keychain,
            capabilityProber: CloudflareCapabilityProber(transport: proberTransport)
        )
        return Fixture(model: model, configDirectory: configDir, keychainService: keychainService)
    }

    @Test("turning on with a KV-capable token persists inboxCaptureEnabled")
    func turnOnWithCapableToken() async throws {
        let fixture = try await makeFixture(proberTransport: { request in
            let url = request.url!.absoluteString
            let body = url.contains("storage/kv/namespaces")
                ? #"{"success":true,"result":[]}"#
                : #"{"success":true,"result":[{"id":"acc1"}]}"#
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == true)
        #expect(fixture.model.inboxCaptureError == nil)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == true)
    }

    @Test("turning on with a KV-incapable token surfaces a friendly error and does not persist")
    func turnOnWithIncapableToken() async throws {
        let fixture = try await makeFixture(proberTransport: { request in
            let url = request.url!.absoluteString
            let (status, body): (Int, String) = url.contains("storage/kv/namespaces")
                ? (403, #"{"success":false}"#)
                : (200, #"{"success":true,"result":[{"id":"acc1"}]}"#)
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == false)
        #expect(fixture.model.inboxCaptureError != nil)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == nil)
    }

    @Test("turning off persists false and leaves provisionedWorkerResources untouched")
    func turnOff() async throws {
        let fixture = try await makeFixture(
            settings: SiteSettings(
                provisionedWorkerResources: .init(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1"),
                inboxCaptureEnabled: true
            ))
        await fixture.model.loadWorkers()

        await fixture.model.setInboxCaptureEnabled(false)

        #expect(fixture.model.inboxCaptureEnabled == false)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == false)
        #expect(saved.provisionedWorkerResources?.inboxKVNamespaceID == "ns-1")
        #expect(saved.provisionedWorkerResources?.inboxAccountID == "acct-1")
    }

    @Test("a save failure on turn-off surfaces an error and leaves the toggle state unchanged")
    func turnOffSaveFailure() async throws {
        let fixture = try await makeFixture(settings: SiteSettings(inboxCaptureEnabled: true))
        await fixture.model.loadWorkers()
        #expect(fixture.model.inboxCaptureEnabled == true)

        // Strip write permission from Config/ so `store.save`'s atomic write fails — same
        // technique NativeContentOperationsTests uses to force a real I/O failure rather than a
        // mocked one.
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o555], ofItemAtPath: fixture.configDirectory.path)
        defer {
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o755], ofItemAtPath: fixture.configDirectory.path)
        }

        await fixture.model.setInboxCaptureEnabled(false)

        #expect(fixture.model.inboxCaptureError != nil)
        #expect(fixture.model.inboxCaptureEnabled == true)
    }

    @Test("without a token, leaves the toggle off with an error and makes no capability-probe call")
    func turnOnWithoutToken() async throws {
        // `cloudflareToken()` falls back to the process-wide `CLOUDFLARE_API_TOKEN` env var when
        // the keychain is empty. A couple of sibling test files (DomainConfigAuditModelTests,
        // OnionRoutingModelTests) `setenv` that var without restoring it, and Swift Testing runs
        // same-target tests concurrently in one process — so without this save/clear/restore,
        // this test is flaky under a full-suite parallel run whenever one of those leaks the var
        // into this test's window.
        let previousEnvToken = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
        unsetenv("CLOUDFLARE_API_TOKEN")
        defer {
            if let previousEnvToken {
                setenv("CLOUDFLARE_API_TOKEN", previousEnvToken, 1)
            } else {
                unsetenv("CLOUDFLARE_API_TOKEN")
            }
        }

        let fixture = try await makeFixture(token: nil, proberTransport: { _ in
            Issue.record("capability prober must not be called without a token")
            struct Unexpected: Error {}
            throw Unexpected()
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == false)
        #expect(fixture.model.inboxCaptureError != nil)
    }
}
