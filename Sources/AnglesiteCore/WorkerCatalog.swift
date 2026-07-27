import Foundation

/// One `@dwk/workers` package as described by the monorepo's published catalog manifest
/// (`catalog.json`). Intentionally generic — this app never hardcodes specific worker names
/// (design doc §3): whatever the manifest lists is what the Workers tab shows and what deploy
/// composition can activate.
public struct WorkerDescriptor: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let displayName: String
    public let description: String
    /// Free-text grouping key the Workers tab sections by (e.g. `"social"`, `"storage"`) — never
    /// enumerated in Swift, since the manifest owns the set of groups.
    public let group: String
    public let binding: Binding
    public let resources: Resources
    /// Generic HTTP route claims this worker's handler serves (#746). Optional so catalogs
    /// published before the route-claim schema extension still decode; `nil` (or `[]`) means the
    /// worker claims no dynamic routes and composition emits no `run_worker_first` entry for it.
    /// Only claims from the *effective active* descriptor set (#709's
    /// `WorkerActivation.effectiveActiveIDs`) ever reach routing configuration — see
    /// `WorkerRouteClaims.activeClaims`.
    public let routes: [WorkerRouteClaim]?
    /// Ids of other catalog workers this one requires to function (e.g. Micropub requires
    /// IndieAuth's issued-token store). Optional so catalogs published before this field existed
    /// still decode; `nil` (or `[]`) means no dependency. `WorkerActivation.effectiveActiveIDs`
    /// resolves this transitively — activating a worker with a `requires` entry also activates
    /// the ids it names, provided they're present in the catalog.
    public let requires: [String]?

    public init(
        id: String,
        displayName: String,
        description: String,
        group: String,
        binding: Binding,
        resources: Resources,
        routes: [WorkerRouteClaim]? = nil,
        requires: [String]? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.description = description
        self.group = group
        self.binding = binding
        self.resources = resources
        self.routes = routes
        self.requires = requires
    }

    /// How a worker becomes active. `componentTied` workers are never manually toggled — their
    /// active state is always recomputed from Site Graph Explorer's `ImpactAnalysis` against
    /// `componentIDs` (design doc §4). `settingsActivated` workers are toggled in the Workers tab.
    public enum Binding: Sendable, Equatable, Codable {
        case componentTied(componentIDs: [String])
        case settingsActivated

        private enum CodingKeys: String, CodingKey {
            case kind
            case componentIDs
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let kind = try container.decode(String.self, forKey: .kind)
            switch kind {
            case "componentTied":
                let componentIDs = try container.decode([String].self, forKey: .componentIDs)
                self = .componentTied(componentIDs: componentIDs)
            case "settingsActivated":
                self = .settingsActivated
            default:
                throw DecodingError.dataCorruptedError(
                    forKey: .kind, in: container, debugDescription: "unknown binding kind \"\(kind)\"")
            }
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .componentTied(let componentIDs):
                try container.encode("componentTied", forKey: .kind)
                try container.encode(componentIDs, forKey: .componentIDs)
            case .settingsActivated:
                try container.encode("settingsActivated", forKey: .kind)
            }
        }
    }

    /// Manifest-driven equivalent of the `needsD1`/`needsKV`/`needsR2` flags the old
    /// `WorkerComposition.Feature` enum used to hand-maintain as switch statements (removed by
    /// #708's descriptor migration).
    ///
    /// Decodes both published shapes (#914): the original object form (`{"needsD1": true, …}`)
    /// used by this app's own fixtures and any pre-drift cache, and the array-of-typed-bindings
    /// form the catalog has actually published since its first commit
    /// (`[{"type": "d1", "binding": "AUTH_DB"}, …]` — davidwkeith/workers spec/catalog.md).
    /// `d1`/`kv`/`r2` entry types map to the flags; other types (`secret`, `queue`, `cron`) have
    /// no provisioning flag yet and are ignored here — adopting their fidelity is future work,
    /// not silently claimed. Encoding always emits the object form.
    public struct Resources: Sendable, Equatable, Codable {
        public let needsD1: Bool
        public let needsKV: Bool
        public let needsR2: Bool

        public init(needsD1: Bool, needsKV: Bool, needsR2: Bool) {
            self.needsD1 = needsD1
            self.needsKV = needsKV
            self.needsR2 = needsR2
        }

        private enum CodingKeys: String, CodingKey {
            case needsD1, needsKV, needsR2
        }

        /// One entry of the published array form. Only `type` matters to the flags; `binding`
        /// and any other keys are ignored.
        private struct BindingEntry: Decodable {
            let type: String
        }

        public init(from decoder: Decoder) throws {
            if var entries = try? decoder.unkeyedContainer() {
                var d1 = false, kv = false, r2 = false
                while !entries.isAtEnd {
                    switch try entries.decode(BindingEntry.self).type.lowercased() {
                    case "d1": d1 = true
                    case "kv": kv = true
                    case "r2": r2 = true
                    default: break
                    }
                }
                self.init(needsD1: d1, needsKV: kv, needsR2: r2)
                return
            }
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.init(
                needsD1: try container.decode(Bool.self, forKey: .needsD1),
                needsKV: try container.decode(Bool.self, forKey: .needsKV),
                needsR2: try container.decode(Bool.self, forKey: .needsR2))
        }
    }
}

