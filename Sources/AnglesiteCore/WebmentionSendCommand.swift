import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Actor orchestrator for one site's webmention-send pass, run after a successful deploy.
/// Builds the site's `SocialPublishPlan` (siteBase = the just-deployed URL), diffs it against the
/// site's `WebmentionSentLog`, sends each pending pair, persists successes, and streams
/// progress/results into `LogCenter` under source `"webmention:<siteID>"`. Best-effort — never
/// throws; failures are logged, not surfaced as a thrown error, since this runs detached from the
/// deploy result the user actually watches (`DeployModel.runDeploy`).
public actor WebmentionSendCommand {
    private let transport: WebmentionEndpointDiscovery.Transport
    private let logCenter: LogCenter
    private let now: () -> Date
    /// The latest `send()` call per `siteID`, so a new call for a site already in flight (e.g. a
    /// quick redeploy before the prior webmention pass finished) chains after it instead of
    /// racing it. Without this, two overlapping calls could both `WebmentionSentLog.load(...)`
    /// before either `.save()`s — duplicate POSTs, and whichever save finishes last silently
    /// drops the other call's newly-recorded entries. Never pruned: bounded by the number of
    /// distinct sites this instance ever sends for, which is small (each entry is overwritten,
    /// not appended, on every call for that site).
    private var inFlight: [String: Task<Void, Never>] = [:]

    /// Creates the orchestrator. Everything is injectable — transport, log sink, and clock — so
    /// tests can script endpoint discovery/POST responses and assert on the persisted timestamps
    /// without network or wall-clock time.
    public init(
        transport: @escaping WebmentionEndpointDiscovery.Transport = WebmentionSendCommand.defaultTransport,
        logCenter: LogCenter = .shared,
        now: @escaping () -> Date = Date.init
    ) {
        self.transport = transport
        self.logCenter = logCenter
        self.now = now
    }

    /// Serializes per `siteID`: chains behind any still-running `send()` for the same site before
    /// starting its own read-diff-send-persist pass, so `Config/webmention-sent.json` never has
    /// two overlapping readers/writers for the same site. Different sites run fully in parallel.
    public func send(siteID: String, siteDirectory: URL, configDirectory: URL, siteBase: URL) async {
        let previous = inFlight[siteID]
        let task = Task<Void, Never> { [weak self] in
            _ = await previous?.value
            await self?.performSend(
                siteID: siteID, siteDirectory: siteDirectory, configDirectory: configDirectory, siteBase: siteBase
            )
        }
        inFlight[siteID] = task
        await task.value
    }

    private func performSend(siteID: String, siteDirectory: URL, configDirectory: URL, siteBase: URL) async {
        let logSource = "webmention:\(siteID)"

        let plan: SocialPublishPlan.Plan
        do {
            plan = try SocialPublishPlan.build(projectRoot: siteDirectory, siteBase: siteBase)
        } catch {
            await logCenter.append(
                source: logSource, stream: .stderr,
                text: "webmention: couldn't build publish plan: \(error)"
            )
            return
        }
        guard plan.webmentionCount > 0 else { return }

        let log = WebmentionSentLog.load(from: configDirectory) ?? WebmentionSentLog()
        let pending = log.pending(in: plan)
        guard !pending.isEmpty else { return }

        await logCenter.append(
            source: logSource, stream: .stdout,
            text: "webmention: sending \(pending.count) webmention(s)"
        )

        var sentPairs: [WebmentionTargetPair] = []
        for pair in pending {
            let outcome = await WebmentionSender.send(source: pair.source, target: pair.target, transport: transport)
            switch outcome {
            case .sent(let endpoint, let statusCode):
                await logCenter.append(
                    source: logSource, stream: .stdout,
                    text: "webmention: sent \(pair.source.absoluteString) -> \(pair.target.absoluteString) via \(endpoint.absoluteString) (HTTP \(statusCode))"
                )
                sentPairs.append(pair)
            case .noEndpointDiscovered:
                await logCenter.append(
                    source: logSource, stream: .stdout,
                    text: "webmention: no endpoint declared by \(pair.target.absoluteString), skipping"
                )
            case .requestFailed(let reason):
                await logCenter.append(
                    source: logSource, stream: .stderr,
                    text: "webmention: \(pair.source.absoluteString) -> \(pair.target.absoluteString) failed: \(reason)"
                )
            }
        }

        guard !sentPairs.isEmpty else { return }
        let updated = log.recording(sentPairs, now: now)
        do {
            try updated.save(to: configDirectory)
        } catch {
            await logCenter.append(
                source: logSource, stream: .stderr,
                text: "webmention: couldn't persist sent log: \(error)"
            )
        }
    }

    /// Production transport: a plain `URLSession` request.
    ///
    /// **Accepted risk (SSRF surface):** no check against loopback/link-local/private-range hosts
    /// before either the discovery GET or the send POST. Target URLs come from the site's own
    /// content (`SocialPublishPlan` parses outbound links from frontmatter and post bodies), so
    /// anyone who can land a link in that content — a contributor, or in future an imported/
    /// inbound post — can make the app fetch an internal address (e.g. `127.0.0.1`, a link-local
    /// metadata endpoint). This is inherent to the webmention protocol (a sender always fetches
    /// attacker-influenced target URLs) and is treated the same way here as any other outbound
    /// link the site owner chooses to publish. If an untrusted/anonymous content source ever feeds
    /// this pipeline without review, revisit with a private-range denylist before that lands.
    public static let defaultTransport: WebmentionEndpointDiscovery.Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
