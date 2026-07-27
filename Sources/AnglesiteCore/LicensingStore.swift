import Foundation

/// A license the site can point at: a canonical URL plus a human-readable label. Mirrors
/// `LicenseRef` in `Resources/Template/src/lib/licensing.ts`.
public struct LicenseRef: Sendable, Equatable, Hashable {
    public var url: String
    public var name: String

    public init(url: String, name: String) {
        self.url = url
        self.name = name
    }

    /// Whether `url` is safe to emit unguarded into `href`/`rel="license"`. A Swift mirror of
    /// `hasSafeLicenseScheme` in `licensing.ts`: allow-list `http`/`https` so an unanticipated
    /// scheme is rejected by default, and additionally accept a root-relative path for a
    /// site-local license page. A protocol-relative URL is rejected because it hands an
    /// attacker-chosen host to `href`; a bare relative path is rejected because its resolution
    /// depends on which page renders it. `hasSafeLicenseScheme` also requires a non-empty host
    /// (`new URL("http://")` throws in WHATWG parsing — there is no authority to point at), so
    /// this checks `parsed.host` too rather than stopping at the scheme.
    ///
    /// The template checks this too, at read time. This copy exists because the app is now a
    /// *writer* of `licensing.json`, and a write path that can store a `javascript:` URL is a
    /// worse failure than one that renders it — the file outlives the session that wrote it.
    public static func isSafeLicenseURL(_ url: String) -> Bool {
        // The leading-slash fast path must run against the *sanitized* string, not the raw one:
        // browsers strip ASCII tab/CR/LF before parsing a URL, so an unsanitized check on
        // `"/\t/evil.com"` sees a single leading slash and (wrongly) accepts it as root-relative,
        // while a browser resolves the sanitized `"//evil.com"` as protocol-relative — handing an
        // attacker-chosen host to href. Sanitizing first is what makes this guard match the
        // protocol-relative rejection it claims to provide (#991 review finding 2).
        let sanitized = whatwgTrim(url)
        // A backslash right after the leading slash must be rejected exactly like a second
        // slash: WHATWG's relative-slash state treats `\` the same as `/` for special schemes, so
        // `/\evil.com` and `/\/evil.com` both enter "special authority ignore slashes" and parse
        // `evil.com` as the authority once a browser resolves them against an `http(s)` base —
        // the same attacker-chosen-host hazard the `//` check exists for (#991 review finding 2).
        let afterLeadingSlash = sanitized.hasPrefix("/") ? sanitized.dropFirst() : Substring()
        let isUnambiguousRootRelative = sanitized.hasPrefix("/")
            && !afterLeadingSlash.hasPrefix("/") && !afterLeadingSlash.hasPrefix("\\")
        if isUnambiguousRootRelative { return true }
        guard let parsed = URL(string: sanitized), let scheme = parsed.scheme?.lowercased() else { return false }
        guard scheme == "http" || scheme == "https" else { return false }
        guard let host = parsed.host, !host.isEmpty else { return false }
        return true
    }

    /// Mirrors the input-sanitization step the WHATWG URL parser runs before parsing: strip every
    /// ASCII tab/CR/LF wherever it occurs, then trim leading/trailing C0 control characters or
    /// space. `new URL()` in the TS original tolerates (and silently cleans) `" http://evil.com"`
    /// or a trailing tab; Foundation's `URL(string:)` just fails to parse a string carrying any of
    /// these, so without this step Swift would be *stricter* than the rule it is meant to mirror.
    private static func whatwgTrim(_ url: String) -> String {
        let withoutTabsOrNewlines = url.unicodeScalars.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }
        var scalars = Array(withoutTabsOrNewlines)
        func isC0OrSpace(_ scalar: Unicode.Scalar) -> Bool { scalar.value <= 0x20 }
        while let first = scalars.first, isC0OrSpace(first) { scalars.removeFirst() }
        while let last = scalars.last, isC0OrSpace(last) { scalars.removeLast() }
        return String(String.UnicodeScalarView(scalars))
    }
}

/// Custom `Codable` conformance mirrors `toLicenseRef` in `licensing.ts`: `url` is required and
/// must pass `isSafeLicenseURL`, and `name` falls back to `url` when absent or empty. A malformed
/// or unsafe value throws here rather than silently producing an untrustworthy `LicenseRef` —
/// callers (`LicensingPolicy`'s `default` and `collections` decoding) catch the throw and degrade
/// to "assert nothing" instead of propagating it, which is what makes the sanitization apply on
/// every parse (`load()` included), not only on the app's own `save()`/`validate()` write path.
extension LicenseRef: Codable {
    private enum CodingKeys: String, CodingKey {
        case url, name
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let url = try container.decode(String.self, forKey: .url)
        guard !url.isEmpty, Self.isSafeLicenseURL(url) else {
            throw DecodingError.dataCorruptedError(
                forKey: .url, in: container, debugDescription: "license url is missing or unsafe")
        }
        let name = (try? container.decodeIfPresent(String.self, forKey: .name)) ?? nil
        self.url = url
        self.name = (name?.isEmpty == false) ? name! : url
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(url, forKey: .url)
        try container.encode(name, forKey: .name)
    }
}

