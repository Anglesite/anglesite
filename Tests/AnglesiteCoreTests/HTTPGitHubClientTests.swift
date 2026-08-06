import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for the native (no `gh` CLI) GitHub repo-creation client (#654). Only `createRepo` is
/// exercised — this client is not yet wired into `RepoBootstrap` (see its doc comment: no
/// `addRemote`/`push` at the current SwiftGit2 pin, #659).
struct HTTPGitHubClientTests {
    private static func transport(status: Int, json: String) -> GitHubAPITokenVerifier.Transport {
        { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(json.utf8), http)
        }
    }

    @Test("a successful create parses the browse URL, owner, and name")
    func successfulCreate() async throws {
        let client = HTTPGitHubClient(transport: Self.transport(
            status: 201,
            json: #"{"name":"site","html_url":"https://github.com/acme/site","owner":{"login":"acme"}}"#))
        let repo = try await client.createRepo(name: "site", isPrivate: true, token: "tok")
        #expect(repo.owner == "acme")
        #expect(repo.name == "site")
        #expect(repo.url == URL(string: "https://github.com/acme/site"))
    }

    @Test("a transport-level failure maps to .network, not .api")
    func transportFailureMapsToNetwork() async {
        // A DNS/offline/TLS/timeout failure never reached GitHub — it must be distinguishable
        // from a real GitHub-side rejection (review finding on PR #663).
        let client = HTTPGitHubClient(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: GitHubRepoAPIError.network) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "tok")
        }
    }

    @Test("a 401 maps to .unauthorized")
    func unauthorized() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 401, json: #"{"message":"Bad credentials"}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "bad")
        }
    }

    @Test("a 403 also maps to .unauthorized")
    func forbidden() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 403, json: #"{"message":"Forbidden"}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "scoped-wrong")
        }
    }

    @Test("a 422 name-already-exists error maps to .nameAlreadyExists")
    func nameConflict() async {
        let client = HTTPGitHubClient(transport: Self.transport(
            status: 422,
            json: #"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#))
        await #expect(throws: GitHubRepoAPIError.nameAlreadyExists) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "tok")
        }
    }

    @Test("a 422 for another reason surfaces as .api with the message")
    func otherValidationError() async {
        let client = HTTPGitHubClient(transport: Self.transport(
            status: 422, json: #"{"message":"Name can only contain alphanumeric characters"}"#))
        await #expect(throws: GitHubRepoAPIError.api(message: "Name can only contain alphanumeric characters")) {
            _ = try await client.createRepo(name: "bad name!", isPrivate: true, token: "tok")
        }
    }

    @Test("an unexpected status maps to .http(status:)")
    func unexpectedStatus() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 503, json: "{}"))
        await #expect(throws: GitHubRepoAPIError.http(status: 503)) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "tok")
        }
    }

    @Test("an unparseable success response maps to .malformedResponse")
    func malformedSuccessResponse() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 201, json: "not json at all"))
        await #expect(throws: GitHubRepoAPIError.malformedResponse) {
            _ = try await client.createRepo(name: "site", isPrivate: true, token: "tok")
        }
    }

    @Test("the request carries the bearer token, POST method, and private flag")
    func sendsExpectedRequest() async {
        let captured = CapturedRequest()
        let client = HTTPGitHubClient(transport: { request in
            await captured.record(request)
            let http = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"name":"site","html_url":"https://github.com/acme/site","owner":{"login":"acme"}}"#.utf8), http)
        })
        _ = try? await client.createRepo(name: "site", isPrivate: true, token: "secret-token")
        #expect(await captured.authHeader == "Bearer secret-token")
        #expect(await captured.method == "POST")
        #expect(await captured.path == "/user/repos")
        let body = await captured.decodedBody
        #expect(body?["name"] as? String == "site")
        #expect(body?["private"] as? Bool == true)
    }

    private actor CapturedRequest {
        private(set) var authHeader: String?
        private(set) var method: String?
        private(set) var path: String?
        private(set) var decodedBody: [String: Any]?
        func record(_ request: URLRequest) {
            path = request.url?.path
            method = request.httpMethod
            authHeader = request.value(forHTTPHeaderField: "Authorization")
            if let data = request.httpBody {
                decodedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
        }
    }

    /// Records the request the client built, so path/method/header assertions are possible.
    private static func recordingTransport(
        status: Int,
        json: String,
        into box: RequestBox
    ) -> GitHubAPITokenVerifier.Transport {
        { request in
            await box.record(request)
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(json.utf8), http)
        }
    }

    actor RequestBox {
        private(set) var last: URLRequest?
        func record(_ request: URLRequest) { last = request }
    }

    @Test("isPrivate reads the repo's private flag")
    func repoVisibility() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(
            status: 200, json: #"{"private":true}"#, into: box))
        #expect(try await client.isPrivate(owner: "acme", name: "site", token: "tok"))
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site")
        #expect(request?.httpMethod == "GET")
    }

    @Test("privateVulnerabilityReporting reads the enabled flag")
    func pvrState() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(
            status: 200, json: #"{"enabled":true}"#, into: box))
        #expect(try await client.privateVulnerabilityReporting(owner: "acme", name: "site", token: "tok"))
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site/private-vulnerability-reporting")
        #expect(request?.httpMethod == "GET")
    }

    @Test("enablePrivateVulnerabilityReporting PUTs and accepts a 204 with no body")
    func enablePVR() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(status: 204, json: "", into: box))
        try await client.enablePrivateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site/private-vulnerability-reporting")
        #expect(request?.httpMethod == "PUT")
        #expect(request?.value(forHTTPHeaderField: "X-GitHub-Api-Version") == "2022-11-28")
    }

    @Test("a 403 on the PVR write maps to .unauthorized — the token lacks repo admin")
    func enablePVRWithoutAdmin() async {
        let client = HTTPGitHubClient(transport: Self.transport(
            status: 403, json: #"{"message":"Must have admin rights to Repository."}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            try await client.enablePrivateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("a transport failure on a repo-security read maps to .network")
    func repoSecurityTransportFailure() async {
        let client = HTTPGitHubClient(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: GitHubRepoAPIError.network) {
            _ = try await client.privateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("an undecodable body maps to .malformedResponse")
    func repoSecurityMalformedBody() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: "not json"))
        await #expect(throws: GitHubRepoAPIError.malformedResponse) {
            _ = try await client.isPrivate(owner: "acme", name: "site", token: "tok")
        }
    }

    // MARK: - RepoAdvisoryReading (#975)

    @Test("open security advisories decode, keeping only triage/published state")
    func openSecurityAdvisoriesFiltersState() async throws {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: """
            [
              {"ghsa_id":"GHSA-1111-1111-1111","summary":"Triage report","severity":"high",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-1111-1111-1111",
               "published_at":null,"state":"triage"},
              {"ghsa_id":"GHSA-2222-2222-2222","summary":"Published report","severity":"critical",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-2222-2222-2222",
               "published_at":"2026-07-01T00:00:00Z","state":"published"},
              {"ghsa_id":"GHSA-3333-3333-3333","summary":"Owner's own draft","severity":"low",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-3333-3333-3333",
               "published_at":null,"state":"draft"},
              {"ghsa_id":"GHSA-4444-4444-4444","summary":"Already resolved","severity":"moderate",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-4444-4444-4444",
               "published_at":"2026-01-01T00:00:00Z","state":"closed"}
            ]
            """))
        let advisories = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "tok")
        #expect(advisories.map(\.id) == ["GHSA-1111-1111-1111", "GHSA-2222-2222-2222"])
        #expect(advisories[0].severity == .high)
        #expect(advisories[1].severity == .critical)
        #expect(advisories[1].publishedAt != nil)
    }

    @Test("open Dependabot alerts decode package, severity, patched version, and URL")
    func openDependabotAlertsDecode() async throws {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: """
            [
              {"number":7,"dependency":{"package":{"name":"left-pad","ecosystem":"npm"}},
               "security_advisory":{"severity":"moderate"},
               "security_vulnerability":{"first_patched_version":{"identifier":"1.3.0"}},
               "html_url":"https://github.com/acme/site/security/dependabot/7"},
              {"number":9,"dependency":{"package":{"name":"left-pad-legacy","ecosystem":"npm"}},
               "security_advisory":{"severity":"high"},
               "security_vulnerability":{"first_patched_version":null},
               "html_url":"https://github.com/acme/site/security/dependabot/9"}
            ]
            """))
        let alerts = try await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        #expect(alerts.count == 2)
        #expect(alerts[0].id == 7)
        #expect(alerts[0].packageName == "left-pad")
        #expect(alerts[0].ecosystem == "npm")
        #expect(alerts[0].severity == .moderate)
        #expect(alerts[0].patchedVersion == "1.3.0")
        #expect(alerts[1].patchedVersion == nil)
    }

    @Test("a 401 on advisories maps to .unauthorized")
    func openSecurityAdvisoriesUnauthorized() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 401, json: #"{"message":"Bad credentials"}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            _ = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "bad")
        }
    }

    /// GitHub answers this specific endpoint with 403 whenever Dependabot alerts are simply
    /// disabled for the repository — SecurityReportsModel.recheck's whole rationale for awaiting
    /// this endpoint independently rests on that being a `.unauthorized` case like 401, not a
    /// distinct one, so it's worth pinning explicitly rather than relying only on the shared
    /// 401/403 coverage elsewhere (`createRepo`'s tests).
    @Test("a 403 on alerts (Dependabot disabled for the repo) also maps to .unauthorized")
    func openDependabotAlertsForbidden() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 403, json: #"{"message":"Dependabot alerts are disabled"}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            _ = try await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("a transport failure on alerts maps to .network")
    func openDependabotAlertsNetworkFailure() async {
        let client = HTTPGitHubClient(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: GitHubRepoAPIError.network) {
            _ = try await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("an unparseable advisories body maps to .malformedResponse")
    func openSecurityAdvisoriesMalformed() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: "not json"))
        await #expect(throws: GitHubRepoAPIError.malformedResponse) {
            _ = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("the alerts request targets the state=open query and sends the bearer token")
    func alertsRequestShape() async {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(status: 200, json: "[]", into: box))
        _ = try? await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        let request = await box.last
        #expect(request?.url?.absoluteString == "https://api.github.com/repos/acme/site/dependabot/alerts?state=open")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }
}
