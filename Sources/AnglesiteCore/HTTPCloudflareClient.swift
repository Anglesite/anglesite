import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Pagination metadata returned alongside list results.
private struct CFResultInfo: Decodable, Sendable {
    let page: Int
    let total_pages: Int
}

/// Standard Cloudflare v4 response envelope.
private struct CFEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let success: Bool
    let result: T?
    struct APIError: Decodable, Sendable { let message: String }
    let errors: [APIError]?
    let result_info: CFResultInfo?
}

/// Placeholder for write responses where we only check `success`.
private struct CFEmpty: Decodable, Sendable {}

private struct CFZone: Decodable, Sendable {
    let id: String
    let name: String
    let status: String
}

private struct CFDNSSEC: Decodable, Sendable { let status: String }
private struct CFStringSetting: Decodable, Sendable { let value: String }
private struct CFSecurityHeader: Decodable, Sendable {
    struct Value: Decodable, Sendable {
        struct STS: Decodable, Sendable {
            let enabled: Bool
            let max_age: Int?
            let include_subdomains: Bool?
            let preload: Bool?
        }
        let strict_transport_security: STS
    }
    let value: Value
}
private struct CFDNSRecord: Decodable, Sendable {
    let type: String
    let name: String
    let content: String
}
private struct CFFullDNSRecord: Decodable, Sendable {
    let id: String
    let type: String
    let name: String
    let content: String
    let ttl: Int
    let proxied: Bool?
    let comment: String?
}
private struct CFAccount: Decodable, Sendable { let id: String }
private struct CFRegistrarSearchResult: Decodable, Sendable {
    let name: String
}
/// The Registrar search/check `result` is an object wrapping a `domains` array (not a bare
/// array like most other Cloudflare v4 list endpoints) — confirmed against the live API docs.
private struct CFRegistrarSearchResponse: Decodable, Sendable {
    let domains: [CFRegistrarSearchResult]
}
private struct CFRegistrarCheckResult: Decodable, Sendable {
    let name: String
    let registrable: Bool
    let reason: String?
    let pricing: Pricing?
    struct Pricing: Decodable, Sendable {
        let currency: String
        let registration_cost: String
        let renewal_cost: String
    }
}
private struct CFRegistrarCheckResponse: Decodable, Sendable {
    let domains: [CFRegistrarCheckResult]
}
private struct CFRegistrarCheckRequest: Encodable, Sendable {
    let domains: [String]
}
private struct CFRegistrarRegisterRequest: Encodable, Sendable {
    let domain_name: String
}
/// Shared by the immediate register response body and the poll (`registration-status`) response
/// body — unlike search/check, both report a bare `state` field directly on `result`, confirmed
/// against the live API docs (no `domains`-style wrapper here).
private struct CFRegistrarRegistrationState: Decodable, Sendable {
    let state: String
}
private struct CFWorkerScript: Decodable, Sendable { let id: String }
private struct CFWorkerDomain: Decodable, Sendable { let hostname: String; let service: String }

/// URL Scanner `POST .../urlscanner/v2/scan` response — a flat object, unlike the rest of this
/// file's v4 endpoints: no `{success, result, errors}` envelope (confirmed against the live API
/// reference). Only `uuid` (the scan id to poll) is needed here.
private struct CFURLScanSubmission: Decodable, Sendable { let uuid: String }

/// One Agent Readiness check's result, as nested under
/// `meta.processors.agentReadiness.checks.<category>.<checkID>` in a finished scan's result.
private struct CFAgentReadinessCheck: Decodable, Sendable { let status: String }

/// The four *scored* Agent Readiness categories. `commerce` (x402/UCP/ACP) is deliberately
/// omitted — Cloudflare tracks it but excludes it from the tier, per the blog announcement.
private struct CFAgentReadinessChecks: Decodable, Sendable {
    let botAccessControl: [String: CFAgentReadinessCheck]?
    let contentAccessibility: [String: CFAgentReadinessCheck]?
    let discoverability: [String: CFAgentReadinessCheck]?
    let discovery: [String: CFAgentReadinessCheck]?
}

private struct CFAgentReadinessNextLevel: Decodable, Sendable { let name: String; let target: Int }

private struct CFAgentReadiness: Decodable, Sendable {
    let level: Int
    let levelName: String
    let checks: CFAgentReadinessChecks
    let nextLevel: CFAgentReadinessNextLevel?
}

private struct CFScanResult: Decodable, Sendable {
    struct Meta: Decodable, Sendable {
        struct Processors: Decodable, Sendable { let agentReadiness: CFAgentReadiness? }
        let processors: Processors?
    }
    let meta: Meta?
}

