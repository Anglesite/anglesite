import Testing
import Foundation
@testable import AnglesiteCore

struct PreDeployCheckTests {
    private let siteDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    // MARK: Happy path

    @Test("Returns passed when script emits ok-true JSON") func returnsPassedWhenScriptEmitsOkTrueJSON() async {
        let json = #"{"version": 1, "ok": true, "failures": [], "warnings": []}"#
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 0) })

        let outcome = await check.check(siteID: "mysite", siteDirectory: siteDir)

        guard case .passed(let warnings) = outcome else {
            Issue.record("expected .passed, got \(outcome)")
            return
        }
        #expect(warnings == [])
    }

    // MARK: Blocked

    @Test("Returns blocked when script emits ok-false with failures") func returnsBlockedWhenScriptEmitsOkFalseWithFailures() async {
        let json = """
        {
          "version": 1,
          "ok": false,
          "failures": [
            {
              "category": "pii-email",
              "message": "Possible email address: jane@yourbusiness.com",
              "file": "dist/index.html",
              "remediation": "Wrap the address in a `mailto:` link if it should be published, or add it to PII_EMAIL_ALLOW in .site-config."
            }
          ],
          "warnings": []
        }
        """
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 1) })

        let outcome = await check.check(siteID: "mysite", siteDirectory: siteDir)

        guard case .blocked(let failures, _) = outcome else {
            Issue.record("expected .blocked, got \(outcome)")
            return
        }
        #expect(failures.count == 1)
        #expect(failures[0].category == .piiEmail)
        #expect(failures[0].file == "dist/index.html")
        #expect(failures[0].message.contains("jane@yourbusiness.com"))
        #expect(failures[0].remediation?.contains("PII_EMAIL_ALLOW") == true)
    }

    @Test("Parses all eight concrete failure categories") func parsesAllEightConcreteFailureCategories() async {
        let json = """
        {
          "version": 1,
          "ok": false,
          "failures": [
            {"category": "pii-email", "message": "m", "file": "a", "remediation": "r"},
            {"category": "pii-phone", "message": "m", "file": "a", "remediation": "r"},
            {"category": "pii-ssn", "message": "m", "file": "a", "remediation": "r"},
            {"category": "exposed-token", "message": "m", "file": "a", "remediation": "r"},
            {"category": "third-party-script", "message": "m", "file": "a", "remediation": "r"},
            {"category": "keystatic-route", "message": "m", "file": "a", "remediation": "r"},
            {"category": "csp-misconfigured", "message": "m", "file": "a", "remediation": "r"},
            {"category": "embed-media-hotlink", "message": "m", "file": "a", "remediation": "r"}
          ],
          "warnings": []
        }
        """
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 1) })

        guard case .blocked(let failures, _) = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .blocked")
            return
        }
        // Every concrete ScanFailure.Category case except `.other`, which has its own dedicated
        // test (`unknownCategoryDecodesToOther`) covering the forward-compatible fallback.
        #expect(
            Set(failures.map(\.category)) == Set([
                .piiEmail, .piiPhone, .piiSSN, .exposedToken, .thirdPartyScript, .keystaticRoute, .cspMisconfigured,
                .embedMediaHotlink,
            ])
        )
    }

    @Test("Unknown category decodes to .other instead of failing the scan") func unknownCategoryDecodesToOther() async {
        let json = """
        {
          "version": 1,
          "ok": false,
          "failures": [
            {"category": "some-future-category", "message": "m", "file": "a"}
          ],
          "warnings": [
            {"category": "another-future-category", "message": "m"}
          ]
        }
        """
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 1) })

        guard case .blocked(let failures, let warnings) = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .blocked")
            return
        }
        #expect(failures.first?.category == .other)
        #expect(warnings.first?.category == .other)
    }

    // MARK: Error paths

    @Test("Returns error when invoker throws") func returnsErrorWhenInvokerThrows() async {
        struct SpawnFailed: Error {}
        let check = PreDeployCheck(invoke: { _ in throw SpawnFailed() })

        let outcome = await check.check(siteID: "mysite", siteDirectory: siteDir)

        guard case .error(let reason) = outcome else {
            Issue.record("expected .error, got \(outcome)")
            return
        }
        #expect(reason.contains("couldn't run"), "\(reason)")
    }

    @Test("Returns error when stdout is not parseable JSON") func returnsErrorWhenStdoutIsNotParseableJSON() async {
        // tsx not installed → "command not found" on stderr, no stdout, exit 127
        let check = PreDeployCheck(invoke: { _ in (stdout: "", exitCode: 127) })

        guard case .error(let reason) = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .error")
            return
        }
        #expect(reason.contains("exit 127") || reason.contains("npm run build") || reason.contains("update"), "\(reason)")
    }

    @Test("Returns error when JSON is malformed") func returnsErrorWhenJSONIsMalformed() async {
        let check = PreDeployCheck(invoke: { _ in (stdout: "not json at all", exitCode: 0) })

        guard case .error = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .error")
            return
        }
    }

    @Test("Returns error when the version field is missing (no legacy-array fallback)") func returnsErrorWhenVersionIsMissing() async {
        // Pre-#742 shape: a bare array, no envelope at all.
        let json = #"[{"severity":"error","message":"Possible email found","file":"dist/index.html"}]"#
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 1) })

        guard case .error = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .error for pre-envelope legacy array output")
            return
        }
    }

    @Test("Returns error when the envelope version is unsupported") func returnsErrorWhenVersionIsUnsupported() async {
        let json = #"{"version": 2, "ok": true, "failures": [], "warnings": []}"#
        let check = PreDeployCheck(invoke: { _ in (stdout: json, exitCode: 0) })

        guard case .error(let reason) = await check.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .error")
            return
        }
        #expect(reason.contains("unsupported envelope version"), "\(reason)")
    }

    // MARK: Warnings pass-through

    @Test("Warnings are returned alongside passed and blocked outcomes") func warningsAreReturnedAlongsidePassedAndBlockedOutcomes() async {
        let warningJSON = """
        "warnings": [
          {"category": "missing-og-image", "message": "No og:image meta tag.", "remediation": "Run `npm run ai-images`."}
        ]
        """
        let passedJSON = "{ \"version\": 1, \"ok\": true, \"failures\": [], \(warningJSON) }"
        let blockedJSON = """
        { "version": 1, "ok": false,
          "failures": [{"category": "pii-email", "message": "m", "file": "a", "remediation": "r"}],
          \(warningJSON) }
        """

        let passedCheck = PreDeployCheck(invoke: { _ in (stdout: passedJSON, exitCode: 0) })
        guard case .passed(let pw) = await passedCheck.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .passed")
            return
        }
        #expect(pw.count == 1)
        #expect(pw[0].category == .missingOgImage)

        let blockedCheck = PreDeployCheck(invoke: { _ in (stdout: blockedJSON, exitCode: 1) })
        guard case .blocked(_, let bw) = await blockedCheck.check(siteID: "mysite", siteDirectory: siteDir) else {
            Issue.record("expected .blocked")
            return
        }
        #expect(bw.count == 1)
        #expect(bw[0].category == .missingOgImage)
    }
}