/// A per-purpose AI usage permission. `unset` means the site states no preference; it is never
/// written to `licensing.json`, matching `UsagePermission` in `licensing.ts`.
public enum UsagePermission: String, Sendable, Equatable, CaseIterable, Identifiable {
    case unset
    case yes
    case no
    public var id: Self { self }
}

/// Site-wide AI usage permissions (#991). `robots.txt`'s `Content-Signal` directive and its
/// named-agent blocklist are both derived from this by `scripts/edge-artifacts.ts`, so they cannot
/// disagree with each other.
public struct AIUsage: Sendable, Equatable {
    public var search: UsagePermission
    public var aiInput: UsagePermission
    public var aiTrain: UsagePermission
    public var blockAICrawlers: Bool

    public init(
        search: UsagePermission = .unset,
        aiInput: UsagePermission = .unset,
        aiTrain: UsagePermission = .unset,
        blockAICrawlers: Bool = false
    ) {
        self.search = search
        self.aiInput = aiInput
        self.aiTrain = aiTrain
        self.blockAICrawlers = blockAICrawlers
    }

    /// Whether the blocklist may fire. Blocking is stronger than signalling, not contradictory, so
    /// the only rule is that it never exceed what the permissions deny — and the 17-agent list
    /// covers both AI answers and AI training. Mirrors `mayBlockAICrawlers` in `licensing.ts`.
    public var mayBlockAICrawlers: Bool { aiInput == .no && aiTrain == .no }

    /// This policy with an unpermitted blocklist turned off. Applied on both load and save so
    /// neither a hand-edited document nor a UI race can persist a contradiction.
    public var clamped: AIUsage {
        var copy = self
        copy.blockAICrawlers = blockAICrawlers && mayBlockAICrawlers
        return copy
    }
}

extension AIUsage: Codable {
    private enum CodingKeys: String, CodingKey {
        case search, aiInput, aiTrain, blockAICrawlers
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func permission(_ key: CodingKeys) -> UsagePermission {
            // decodeIfPresent(String:) rather than the enum: an unrecognized value must degrade to
            // `unset` the way normalizeUsage drops it, not fail the whole document.
            let raw = (try? container.decodeIfPresent(String.self, forKey: key)) ?? nil
            return UsagePermission(rawValue: raw ?? "") ?? .unset
        }
        self.init(
            search: permission(.search),
            aiInput: permission(.aiInput),
            aiTrain: permission(.aiTrain),
            blockAICrawlers: ((try? container.decodeIfPresent(Bool.self, forKey: .blockAICrawlers)) ?? nil) ?? false
        )
        self = clamped
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let usage = clamped
        if usage.search != .unset { try container.encode(usage.search.rawValue, forKey: .search) }
        if usage.aiInput != .unset { try container.encode(usage.aiInput.rawValue, forKey: .aiInput) }
        if usage.aiTrain != .unset { try container.encode(usage.aiTrain.rawValue, forKey: .aiTrain) }
        try container.encode(usage.blockAICrawlers, forKey: .blockAICrawlers)
    }
}

/// Every collection that can carry a license — the routed collections plus `blog`. Mirrors
/// `LicensableCollection` in `licensing.ts`; the order here is the order the settings facet lists.
public enum LicensableCollection: String, Sendable, Equatable, CaseIterable, Identifiable, Codable {
    case notes, articles, photos, albums, bookmarks, replies, likes, announcements, events, reviews, blog
    public var id: Self { self }

    /// Collections whose entries are responses to, or quotations of, third-party work. A site
    /// owner cannot license someone else's article by bookmarking it, so these assert nothing
    /// unless explicitly overridden. Mirrors `NON_ASSERTING_COLLECTIONS` in `licensing.ts`.
    public var assertsNothingByDefault: Bool {
        switch self {
        case .bookmarks, .replies, .likes, .reviews: true
        default: false
        }
    }
}

/// What one collection does about licensing. The three cases are exactly the three states
/// `licensing.json` can express, and the distinction is load-bearing: `inherit` (the key is
/// absent) falls through to the site default or the non-asserting rule, while `assertNothing`
/// (an explicit `null`) beats both.
public enum CollectionLicenseRule: Sendable, Equatable, Hashable {
    case inherit
    case assertNothing
    case license(LicenseRef)
}