/// Body for DELETE requests, which Cloudflare's API doesn't require but tolerates.
private struct CFEmptyBody: Encodable, Sendable {}
private struct CFBotManagement: Decodable, Sendable {
    let fight_mode: Bool?
    let enable_js: Bool?
}
private struct CFRuleset: Decodable, Sendable {
    let id: String
    let phase: String?
    let rules: [CFRulesetRule]?
}
private struct CFRulesetRule: Decodable, Sendable {
    let description: String?
    let expression: String
    let action: String
    let action_parameters: Params?
    struct Params: Decodable, Sendable {
        let algorithms: [Algorithm]?
        struct Algorithm: Decodable, Sendable { let name: String? }
    }
}
private struct CFPageShield: Decodable, Sendable { let enabled: Bool? }
private struct CFPageShieldScript: Decodable, Sendable {
    let url: String?
    let host: String?
}

/// Cloudflare v4 API client. The base conformance here is the read side
/// (``CloudflareReading``, all GETs); the write side (``CloudflareWriting`` — the hardening
/// PUT/POST/PATCH/DELETE calls) is conformed in an extension below.
public struct HTTPCloudflareClient: CloudflareReading {
    private static let base = "https://api.cloudflare.com/client/v4"
    private let transport: CloudflareTransport

    /// The transport parameter exists for tests (fake responses, no network); production uses
    /// ``defaultTransport``.
    public init(transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport) {
        self.transport = transport
    }

