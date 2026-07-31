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
}
private struct CFAccount: Decodable, Sendable { let id: String }
private struct CFWorkerScript: Decodable, Sendable { let id: String }
private struct CFWorkerDomain: Decodable, Sendable { let hostname: String; let service: String }

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

/// Read-only Cloudflare v4 client. All methods are GETs.
public struct HTTPCloudflareClient: CloudflareReading {
    private static let base = "https://api.cloudflare.com/client/v4"
    private let transport: CloudflareTransport

    public init(transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport) {
        self.transport = transport
    }

    public static let defaultTransport: CloudflareTransport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CloudflareError.malformedResponse }
        return (data, http)
    }

    /// GET `path`, decode `CFEnvelope<T>`, return the whole envelope or throw a mapped error.
    private func getEnvelope<T: Decodable & Sendable>(_ path: String, apiToken: String, as: T.Type) async throws -> CFEnvelope<T> {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
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

    public func resolveZoneID(domain: String, apiToken: String) async throws -> String? {
        let escaped = domain.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? domain
        let zones = try await get("/zones?name=\(escaped)&status=active", apiToken: apiToken, as: [CFZone].self)
        return zones.first(where: { $0.name.lowercased() == domain.lowercased() })?.id
    }

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

    public func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] {
        let raw = try await paginated("/zones/\(zoneID)/dns_records?per_page=100", apiToken: apiToken, as: CFFullDNSRecord.self)
        return raw.map {
            DNSRecord(id: $0.id, type: $0.type, name: $0.name, content: $0.content,
                      ttl: $0.ttl, proxied: $0.proxied ?? false)
        }
    }

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

    private func mutate<Body: Encodable & Sendable>(
        method: String,
        _ path: String,
        body: Body,
        apiToken: String
    ) async throws {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
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

    /// Like `mutate`, but decodes and returns the response body instead of discarding it —
    /// `mutate`'s `CFEnvelope<CFEmpty>` can't express a caller that needs the created resource back.
    private func postEnvelope<Body: Encodable & Sendable, T: Decodable & Sendable>(
        _ path: String, body: Body, apiToken: String, as type: T.Type
    ) async throws -> CFEnvelope<T> {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        do {
            return try JSONDecoder().decode(CFEnvelope<T>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
    }
}

// MARK: - CloudflareWriting conformance

extension HTTPCloudflareClient: CloudflareWriting {
    public func enableDNSSEC(zoneID: String, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/dnssec",
                         body: ["status": "active"], apiToken: apiToken)
    }

    public func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/settings/always_use_https",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

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

    public func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {
        try await mutate(method: "POST", "/zones/\(zoneID)/dns_records",
                         body: record, apiToken: apiToken)
    }

    public func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {
        try await mutate(method: "DELETE", "/zones/\(zoneID)/dns_records/\(recordID)",
                         body: CFEmptyBody(), apiToken: apiToken)
    }

    public func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/bot_management",
                         body: ["fight_mode": enabled], apiToken: apiToken)
    }

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

    public func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/speed_brain",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    public func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/ech",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

    public func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PUT", "/zones/\(zoneID)/page_shield",
                         body: ["enabled": enabled], apiToken: apiToken)
    }

    public func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try await mutate(method: "PATCH", "/zones/\(zoneID)/settings/opportunistic_onion",
                         body: ["value": enabled ? "on" : "off"], apiToken: apiToken)
    }

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

// MARK: - AISearchProvisioning conformance

extension HTTPCloudflareClient: AISearchProvisioning {
    public func createAISearchInstance(
        domain: String, instanceID: String, apiToken: String
    ) async throws -> AISearchInstance {
        struct CFAccount: Decodable, Sendable { let id: String }
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }

        struct CreateBody: Encodable, Sendable {
            let id: String
            let type: String
            let source_params: SourceParams
            struct SourceParams: Encodable, Sendable {
                let web_crawler: WebCrawler
                struct WebCrawler: Encodable, Sendable {
                    let parse_type: String
                }
            }
        }
        struct CFAISearchInstance: Decodable, Sendable {
            let id: String
            let name: String?
        }
        let body = CreateBody(
            id: instanceID, type: "web-crawler",
            source_params: .init(web_crawler: .init(parse_type: "sitemap")))
        let env = try await postEnvelope(
            "/accounts/\(accountID)/ai-search/namespaces/\(instanceID)/instances",
            body: body, apiToken: apiToken, as: CFAISearchInstance.self)
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "AI Search instance creation returned no result")
        }
        return AISearchInstance(id: result.id, name: result.name ?? instanceID)
    }
}
