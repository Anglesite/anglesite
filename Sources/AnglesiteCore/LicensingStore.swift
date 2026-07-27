import Foundation

/// A license the site can point at: a canonical URL plus a human-readable label. Mirrors
/// `LicenseRef` in `Resources/Template/src/lib/licensing.ts`.
public struct LicenseRef: Sendable, Equatable, Hashable, Codable {
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
    /// depends on which page renders it.
    ///
    /// The template checks this too, at read time. This copy exists because the app is now a
    /// *writer* of `licensing.json`, and a write path that can store a `javascript:` URL is a
    /// worse failure than one that renders it — the file outlives the session that wrote it.
    public static func isSafeLicenseURL(_ url: String) -> Bool {
        if url.hasPrefix("/") && !url.hasPrefix("//") { return true }
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
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
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaultLicense = try container.decodeIfPresent(LicenseRef.self, forKey: .default)
        let usage = try container.decodeIfPresent(AIUsage.self, forKey: .usage) ?? AIUsage()
        var collections: [LicensableCollection: CollectionLicenseRule] = [:]
        if container.contains(.collections) {
            let sub = try container.nestedContainer(keyedBy: CollectionKey.self, forKey: .collections)
            for key in sub.allKeys {
                // Unrecognized collection keys are dropped rather than passed through, matching
                // normalizePolicy's treatment of a typo'd key.
                guard let collection = LicensableCollection(rawValue: key.stringValue) else { continue }
                if try sub.decodeNil(forKey: key) {
                    collections[collection] = .assertNothing
                } else if let ref = try? sub.decode(LicenseRef.self, forKey: key) {
                    collections[collection] = .license(ref)
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

    public func save(_ policy: LicensingPolicy) throws {
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
        if let defaultLicense = policy.defaultLicense { refs.append(defaultLicense) }
        for rule in policy.collections.values {
            if case .license(let ref) = rule { refs.append(ref) }
        }
        for ref in refs where !LicenseRef.isSafeLicenseURL(ref.url) {
            throw ValidationError.unsafeLicenseURL(ref.url)
        }
    }
}