    /// Production transport: a plain shared-`URLSession` request.
    public static let defaultTransport: CloudflareTransport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CloudflareError.malformedResponse }
        return (data, http)
    }

    /// GET `path`, decode `CFEnvelope<T>`, return the whole envelope or throw a mapped error.
    private func getEnvelope<T: Decodable & Sendable>(_ path: String, apiToken: String, as: T.Type) async throws -> CFEnvelope<T> {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        return try await getEnvelope(url: url, apiToken: apiToken, as: T.self)
    }

    /// GET `url`, decode `CFEnvelope<T>`, return the whole envelope or throw a mapped error.
    /// Takes a pre-built `URL` (rather than a path string) so callers with query values that need
    /// real percent-encoding — e.g. free-text search keywords that may contain `&`/`=`/`+` — can
    /// build the request with `URLComponents`/`URLQueryItem` instead of manual string interpolation.
    private func getEnvelope<T: Decodable & Sendable>(url: URL, apiToken: String, as: T.Type) async throws -> CFEnvelope<T> {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        let env: CFEnvelope<T>
        do {
            env = try JSONDecoder().decode(CFEnvelope<T>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard env.success else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "request failed")
        }
        return env
    }

    /// GET `path` and return the decoded `result`, or throw `.api` when it is absent.
    private func get<T: Decodable & Sendable>(_ path: String, apiToken: String, as type: T.Type) async throws -> T {
        let env = try await getEnvelope(path, apiToken: apiToken, as: type)
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing result")
        }
        return result
    }

    /// GET `url` and return the decoded `result`, or throw `.api` when it is absent. See
    /// `getEnvelope(url:apiToken:as:)` for why this pre-built-`URL` variant exists.
    private func get<T: Decodable & Sendable>(url: URL, apiToken: String, as type: T.Type) async throws -> T {
        let env = try await getEnvelope(url: url, apiToken: apiToken, as: type)
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing result")
        }
        return result
    }

    /// Fetch every item across pages (Cloudflare caps `per_page` at 100, so a single page
    /// silently truncates a list with more than 100 items). `path` must already include its
    /// own query string (e.g. `...?per_page=100`); `&page=N` is appended per request.
    private func paginated<T: Decodable & Sendable>(_ path: String, apiToken: String, as type: T.Type) async throws -> [T] {
        var all: [T] = []
        var page = 1
        while true {
            let env = try await getEnvelope("\(path)&page=\(page)", apiToken: apiToken, as: [T].self)
            all.append(contentsOf: env.result ?? [])
            guard let info = env.result_info, info.page < info.total_pages else { break }
            page += 1
        }
        return all
    }

    /// Fetch every DNS record across pages (Cloudflare caps `per_page` at 100, so a
    /// single page silently truncates zones with more records).
    private func allDNSRecords(zoneID: String, apiToken: String) async throws -> [CFDNSRecord] {
        try await paginated("/zones/\(zoneID)/dns_records?per_page=100", apiToken: apiToken, as: CFDNSRecord.self)
    }

    /// Looks the zone up via `GET /zones?name=…&status=active`, then re-checks the name
    /// case-insensitively client-side — the API's `name=` filter is a match request, not a
    /// guarantee, and a wrong zone id here would point every later read/write at someone
    /// else's zone.
    public func resolveZoneID(domain: String, apiToken: String) async throws -> String? {
        let escaped = domain.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? domain
        let zones = try await get("/zones?name=\(escaped)&status=active", apiToken: apiToken, as: [CFZone].self)
        return zones.first(where: { $0.name.lowercased() == domain.lowercased() })?.id
    }

    /// Assembles the zone's security posture from a dozen endpoints. The five core reads
    /// (DNSSEC, SSL mode, Always-Use-HTTPS, security header, DNS records) fan out concurrently
    /// and *must* all succeed; the extended settings (Bot Fight Mode, WAF rules, Speed Brain,
    /// ECH, zstd, Page Shield, Onion Routing) individually degrade to their "off"/absent value
    /// on error instead — many tokens simply can't see those endpoints, and one 403 there
    /// shouldn't sink the whole audit.
    public func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState {
        // Independent reads — fan out concurrently rather than paying 5× round-trip latency.
        async let dnssecCall = get("/zones/\(zoneID)/dnssec", apiToken: apiToken, as: CFDNSSEC.self)
        async let sslCall = get("/zones/\(zoneID)/settings/ssl", apiToken: apiToken, as: CFStringSetting.self)
        async let httpsCall = get("/zones/\(zoneID)/settings/always_use_https", apiToken: apiToken, as: CFStringSetting.self)
        async let headerCall = get("/zones/\(zoneID)/settings/security_header", apiToken: apiToken, as: CFSecurityHeader.self)
        async let recordsCall = allDNSRecords(zoneID: zoneID, apiToken: apiToken)

        let dnssec = try await dnssecCall
        let ssl = try await sslCall
        let https = try await httpsCall
        let header = try await headerCall
        let records = try await recordsCall
        let apex = domain.lowercased()

        let botFight: Bool
        do {
            let bot = try await get("/zones/\(zoneID)/settings/bot_management", apiToken: apiToken, as: CFBotManagement.self)
            botFight = bot.fight_mode ?? false
        } catch {
            botFight = false
        }

        let wafRules = (try? await fetchWAFCustomRules(zoneID: zoneID, apiToken: apiToken)) ?? []

        let speedBrain = await settingIsOn("/zones/\(zoneID)/settings/speed_brain", apiToken: apiToken)
        let ech = await settingIsOn("/zones/\(zoneID)/settings/ech", apiToken: apiToken)
        let zstd = await zstdEnabled(zoneID: zoneID, apiToken: apiToken)
        let pageShield = await pageShieldState(zoneID: zoneID, apiToken: apiToken)
        let onionRouting = await settingIsOn("/zones/\(zoneID)/settings/opportunistic_onion", apiToken: apiToken)

        let sts = header.value.strict_transport_security
        let hsts: CloudflareZoneState.HSTS? = sts.enabled
            ? .init(maxAge: sts.max_age ?? 0, includeSubdomains: sts.include_subdomains ?? false, preload: sts.preload ?? false)
            : nil

        // Scoped to the zone apex — a record published on an unrelated subdomain must not
        // count toward the apex domain's CAA/MX/SPF/DMARC posture (that direction of error
        // produces a false "all clear" in a security audit).
        func contents(ofType t: String) -> [String] {
            records.filter { $0.type.uppercased() == t && $0.name.lowercased() == apex }.map(\.content)
        }
        let txt = records.filter { $0.type.uppercased() == "TXT" && $0.name.lowercased() == apex }
        let spf = txt.filter { $0.content.lowercased().hasPrefix("v=spf1") }.map(\.content)
        let dmarcName = "_dmarc.\(apex)"
        let dmarc = records
            .filter { $0.type.uppercased() == "TXT" && $0.name.lowercased() == dmarcName && $0.content.lowercased().hasPrefix("v=dmarc1") }
            .map(\.content)

        return CloudflareZoneState(
            dnssecActive: dnssec.status.lowercased() == "active",
            sslMode: ssl.value,
            alwaysUseHTTPS: https.value.lowercased() == "on",
            hsts: hsts,
            caaRecords: contents(ofType: "CAA"),
            mxRecords: contents(ofType: "MX"),
            spfRecords: spf,
            dmarcRecords: dmarc,
            botFightMode: botFight,
            wafCustomRules: wafRules,
            speedBrain: speedBrain, ech: ech, zstdCompression: zstd, pageShield: pageShield, onionRouting: onionRouting)
    }

    private func fetchWAFCustomRules(zoneID: String, apiToken: String) async throws -> [CloudflareZoneState.WAFCustomRule] {
        let rulesets = try await get("/zones/\(zoneID)/rulesets", apiToken: apiToken, as: [CFRuleset].self)
        guard let custom = rulesets.first(where: { $0.phase == "http_request_firewall_custom" }) else {
            return []
        }
        let full = try await get("/zones/\(zoneID)/rulesets/\(custom.id)", apiToken: apiToken, as: CFRuleset.self)
        return (full.rules ?? []).map {
            .init(description: $0.description ?? "", expression: $0.expression, action: $0.action)
        }
    }

    /// Reads an on/off zone setting, defaulting to `false` when the token can't see it.
    private func settingIsOn(_ path: String, apiToken: String) async -> Bool {
        ((try? await get(path, apiToken: apiToken, as: CFStringSetting.self))?.value.lowercased()) == "on"
    }

    private func zstdEnabled(zoneID: String, apiToken: String) async -> Bool {
        guard let rulesets = try? await get("/zones/\(zoneID)/rulesets", apiToken: apiToken, as: [CFRuleset].self),
              let compression = rulesets.first(where: { $0.phase == "http_response_compression" }),
              let full = try? await get("/zones/\(zoneID)/rulesets/\(compression.id)", apiToken: apiToken, as: CFRuleset.self)
        else { return false }
        return (full.rules ?? []).contains { rule in
            rule.action == "compress_response"
                && (rule.action_parameters?.algorithms ?? []).contains { $0.name == "zstd" }
        }
    }

    private func pageShieldState(zoneID: String, apiToken: String) async -> CloudflareZoneState.PageShieldState? {
        guard let shield = try? await get("/zones/\(zoneID)/page_shield", apiToken: apiToken, as: CFPageShield.self) else {
            return nil
        }
        let enabled = shield.enabled ?? false
        var hosts: [String] = []
        if enabled,
           let scripts = try? await get("/zones/\(zoneID)/page_shield/scripts", apiToken: apiToken, as: [CFPageShieldScript].self) {
            hosts = Set(scripts.compactMap { $0.host ?? $0.url.flatMap { URL(string: $0)?.host } }).sorted()
        }
        return .init(enabled: enabled, scriptHosts: hosts)
    }

    /// Lists every DNS record in the zone, walking all pages (Cloudflare caps `per_page` at
    /// 100, so a single-page read silently truncates larger zones).
    public func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] {
        let raw = try await paginated("/zones/\(zoneID)/dns_records?per_page=100", apiToken: apiToken, as: CFFullDNSRecord.self)
        return raw.map {
            DNSRecord(id: $0.id, type: $0.type, name: $0.name, content: $0.content,
                      ttl: $0.ttl, proxied: $0.proxied ?? false, comment: $0.comment)
        }
    }

    /// Lists all Worker script names visible to the token's **first** account (a personal
    /// Cloudflare token virtually always sees exactly one), walking all pages. Throws
    /// ``CloudflareError/api(message:)`` when the token can see no account at all.
    public func workerScriptNames(apiToken: String) async throws -> [String] {
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        let scripts = try await paginated(
            "/accounts/\(accountID)/workers/scripts?per_page=100", apiToken: apiToken, as: CFWorkerScript.self)
        return scripts.map(\.id)
    }

    // MARK: - Write helpers

    /// Builds and sends a `method` request to `path` with an encoded `body`, then maps
    /// 401/403 to ``CloudflareError/unauthorized`` and any other non-2xx status to
    /// ``CloudflareError/http(status:)``. Shared by `mutate(method:_:body:apiToken:)` (which
    /// only checks the envelope's `success` flag) and the Registrar `post` helper below (which
    /// also decodes and returns the envelope's `result`) — both need identical request
    /// construction and status handling and previously duplicated it verbatim.
    private func send<Body: Encodable & Sendable>(
        method: String,
        _ path: String,
        body: Body,
        apiToken: String
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        return (data, http)
    }

    /// GET `path` with no body, mapping 401/403 to ``CloudflareError/unauthorized`` and any other
    /// non-2xx status to ``CloudflareError/http(status:)`` — the read-side counterpart to
    /// `send(method:_:body:apiToken:)`, for endpoints (like URL Scanner) that don't wrap responses
    /// in the `{success, result, errors}` v4 envelope `getEnvelope`/`get` assume, so those helpers
    /// don't fit. `passthroughStatuses` lets a caller opt specific non-2xx statuses out of the
    /// `.http` mapping to inspect the raw response itself (e.g. a 404 that means "not ready yet"
    /// rather than "doesn't exist").
    private func fetchRaw(
        _ path: String, apiToken: String, passthroughStatuses: Set<Int> = []
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await transport(request)
        if passthroughStatuses.contains(http.statusCode) { return (data, http) }
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        return (data, http)
    }

    private func mutate<Body: Encodable & Sendable>(
        method: String,
        _ path: String,
        body: Body,
        apiToken: String
    ) async throws {
        let (data, _) = try await send(method: method, path, body: body, apiToken: apiToken)
        let env: CFEnvelope<CFEmpty>
        do {
            env = try JSONDecoder().decode(CFEnvelope<CFEmpty>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        if !env.success {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "request failed")
        }
    }
}

