import Foundation
import Testing
@testable import AnglesiteCore

@Suite("AstroHTMLValidator")
struct AstroHTMLValidatorTests {
    @Test("empty custom analytics HTML is valid without touching the container")
    func emptyHTMLDoesNotUseContainer() async {
        let validator = AstroHTMLValidator(containerControlProvider: {
            Issue.record("Empty HTML should not run Astro validation")
            return nil
        })

        let message = await validator.validationMessage(for: "   \n", siteDirectory: URL(fileURLWithPath: "/tmp/site"))

        #expect(message == nil)
    }

    @Test("missing Astro compiler reports dependency error")
    func missingAstroCompiler() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        let validator = AstroHTMLValidator(containerControlProvider: {
            Issue.record("Missing Astro dependencies should be caught before touching the container")
            return nil
        })

        let message = await validator.validationMessage(for: "<script></script>", siteDirectory: root)

        #expect(message?.contains("Astro dependencies are missing") == true)
    }

    @Test("no running container reports container requirement when Astro deps exist")
    func noContainerReportsContainerRequirement() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(
            at: root.appendingPathComponent("node_modules/@astrojs/compiler", isDirectory: true),
            withIntermediateDirectories: true
        )
        try "{}".write(
            to: root.appendingPathComponent("node_modules/@astrojs/compiler/package.json"),
            atomically: true,
            encoding: .utf8
        )
        defer { try? fm.removeItem(at: root) }

        let validator = AstroHTMLValidator(containerControlProvider: { nil })
        let message = await validator.validationMessage(for: "<script></script>", siteDirectory: root)

        #expect(message == "Custom analytics HTML validation must run in the container runtime; host Node has been retired.")
    }

    @Test("guest exec failure is returned as invalid custom analytics HTML")
    func guestExecFailure() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(
            at: root.appendingPathComponent("node_modules/@astrojs/compiler", isDirectory: true),
            withIntermediateDirectories: true
        )
        try "{}".write(
            to: root.appendingPathComponent("node_modules/@astrojs/compiler/package.json"),
            atomically: true,
            encoding: .utf8
        )
        defer { try? fm.removeItem(at: root) }

        let control = FakeLocalContainerControl(
            startResult: .failure(.bootFailed("unused")),
            execResult: ContainerExecResult(
                exitCode: 1,
                stdout: "",
                stderr: "Cannot read properties of undefined (reading 'map')"
            )
        )
        let validator = AstroHTMLValidator(containerControlProvider: { (siteID: "site-1", control: control) })

        let message = await validator.validationMessage(for: "<script></", siteDirectory: root)

        #expect(message == "Custom analytics HTML is invalid: Astro couldn't parse the snippet. Check for incomplete tags or script blocks.")

        let calls = await control.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].siteID == "site-1")
        #expect(calls[0].cwd == "/workspace/site")
        #expect(calls[0].argv.first == "sh")

        // The snippet is never spliced into the script text — it travels as a base64 positional
        // parameter ($1), decoded in-guest. Confirm the exact snippet round-trips.
        #expect(calls[0].argv.count == 6)
        let snippetBase64 = calls[0].argv[4]
        let decodedSnippet = try #require(Data(base64Encoded: snippetBase64))
        #expect(String(data: decodedSnippet, encoding: .utf8) == "<script></")
    }

    @Test("successful guest exec reports valid HTML")
    func guestExecSuccess() async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(
            at: root.appendingPathComponent("node_modules/@astrojs/compiler", isDirectory: true),
            withIntermediateDirectories: true
        )
        try "{}".write(
            to: root.appendingPathComponent("node_modules/@astrojs/compiler/package.json"),
            atomically: true,
            encoding: .utf8
        )
        defer { try? fm.removeItem(at: root) }

        let control = FakeLocalContainerControl(
            startResult: .failure(.bootFailed("unused")),
            execResult: ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
        )
        let validator = AstroHTMLValidator(containerControlProvider: { (siteID: "site-1", control: control) })

        let message = await validator.validationMessage(for: "<script>ok</script>", siteDirectory: root)

        #expect(message == nil)
    }
}