/// The whole content licensing policy: `Source/src/data/licensing.json`.
public struct LicensingPolicy: Sendable, Equatable {
    /// Site-wide default, or nil for "assert nothing" (all rights reserved — the legal default).
    public var defaultLicense: LicenseRef?
    /// Only non-`inherit` rules are stored; an absent key *is* `inherit`.
    public var collections: [LicensableCollection: CollectionLicenseRule]
    public var usage: AIUsage

    public init(
        defaultLicense: LicenseRef? = nil,
        collections: [LicensableCollection: CollectionLicenseRule] = [:],
        usage: AIUsage = AIUsage()
    ) {
        self.defaultLicense = defaultLicense
        self.collections = collections
        self.usage = usage
    }

    public func rule(for collection: LicensableCollection) -> CollectionLicenseRule {
        collections[collection] ?? .inherit
    }

    public mutating func setRule(_ rule: CollectionLicenseRule, for collection: LicensableCollection) {
        if rule == .inherit {
            collections.removeValue(forKey: collection)
        } else {
            collections[collection] = rule
        }
    }
}

extension LicensingPolicy: Codable {
    private enum CodingKeys: String, CodingKey {
        case `default`, collections, usage
    }

    /// `collections` is a free-form object whose values are either null or a license, so it needs
    /// dynamic keys. `JSONDecoder`'s dictionary support would collapse the null case into an
    /// absent key, losing the distinction `rule(for:)` depends on.
    private struct CollectionKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    public init(from decoder: any Decoder) throws {
        // A syntactically valid JSON document that isn't an object at the top level (a bare
        // string, number, bool, or array) degrades to the empty policy rather than throwing —
        // matching `normalizePolicy`'s `typeof raw !== "object"` guard (and, for the array case
        // specifically, its natural degrade via destructuring properties that don't exist on an
        // array). Only a `decoder.container(keyedBy:)` failure lands here; a document that isn't
        // JSON at all fails earlier, inside `JSONDecoder`'s own parse, and still throws.
        guard let container = try? decoder.container(keyedBy: CodingKeys.self) else {
            self.init()
            return
        }
        // A malformed `default` (missing `url`, wrong shape, or a URL `LicenseRef`'s own decode
        // rejects as unsafe) degrades to nil instead of failing the whole document — matching
        // `toLicenseRef`'s null return in `normalizePolicy`. This is also what sanitizes a
        // hand-edited unsafe URL at *load* time: `Self.validate`/`save()` cover the write path,
        // this covers the read path, and they are deliberately different guarantees.
        //
        // This degrade is silent by design — no `licensingError`, no `licensingLoadFailed` — and
        // that has a real, if narrow, cost: a hand-edited `licensing.json` with a URL WHATWG's
        // parser accepts but Foundation's `URL(string:)` does not (e.g. a single-slash
        // `"http:/example.com/license"`) still builds and renders correctly on the site, but the
        // app shows "All rights reserved" for it, and the next save of *any* licensing field
        // re-encodes the in-memory (now-nil) `defaultLicense`, permanently dropping the license
        // from the file. This is intentionally left as-is — failing safe (never asserting an
        // unparseable license) matters more than surfacing every parser divergence — but a future
        // reader should not be surprised by it (#991 review finding 5).
        let defaultLicense = (try? container.decodeIfPresent(LicenseRef.self, forKey: .default)) ?? nil
        // A wrong-typed `usage` (a string, number, or array rather than an object) degrades to the
        // all-unset default instead of throwing — matching `normalizeUsage`'s `typeof raw !==
        // "object"` guard (and the array case's equivalent natural degrade via destructuring).
        // `try?` around the whole call is required, not just around the inner decode: the failure
        // happens inside `AIUsage.init(from:)`'s own `decoder.container(keyedBy:)` call.
        let usage = ((try? container.decodeIfPresent(AIUsage.self, forKey: .usage)) ?? nil) ?? AIUsage()
        var collections: [LicensableCollection: CollectionLicenseRule] = [:]
        // `"collections": null` is present-but-null; `normalizePolicy`'s `rawCollections &&
        // typeof rawCollections === "object"` check is falsy for `null` (short-circuiting before
        // `typeof`), so it is treated as empty rather than a decode error.
        if try container.contains(.collections) && !container.decodeNil(forKey: .collections) {
            // A wrong-typed `collections` (a string, number, or array rather than an object)
            // degrades to empty instead of throwing — matching `normalizePolicy`'s `typeof
            // rawCollections === "object"` guard for a string/number, and, for an array, its
            // natural degrade (every numeric-index key fails `isLicensable`).
            if let sub = try? container.nestedContainer(keyedBy: CollectionKey.self, forKey: .collections) {
                for key in sub.allKeys {
                    // Unrecognized collection keys are dropped rather than passed through, matching
                    // normalizePolicy's treatment of a typo'd key.
                    guard let collection = LicensableCollection(rawValue: key.stringValue) else { continue }
                    if try sub.decodeNil(forKey: key) {
                        collections[collection] = .assertNothing
                    } else if let ref = try? sub.decode(LicenseRef.self, forKey: key) {
                        collections[collection] = .license(ref)
                    } else {
                        // A present value that is neither null nor a trustworthy license (garbage
                        // shape, missing url, unsafe scheme) still asserts nothing — exactly like
                        // `toLicenseRef` returning null for a present key in `normalizePolicy`. It
                        // must NOT fall through to `.inherit`: `inherit` resolves to the site default,
                        // which would assert a license this document never actually granted here.
                        collections[collection] = .assertNothing
                    }
                }
            }
        }
        self.init(defaultLicense: defaultLicense, collections: collections, usage: usage.clamped)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Always written, including as an explicit null: `"default": null` is the scaffolded value
        // and says "all rights reserved" out loud rather than by omission.
        try container.encode(defaultLicense, forKey: .default)
        try container.encode(usage.clamped, forKey: .usage)
        var sub = container.nestedContainer(keyedBy: CollectionKey.self, forKey: .collections)
        // Sorted so a save produces a stable diff in the site's git repo.
        for collection in LicensableCollection.allCases {
            guard let key = CollectionKey(stringValue: collection.rawValue) else { continue }
            switch collections[collection] {
            case .none, .inherit: continue
            case .assertNothing: try sub.encodeNil(forKey: key)
            case .license(let ref): try sub.encode(ref, forKey: key)
            }
        }
    }
}