// MARK: - CloudflareWriting conformance

extension HTTPCloudflareClient: CloudflareWriting {
    /// `PUT /zones/{id}/dnssec` with `status: active`. Enable-only — the app hardens; it never
    /// offers a "turn DNSSEC back off" path.
    public func enableDNSSEC(zoneID: String, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/dnssec",
                         body: ["status": "active"], apiToken: apiToken)
    }

    /// `PUT /zones/{id}/settings/always_use_https`, mapping `enabled` to the API's `"on"/"off"`
    /// string values.
    public func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/settings/always_use_https",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    /// `PUT /zones/{id}/settings/security_header` with `enabled: true` fixed — callers choose
    /// the HSTS parameters, not whether HSTS is on; disabling it is deliberately not offered.
    public func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool,
                         apiToken: String) async throws {
        struct HSTSBody: Encodable, Sendable {
            struct Value: Encodable, Sendable {
                struct STS: Encodable, Sendable {
                    let enabled: Bool
                    let max_age: Int
                    let include_subdomains: Bool
                    let preload: Bool
                }
                let strict_transport_security: STS
            }
            let value: Value
        }
        let body = HSTSBody(value: .init(strict_transport_security: .init(
            enabled: true, max_age: maxAge, include_subdomains: includeSubdomains, preload: preload)))
        try await mutate(method: "PUT", "/zones/\(zoneID)/settings/security_header",
                         body: body, apiToken: apiToken)
    }

    /// `POST /zones/{id}/dns_records` — ``DNSRecordPayload`` encodes directly as the request
    /// body, so what the seam accepts and what goes over the wire can't drift apart.
    public func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {
        try await mutate(method: "POST", "/zones/\(zoneID)/dns_records",
                         body: record, apiToken: apiToken)
    }

    /// `DELETE /zones/{id}/dns_records/{recordID}` (with an empty JSON body Cloudflare
    /// tolerates, so the shared `mutate` helper needs no body-less variant).
    public func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {
        try await mutate(method: "DELETE", "/zones/\(zoneID)/dns_records/\(recordID)",
                         body: CFEmptyBody(), apiToken: apiToken)
    }

    /// `PATCH /zones/{id}/bot_management` toggling `fight_mode`.
    public func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/bot_management",
                         body: ["fight_mode": enabled], apiToken: apiToken)
    }

    /// Appends `rule` to the zone's `http_request_firewall_custom` ruleset, creating that
    /// ruleset first when the zone has never had one — a fresh zone has no custom-rules
    /// ruleset, and a bare rule-POST would 404 there.
    public func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {
        let rulesets = try await get("/zones/\(zoneID)/rulesets", apiToken: apiToken, as: [CFRuleset].self)
        let existing = rulesets.first(where: { $0.phase == "http_request_firewall_custom" })

        if let rs = existing {
            try await mutate(method: "POST", "/zones/\(zoneID)/rulesets/\(rs.id)/rules",
                             body: rule, apiToken: apiToken)
        } else {
            struct NewRuleset: Encodable, Sendable {
                let name: String
                let kind: String
                let phase: String
                let rules: [WAFRulePayload]
            }
            try await mutate(method: "POST", "/zones/\(zoneID)/rulesets",
                             body: NewRuleset(name: "Anglesite security rules",
                                              kind: "zone", phase: "http_request_firewall_custom",
                                              rules: [rule]),
                             apiToken: apiToken)
        }
    }

    /// `PATCH /zones/{id}/settings/speed_brain`, mapping `enabled` to `"on"/"off"`.
    public func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/speed_brain",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    /// `PATCH /zones/{id}/settings/ech` (Encrypted Client Hello), mapping `enabled` to
    /// `"on"/"off"`.
    public func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/ech",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    /// `PUT /zones/{id}/page_shield` — this endpoint takes a real boolean `enabled`, unlike the
    /// `"on"/"off"`-string settings endpoints.
    public func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/page_shield",
                         body: ["enabled": enabled], apiToken: apiToken)
    }

    /// `PATCH /zones/{id}/settings/opportunistic_onion` (Onion Routing for Tor visitors),
    /// mapping `enabled` to `"on"/"off"`.
    public func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/opportunistic_onion",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    /// Implements the attach as read-then-write: resolve the zone (short-circuiting to
    /// ``CustomDomainAttachResult/zoneNotFound`` for the common "nameservers not delegated yet"
    /// case before any account round-trip), list existing attachments for the hostname, and only
    /// `PUT /accounts/{id}/workers/domains` when nothing owns it — an attachment held by a
    /// *different* script comes back as ``CustomDomainAttachResult/conflict(ownedBy:)`` instead
    /// of being silently repointed (#1077).
    public func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        // Zone lookup first (cheap, account-agnostic) so the common "not delegated to Cloudflare
        // yet" case short-circuits without an extra account-id round trip.
        guard let zoneID = try await resolveZoneID(domain: hostname, apiToken: apiToken) else {
            return .zoneNotFound
        }
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        let escapedHostname = hostname.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? hostname
        let existing = try await get(
            "/accounts/\(accountID)/workers/domains?hostname=\(escapedHostname)",
            apiToken: apiToken, as: [CFWorkerDomain].self
        )
        if let match = existing.first(where: { $0.hostname.lowercased() == hostname.lowercased() }) {
            return match.service == workerScriptName ? .alreadyAttached : .conflict(ownedBy: match.service)
        }
        struct AttachBody: Encodable, Sendable {
            let zone_id: String
            let hostname: String
            let service: String
            let environment: String
        }
        try await mutate(
            method: "PUT", "/accounts/\(accountID)/workers/domains",
            body: AttachBody(zone_id: zoneID, hostname: hostname, service: workerScriptName, environment: "production"),
            apiToken: apiToken
        )
        return .attached
    }

    /// `PATCH /zones/{id}/settings/content_converter`, mapping `enabled` to `"on"/"off"` — same
    /// shape as `setSpeedBrain`/`setECH`. See ``CloudflareWriting/setMarkdownForAgents(hostname:enabled:apiToken:)``.
    public func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool {
        guard let zoneID = try await resolveZoneID(domain: hostname, apiToken: apiToken) else { return false }
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/content_converter",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
        return true
    }

    /// Adds a zstd-first (zstd → brotli → gzip) `compress_response` rule to the zone's
    /// `http_response_compression` ruleset, creating the ruleset when absent. Idempotent by
    /// inspection: an existing zstd rule means return without writing, so repeated hardening
    /// runs don't stack duplicate rules.
    public func enableZstandardCompression(zoneID: String, apiToken: String) async throws {
        struct CompressionRule: Encodable, Sendable {
            struct Params: Encodable, Sendable {
                struct Algorithm: Encodable, Sendable { let name: String }
                let algorithms: [Algorithm]
            }
            let description: String
            let expression: String
            let action: String
            let action_parameters: Params
        }
        let rule = CompressionRule(
            description: "Anglesite: prefer Zstandard compression",
            expression: "true",
            action: "compress_response",
            action_parameters: .init(algorithms: [
                .init(name: "zstd"), .init(name: "brotli"), .init(name: "gzip"),
            ]))

        let rulesets = try await get("/zones/\(zoneID)/rulesets", apiToken: apiToken, as: [CFRuleset].self)
        if let existing = rulesets.first(where: { $0.phase == "http_response_compression" }) {
            let full = try await get("/zones/\(zoneID)/rulesets/\(existing.id)", apiToken: apiToken, as: CFRuleset.self)
            let alreadyHasZstd = (full.rules ?? []).contains { rule in
                rule.action == "compress_response"
                    && (rule.action_parameters?.algorithms ?? []).contains { $0.name == "zstd" }
            }
            if alreadyHasZstd { return }
            try await mutate(method: "POST", "/zones/\(zoneID)/rulesets/\(existing.id)/rules",
                             body: rule, apiToken: apiToken)
        } else {
            struct NewRuleset: Encodable, Sendable {
                let name: String
                let kind: String
                let phase: String
                let rules: [CompressionRule]
            }
            try await mutate(method: "POST", "/zones/\(zoneID)/rulesets",
                             body: NewRuleset(name: "Anglesite compression rules",
                                              kind: "zone", phase: "http_response_compression",
                                              rules: [rule]),
                             apiToken: apiToken)
        }
    }
}

