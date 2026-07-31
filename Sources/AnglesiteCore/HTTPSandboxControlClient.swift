import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// `SandboxControlClient` that calls the user's deployed Control Worker over HTTPS. No Cloudflare
/// SDK — plain JSON. Used by the iOS app once onboarding has stored the Worker URL + API token.
public struct HTTPSandboxControlClient: SandboxControlClient {
    private let workerBaseURL: URL
    private let apiToken: String
    private let urlSession: URLSession

    /// Creates a client for one deployed Control Worker. `workerBaseURL` and `apiToken` are the
    /// values onboarding stored; `urlSession` is injectable so tests can stub HTTP without a
    /// deployed Worker.
    public init(workerBaseURL: URL, apiToken: String, urlSession: URLSession = .shared) {
        self.workerBaseURL = workerBaseURL
        self.apiToken = apiToken
        self.urlSession = urlSession
    }

    private struct StartBody: Encodable { let siteID, gitRemote, gitRef, token: String }
    private struct StartResponse: Decodable { let previewURL: URL; let mcpURL: URL }
    private struct StatusBody: Encodable { let siteID: String }
    private struct StatusResponse: Decodable { let siteID: String; let previewReady: Bool; let mcpReady: Bool }
    private struct StopBody: Encodable { let siteID: String }

    /// `POST /start` — boots (or resumes) the sandbox and returns the preview + MCP tunnel URLs.
    /// A response that doesn't decode is reported as ``SandboxControlError/startFailed(_:)``, same
    /// as a Worker-reported boot failure — either way the session isn't usable.
    public func start(siteID: String, gitRemote: URL, gitRef: String, token: SessionToken) async throws -> SandboxSession {
        let body = StartBody(siteID: siteID, gitRemote: gitRemote.absoluteString, gitRef: gitRef, token: token.value)
        let data = try await post("start", body: body)
        do {
            let r = try JSONDecoder().decode(StartResponse.self, from: data)
            return SandboxSession(previewURL: r.previewURL, mcpURL: r.mcpURL)
        } catch {
            throw SandboxControlError.startFailed("bad response: \(error)")
        }
    }

    /// `POST /stop` — asks the Worker to drop the tunnels and let the sandbox sleep. The response
    /// body carries nothing useful, so only the status code matters.
    public func stop(siteID: String) async throws {
        _ = try await post("stop", body: StopBody(siteID: siteID))
    }

    /// `POST /status` — probes preview/MCP readiness. Uses POST (not GET) like the other calls so
    /// the Worker has a single authenticated JSON-body request shape to handle.
    public func status(siteID: String) async throws -> SandboxStatus {
        let data = try await post("status", body: StatusBody(siteID: siteID))
        do {
            let r = try JSONDecoder().decode(StatusResponse.self, from: data)
            return SandboxStatus(siteID: r.siteID, previewReady: r.previewReady, mcpReady: r.mcpReady)
        } catch {
            throw SandboxControlError.startFailed("bad response: \(error)")
        }
    }

    private func post(_ path: String, body: some Encodable) async throws -> Data {
        var req = URLRequest(url: workerBaseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let data: Data, resp: URLResponse
        do { (data, resp) = try await urlSession.data(for: req) }
        catch { throw SandboxControlError.unreachable(error.localizedDescription) }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        switch code {
        case 200...299: return data
        case 401, 403: throw SandboxControlError.unauthorized
        default: throw SandboxControlError.startFailed(String(data: data, encoding: .utf8) ?? "HTTP \(code)")
        }
    }
}