/// Reads/writes `Source/src/data/licensing.json` — the git-tracked content licensing policy the
/// template's `licensing.ts` and `edge-artifacts.ts` consume at build time. Rooted at
/// `sourceDirectory` (the `Source/` git repo), not `Config/`, on the same reasoning as
/// `RedirectsStore`: the policy is site content and travels with the repo.
public struct LicensingStore: Sendable {
    public enum ValidationError: Error, Equatable {
        /// A URL the template's own scheme guard would reject at render time. Refusing it here
        /// keeps it out of the file entirely.
        case unsafeLicenseURL(String)
    }

    public static let relativePath = "src/data/licensing.json"

    private let fileURL: URL
    private let fileManager: FileManager

    public init(sourceDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = sourceDirectory.appendingPathComponent(Self.relativePath)
        self.fileManager = fileManager
    }

    /// An empty policy (not a throw) when the file is absent — the normal state of a site
    /// scaffolded before it had one.
    public func load() throws -> LicensingPolicy {
        guard fileManager.fileExists(atPath: fileURL.path) else { return LicensingPolicy() }
        return try JSONDecoder().decode(LicensingPolicy.self, from: try Data(contentsOf: fileURL))
    }

    /// `policy` with an empty-URL default license normalized to nil. `ContentLicensingTab`'s
    /// "Custom…" picker choice reveals the URL/name fields without writing a `LicenseRef` into the
    /// model until a URL is actually typed, but this is a second, independent line of defense: no
    /// path through this store — save, validate, or a future caller — can persist or reject on an
    /// empty-URL default, because an empty URL points nowhere and is indistinguishable from
    /// "assert nothing" (#991 review finding 1).
    public static func normalized(_ policy: LicensingPolicy) -> LicensingPolicy {
        var policy = policy
        if policy.defaultLicense?.url.isEmpty == true {
            policy.defaultLicense = nil
        }
        return policy
    }

    public func save(_ policy: LicensingPolicy) throws {
        let policy = Self.normalized(policy)
        try Self.validate(policy)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(policy)
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
    }

    public static func validate(_ policy: LicensingPolicy) throws {
        var refs: [LicenseRef] = []
        // An empty-URL default is "no license", the same as nil — not an unsafe URL to reject.
        // `isSafeLicenseURL("")` already returns false, so without this guard `validate` would
        // throw `unsafeLicenseURL("")` for a policy `save()` was about to normalize away anyway;
        // this keeps that true for any other caller of `validate` too.
        if let defaultLicense = policy.defaultLicense, !defaultLicense.url.isEmpty {
            refs.append(defaultLicense)
        }
        for rule in policy.collections.values {
            if case .license(let ref) = rule { refs.append(ref) }
        }
        for ref in refs where !LicenseRef.isSafeLicenseURL(ref.url) {
            throw ValidationError.unsafeLicenseURL(ref.url)
        }
    }
}