// MARK: - CloudflareRegistrarReading conformance

extension HTTPCloudflareClient: CloudflareRegistrarReading {
    /// Resolves the token's first visible account id — every Registrar endpoint is
    /// account-scoped. Mirrors `workerScriptNames`'s resolution exactly.
    private func resolveAccountID(apiToken: String) async throws -> String {
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        return accountID
    }

    /// POST `path` with `body`, decode `CFEnvelope<T>`, return its `result` — like `get`, but for
    /// POST calls that need the decoded payload back (unlike `mutate`, which only checks success).
    /// Shares request construction and status mapping with `mutate` via `send(method:_:body:apiToken:)`.
    private func post<Body: Encodable & Sendable, T: Decodable & Sendable>(
        _ path: String, body: Body, apiToken: String, as type: T.Type
    ) async throws -> T {
        let (data, _) = try await send(method: "POST", path, body: body, apiToken: apiToken)
        let env: CFEnvelope<T>
        do {
            env = try JSONDecoder().decode(CFEnvelope<T>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard env.success else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "request failed")
        }
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing result")
        }
        return result
    }

    /// See ``CloudflareRegistrarReading/searchDomains(query:apiToken:)``.
    ///
    /// Builds the request with `URLComponents`/`URLQueryItem` rather than manual string
    /// interpolation: `query` is free-text (e.g. a business name like "Smith & Sons"), and
    /// `CharacterSet.urlQueryAllowed` — the encoding used elsewhere in this file for hostnames,
    /// which never contain `&`/`=`/`+` — does not escape those characters. Left unescaped, `&`/`=`
    /// would truncate the `q` value at the API and corrupt or drop the `limit` parameter.
    ///
    /// `+` needs separate handling: `URLComponents.queryItems`/`.url` treat it as a legal RFC 3986
    /// sub-delimiter and never percent-encode it, but many server-side query parsers conventionally
    /// form-decode a literal `+` as a space. Left as-is, a search for "A+ Dental" or "C++ Institute"
    /// would silently arrive at the API as "A Dental" / "C  Institute". So `q`'s value is percent-encoded
    /// by hand — down to RFC 3986 unreserved characters, which also covers `&`/`=` — and assigned via
    /// `percentEncodedQueryItems` rather than `queryItems` (which would double-encode it).
    public func searchDomains(query: String, apiToken: String) async throws -> [String] {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        guard var components = URLComponents(string: Self.base + "/accounts/\(accountID)/registrar/domain-search") else {
            throw CloudflareError.malformedResponse
        }
        var queryValueAllowed = CharacterSet.alphanumerics
        queryValueAllowed.insert(charactersIn: "-._~")
        guard let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) else {
            throw CloudflareError.malformedResponse
        }
        components.percentEncodedQueryItems = [
            URLQueryItem(name: "q", value: encodedQuery),
            URLQueryItem(name: "limit", value: "20"),
        ]
        guard let url = components.url else { throw CloudflareError.malformedResponse }
        let response = try await get(url: url, apiToken: apiToken, as: CFRegistrarSearchResponse.self)
        return response.domains.map(\.name)
    }

    /// See ``CloudflareRegistrarReading/checkDomainAvailability(domains:apiToken:)``.
    public func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck] {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        let response = try await post(
            "/accounts/\(accountID)/registrar/domain-check",
            body: CFRegistrarCheckRequest(domains: domains), apiToken: apiToken,
            as: CFRegistrarCheckResponse.self)
        return response.domains.map {
            RegistrarDomainCheck(
                name: $0.name, registrable: $0.registrable, reason: $0.reason,
                registrationCost: $0.pricing?.registration_cost, currency: $0.pricing?.currency)
        }
    }
}