/// One HTTP route a worker's handler claims, as declared by `catalog.json` (#746, #690 design
/// §"Dynamic Worker routes"). The claim is metadata about the deployed Worker script's routing —
/// the handler code itself lives in the composed Worker entry point (the template's
/// `worker/worker.ts`), whose route table mirrors these claims.
///
/// Catalog JSON shape (all route fields; `validatorID` and `specificationURL` optional,
/// `authorityBinding` defaults to `false`):
///
/// ```json
/// "routes": [
///   {
///     "path": "/.well-known/webfinger",
///     "match": "exact",
///     "methods": ["GET", "HEAD"],
///     "handler": "webfinger",
///     "validatorID": "rfc7033",
///     "authorityBinding": true,
///     "specificationURL": "https://www.rfc-editor.org/rfc/rfc7033"
///   }
/// ]
/// ```
public struct WorkerRouteClaim: Sendable, Equatable, Hashable, Codable {
    /// How requests bind to `path`. `exact` matches only the path itself; `prefix` additionally
    /// matches descendants (`path` + `/…`) and is valid only for protocols whose specification
    /// approves child paths (RFC 8615's ACME-style delegation) — enforced by
    /// `WorkerRouteClaims.validate` requiring `specificationURL` on prefix claims.
    public enum Match: String, Sendable, Codable {
        case exact
        case prefix
    }

    /// Absolute origin path, e.g. `"/.well-known/webfinger"`. Validated by
    /// `WorkerRouteClaims.validate` (leading slash, no traversal/encoding/query, no root or bare
    /// `/.well-known` claims). A `prefix` claim's trailing slash — the `davidwkeith/workers`
    /// catalog's published convention (`spec/catalog.md`: "a prefix path ends with `/`") — is
    /// stripped on construction so this always holds the app's own slash-less canonical form.
    public let path: String
    public let match: Match
    /// Uppercase HTTP methods the handler serves. `HEAD` must be declared explicitly to be
    /// supported and requires a paired `GET` (the dispatcher serves HEAD by mirroring GET's
    /// headers without a body — enforced by `WorkerRouteClaims.validate`); undeclared methods
    /// get `405` + `Allow` from the Worker's dispatcher.
    public let methods: [String]
    /// Stable handler identity inside the composed Worker script — ties the claim to the code
    /// that answers it.
    public let handler: String
    /// Protocol-validator identity (#744's registry). `nil` means the route is inventory-only:
    /// Anglesite makes no conformance claim for it.
    public let validatorID: String?
    /// Whether responses on this route bind an identity/application/policy to the whole origin
    /// (design doc §"What RFC 8615 provides") — such routes warrant extra care in collision and
    /// review surfaces.
    public let authorityBinding: Bool
    /// The governing protocol specification. Required for `prefix` claims (only a specification
    /// can approve child paths); recommended for exact claims.
    public let specificationURL: URL?

    public init(
        path: String,
        match: Match,
        methods: [String],
        handler: String,
        validatorID: String? = nil,
        authorityBinding: Bool = false,
        specificationURL: URL? = nil
    ) {
        self.path = Self.normalizedPrefixPath(path, match: match)
        self.match = match
        self.methods = methods
        self.handler = handler
        self.validatorID = validatorID
        self.authorityBinding = authorityBinding
        self.specificationURL = specificationURL
    }

    private enum CodingKeys: String, CodingKey {
        case path, match, methods, handler, validatorID, authorityBinding, specificationURL
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedPath = try container.decode(String.self, forKey: .path)
        let decodedMatch = try container.decode(Match.self, forKey: .match)
        path = Self.normalizedPrefixPath(decodedPath, match: decodedMatch)
        match = decodedMatch
        methods = try container.decode([String].self, forKey: .methods)
        handler = try container.decode(String.self, forKey: .handler)
        validatorID = try container.decodeIfPresent(String.self, forKey: .validatorID)
        authorityBinding = try container.decodeIfPresent(Bool.self, forKey: .authorityBinding) ?? false
        specificationURL = try container.decodeIfPresent(URL.self, forKey: .specificationURL)
    }

    /// Strips a single trailing slash from a `prefix` claim's path — the `davidwkeith/workers`
    /// catalog declares prefix paths with a trailing slash (`spec/catalog.md`), while
    /// `WorkerRouteClaims.validate` and `runWorkerFirstPatterns` expect the slash-less form and
    /// append their own `/*` glob. `exact` claims and the bare root are left untouched so a
    /// genuinely malformed exact-match trailing slash still fails validation.
    private static func normalizedPrefixPath(_ path: String, match: Match) -> String {
        guard match == .prefix, path.count > 1, path.hasSuffix("/") else { return path }
        return String(path.dropLast())
    }
}

/// Parses `catalog.json` (the `@dwk/workers` monorepo's published worker manifest) into
/// `WorkerDescriptor`s. Stateless — call `parse(_:)` directly, mirroring
/// `WorkersConformanceReader`'s shape.
public enum WorkerCatalogReader {
    private struct Root: Decodable {
        let workers: [WorkerDescriptor]
    }

    /// Decodes `data` (UTF-8 JSON matching the `catalog.json` schema) and returns its
    /// `WorkerDescriptor`s. Throws a `DecodingError` if the JSON is malformed.
    public static func parse(_ data: Data) throws -> [WorkerDescriptor] {
        try JSONDecoder().decode(Root.self, from: data).workers
    }
}