// MARK: - CloudflareRegistrarWriting conformance

extension HTTPCloudflareClient: CloudflareRegistrarWriting {
    /// `POST /accounts/{id}/registrar/registrations`. See
    /// ``CloudflareRegistrarWriting/registerDomain(name:apiToken:)``.
    ///
    /// Reuses `send(method:_:body:apiToken:)` for request construction and 401/403/non-2xx
    /// mapping (201 and 202 both already fall inside `send`'s 200..<300 success range) rather
    /// than duplicating that logic a third time alongside `mutate`/`post` — the only thing this
    /// call needs beyond `send` is branching on which 2xx status came back.
    public func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        let (data, http) = try await send(
            method: "POST", "/accounts/\(accountID)/registrar/registrations",
            body: CFRegistrarRegisterRequest(domain_name: name), apiToken: apiToken)
        if http.statusCode == 202 {
            return try await pollRegistrationStatus(domain: name, accountID: accountID, apiToken: apiToken)
        }
        return Self.outcome(forState: try Self.decodeState(from: data))
    }

    private static func decodeState(from data: Data) throws -> String {
        let env: CFEnvelope<CFRegistrarRegistrationState>
        do {
            env = try JSONDecoder().decode(CFEnvelope<CFRegistrarRegistrationState>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard env.success, let state = env.result?.state else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing registration state")
        }
        return state
    }

    private static func outcome(forState state: String) -> RegistrarRegistrationOutcome {
        switch state {
        case "succeeded": return .succeeded
        case "action_required": return .actionRequired
        case "blocked": return .blocked
        case "failed": return .failed(reason: "Cloudflare reported the registration failed.")
        default: return .stillProcessing
        }
    }

    /// Polls `registration-status` every 2.5s, up to 6 times (~15s total — matching the API's own
    /// "synchronous in most cases (10s timeout)" framing with one poll's margin past it). Resolves
    /// to `.stillProcessing` if `state` never leaves `in_progress` in that window. No task survives
    /// past this method returning — there is no background/long-lived polling.
    private func pollRegistrationStatus(
        domain: String, accountID: String, apiToken: String
    ) async throws -> RegistrarRegistrationOutcome {
        for _ in 0..<6 {
            try? await Task.sleep(for: .milliseconds(2500))
            let state = try await get(
                "/accounts/\(accountID)/registrar/registrations/\(domain)/registration-status",
                apiToken: apiToken, as: CFRegistrarRegistrationState.self)
            let outcome = Self.outcome(forState: state.state)
            if case .stillProcessing = outcome { continue }
            return outcome
        }
        return .stillProcessing
    }
}

// MARK: - AgentReadinessScanning conformance

extension HTTPCloudflareClient: AgentReadinessScanning {
    /// `POST /accounts/{id}/urlscanner/v2/scan` with `options.agentReadiness: true`. Submitted
    /// `unlisted` — the app shouldn't publish an owner's scan to Cloudflare's public URL Scanner
    /// listing without their say-so. Reuses `resolveAccountID` (the Registrar conformance above,
    /// same file so its `private` scope still applies) since URL Scanner is account-scoped too.
    public func submitAgentReadinessScan(url: URL, apiToken: String) async throws -> UUID {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        struct ScanRequest: Encodable, Sendable {
            struct Options: Encodable, Sendable { let agentReadiness: Bool }
            let url: String
            let visibility: String
            let options: Options
        }
        let body = ScanRequest(url: url.absoluteString, visibility: "unlisted", options: .init(agentReadiness: true))
        let (data, _) = try await send(method: "POST", "/accounts/\(accountID)/urlscanner/v2/scan", body: body, apiToken: apiToken)
        let submission: CFURLScanSubmission
        do {
            submission = try JSONDecoder().decode(CFURLScanSubmission.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard let scanID = UUID(uuidString: submission.uuid) else { throw CloudflareError.malformedResponse }
        return scanID
    }

    /// `GET /accounts/{id}/urlscanner/v2/result/{scan_id}`. Two different "not ready yet" shapes
    /// both map to `nil` rather than an error, so callers can poll in a loop without
    /// special-casing either: a 404 (the URL Scanner API's documented behavior for an in-flight
    /// scan id that hasn't produced *any* result yet), and a 200 whose `meta.processors` doesn't
    /// carry an `agentReadiness` section yet. That second case matters because the scan's base
    /// result (page load, requests) can land before its async processors — `agentReadiness`
    /// included — finish; without it, the very first poll (or every poll before that processor
    /// completes) would otherwise hard-fail with `.malformedResponse` instead of just meaning "not
    /// done yet". This was flagged in review (#1248) as unverified against a live scan — Cloudflare
    /// doesn't document a separate in-progress marker (e.g. on `task`) to distinguish that from a
    /// scan that's genuinely finished with no Agent Readiness data at all, so a persistently
    /// missing section still resolves the same way an in-progress one does: the caller's poll loop
    /// times out and surfaces "didn't finish in time" rather than a hard error either way. A
    /// response that doesn't even decode as the expected shape is left as `.malformedResponse` —
    /// that's a different, more clearly broken case than an optional inner section being absent.
    public func agentReadinessResult(scanID: UUID, apiToken: String) async throws -> AgentReadinessReport? {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        let (data, http) = try await fetchRaw(
            "/accounts/\(accountID)/urlscanner/v2/result/\(scanID.uuidString.lowercased())",
            apiToken: apiToken, passthroughStatuses: [404])
        if http.statusCode == 404 { return nil }
        let result: CFScanResult
        do {
            result = try JSONDecoder().decode(CFScanResult.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard let readiness = result.meta?.processors?.agentReadiness else {
            return nil
        }
        return Self.mapAgentReadinessReport(readiness)
    }

    /// Maps the raw wire shape to the public report, translating each check id through
    /// `AgentReadinessCatalog` for owner-friendly copy. A category with no checks in the response
    /// (all four are optional on the wire) is dropped rather than shown empty.
    private static func mapAgentReadinessReport(_ raw: CFAgentReadiness) -> AgentReadinessReport {
        func category(_ dict: [String: CFAgentReadinessCheck]?, id: String) -> AgentReadinessReport.Category? {
            guard let dict, !dict.isEmpty else { return nil }
            let checks = dict.map { checkID, rawCheck -> AgentReadinessReport.Check in
                let info = AgentReadinessCatalog.checkInfo(for: checkID)
                let status = AgentReadinessReport.Check.Status(rawValue: rawCheck.status.lowercased()) ?? .neutral
                return AgentReadinessReport.Check(
                    id: checkID, displayName: info.displayName, status: status,
                    hint: status == .pass ? info.passHint : info.failHint,
                    anglesiteProvides: info.anglesiteProvides)
            }.sorted { $0.displayName < $1.displayName }
            return AgentReadinessReport.Category(
                id: id, displayName: AgentReadinessCatalog.categoryDisplayName(for: id), checks: checks)
        }

        let categories = [
            category(raw.checks.discoverability, id: "discoverability"),
            category(raw.checks.contentAccessibility, id: "contentAccessibility"),
            category(raw.checks.botAccessControl, id: "botAccessControl"),
            category(raw.checks.discovery, id: "discovery"),
        ].compactMap { $0 }

        return AgentReadinessReport(
            level: raw.level, levelName: raw.levelName, categories: categories,
            nextLevel: raw.nextLevel.map { AgentReadinessReport.NextLevel(name: $0.name, target: $0.target) })
    }
}
