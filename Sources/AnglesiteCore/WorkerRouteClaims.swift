import Foundation

/// Validates the generic HTTP route claims declared by `WorkerDescriptor.routes` and derives the
/// effective active route set a deploy actually exposes (#746, #690 design §"Dynamic Worker
/// routes"). Pure — no I/O, no actor isolation — mirroring `WorkerActivation`'s shape: callers
/// gather the catalog and the #709 effective active id set first.
///
/// This type owns route *claim* validity and Worker-first route derivation only. Cross-owner
/// `.well-known` collision enforcement (static vs generated vs dynamic vs runtime-owned) is
/// #744's `WellKnownInventory`; it consumes `wellKnownClaims(_:)` below as its dynamic-route
/// input rather than re-deriving activation or re-validating paths itself.
public enum WorkerRouteClaims {
    /// A validated claim attributed to the worker (catalog descriptor id) that declared it —
    /// the attribution #744 needs to name both owners in a collision report.
    public struct OwnedClaim: Sendable, Equatable, Hashable {
        public let owner: String
        public let claim: WorkerRouteClaim

        public init(owner: String, claim: WorkerRouteClaim) {
            self.owner = owner
            self.claim = claim
        }
    }

    public enum ValidationError: Error, Equatable, CustomStringConvertible {
        case invalidPath(owner: String, path: String, reason: String)
        case invalidMethods(owner: String, path: String, reason: String)
        /// A `prefix` claim with no governing `specificationURL` — only a protocol specification
        /// can approve child paths (RFC 8615), so an undeclared prefix claim is rejected.
        case undeclaredPrefix(owner: String, path: String)
        case duplicateClaim(path: String, owners: [String])
        case overlappingClaims(path: String, owner: String, otherPath: String, otherOwner: String)

        public var description: String {
            switch self {
            case .invalidPath(let owner, let path, let reason):
                return "worker \"\(owner)\" claims invalid route path \"\(path)\": \(reason)"
            case .invalidMethods(let owner, let path, let reason):
                return "worker \"\(owner)\" route \"\(path)\" has invalid methods: \(reason)"
            case .undeclaredPrefix(let owner, let path):
                return "worker \"\(owner)\" claims prefix route \"\(path)\" without a governing specificationURL — only a specification-approved prefix may match child paths"
            case .duplicateClaim(let path, let owners):
                return "route \"\(path)\" is claimed more than once (by: \(owners.joined(separator: ", ")))"
            case .overlappingClaims(let path, let owner, let otherPath, let otherOwner):
                return "route \"\(path)\" (worker \"\(owner)\") overlaps \"\(otherPath)\" (worker \"\(otherOwner)\")"
            }
        }
    }

    /// HTTP methods a claim may declare. A closed set: anything else in a catalog is a manifest
    /// error, not a forward-compatibility case — new methods need app-side dispatch support
    /// anyway. The WebDAV Class 2 verbs (PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK/UNLOCK, RFC 4918)
    /// were added once that dispatch existed (`createSolidPodWebdav` in `worker.ts`).
    static let allowedMethods: Set<String> = [
        "GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS",
        "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK",
    ]

    private static let maxPathLength = 512

    /// RFC 3986 `pchar` minus `pct-encoded`, plus `/`. Percent-encoding is rejected outright —
    /// claimed protocol paths are literal registered names, and encoded separators (`%2F`,
    /// `%2E`) are exactly the smuggling vector this exists to block.
    private static let allowedPathScalars: Set<Unicode.Scalar> = {
        var scalars = Set<Unicode.Scalar>()
        for value in UInt8(ascii: "a")...UInt8(ascii: "z") { scalars.insert(Unicode.Scalar(value)) }
        for value in UInt8(ascii: "A")...UInt8(ascii: "Z") { scalars.insert(Unicode.Scalar(value)) }
        for value in UInt8(ascii: "0")...UInt8(ascii: "9") { scalars.insert(Unicode.Scalar(value)) }
        for character in "-._~!$&'()*+,;=:@/" { scalars.formUnion(character.unicodeScalars) }
        return scalars
    }()

    /// Returns why `path` is not a valid route-claim path, or `nil` if it is valid.
    static func pathProblem(_ path: String) -> String? {
        if path.isEmpty { return "empty path" }
        if !path.hasPrefix("/") { return "path must be absolute (start with \"/\")" }
        if path == "/" { return "the origin root cannot be claimed" }
        if path.count > maxPathLength { return "path exceeds \(maxPathLength) characters" }
        if path.contains("%") { return "percent-encoding is not allowed in route claims" }
        if let bad = path.unicodeScalars.first(where: { !allowedPathScalars.contains($0) }) {
            return "disallowed character \(String(reflecting: Character(bad)))"
        }
        // Leading "/" dropped; keep empty subsequences so "//" and a trailing "/" both surface
        // as empty segments.
        let segments = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        if segments.contains(where: \.isEmpty) {
            return "empty path segment (no doubled or trailing slashes)"
        }
        if segments.contains(where: { $0 == "." || $0 == ".." }) {
            return "path traversal segment"
        }
        // RFC 8615: `/.well-known/` itself has no representation — the bare directory is never
        // claimable, exactly or (which would swallow the whole namespace) as a prefix.
        if path == "/.well-known" { return "the bare /.well-known directory cannot be claimed" }
        return nil
    }

    /// Validates a single claim's path, methods, and prefix declaration.
    static func validate(_ claim: WorkerRouteClaim, owner: String) throws {
        if let problem = pathProblem(claim.path) {
            throw ValidationError.invalidPath(owner: owner, path: claim.path, reason: problem)
        }
        if claim.methods.isEmpty {
            throw ValidationError.invalidMethods(owner: owner, path: claim.path, reason: "no methods declared")
        }
        if let unknown = claim.methods.first(where: { !allowedMethods.contains($0) }) {
            throw ValidationError.invalidMethods(
                owner: owner, path: claim.path,
                reason: "unknown or non-uppercase method \"\(unknown)\"")
        }
        if Set(claim.methods).count != claim.methods.count {
            throw ValidationError.invalidMethods(owner: owner, path: claim.path, reason: "duplicate method")
        }
        // The composed Worker serves HEAD by mirroring GET (never by handing handlers a raw
        // HEAD request), so a HEAD claim with no paired GET is undeliverable.
        if claim.methods.contains("HEAD") && !claim.methods.contains("GET") {
            throw ValidationError.invalidMethods(
                owner: owner, path: claim.path,
                reason: "HEAD requires a paired GET (HEAD is served by mirroring GET)")
        }
        if claim.match == .prefix && claim.specificationURL == nil {
            throw ValidationError.undeclaredPrefix(owner: owner, path: claim.path)
        }
    }

    /// The validated route claims of the effective active descriptor set — the only claims that
    /// may reach `run_worker_first` or #744's inventory. Deterministic: sorted by path, then
    /// owner. Throws the first validation or overlap error, naming every owner involved.
    ///
    /// Overlap semantics: an exact claim covers its path; a prefix claim covers its path *and*
    /// all descendants. Any two active claims whose coverage intersects are rejected — there is
    /// no delegation or precedence here (matching the #690 design's "no collision precedence"),
    /// regardless of whether both claims come from the same worker.
    public static func activeClaims(
        catalog: [WorkerDescriptor],
        activeIDs: Set<String>
    ) throws -> [OwnedClaim] {
        var owned: [OwnedClaim] = []
        for descriptor in catalog.sorted(by: { $0.id < $1.id }) where activeIDs.contains(descriptor.id) {
            for claim in descriptor.routes ?? [] {
                try validate(claim, owner: descriptor.id)
                owned.append(OwnedClaim(owner: descriptor.id, claim: claim))
            }
        }

        // Keyed by (path, match) rather than path alone: an exact claim and a prefix claim that
        // normalize to the same path are not a collision — a prefix claim covers only its
        // descendants (see the overlap loop below), never the path itself. Two claims of the
        // *same* match kind at the same path always collide, since exact-exact and prefix-prefix
        // both claim identical coverage. A single worker legitimately declares both kinds at the
        // same path (e.g. an exact POST plus a prefix GET for descendants), which the old
        // path-only key falsely flagged as a duplicate.
        struct DuplicateKey: Hashable, Comparable {
            let path: String
            let matchRawValue: String

            static func < (lhs: Self, rhs: Self) -> Bool {
                (lhs.path, lhs.matchRawValue) < (rhs.path, rhs.matchRawValue)
            }
        }
        var ownersByPathAndMatch: [DuplicateKey: [String]] = [:]
        for entry in owned {
            let key = DuplicateKey(path: entry.claim.path, matchRawValue: entry.claim.match.rawValue)
            ownersByPathAndMatch[key, default: []].append(entry.owner)
        }
        if let (key, owners) = ownersByPathAndMatch.sorted(by: { $0.key < $1.key })
            .first(where: { $0.value.count > 1 }) {
            throw ValidationError.duplicateClaim(path: key.path, owners: owners.sorted())
        }

        let sorted = owned.sorted {
            ($0.claim.path, $0.owner) < ($1.claim.path, $1.owner)
        }
        for (index, entry) in sorted.enumerated() {
            guard entry.claim.match == .prefix else { continue }
            let prefix = entry.claim.path + "/"
            for other in sorted[(index + 1)...] where other.claim.path.hasPrefix(prefix) {
                throw ValidationError.overlappingClaims(
                    path: other.claim.path, owner: other.owner,
                    otherPath: entry.claim.path, otherOwner: entry.owner)
            }
        }
        return sorted
    }

    /// The active claims under `/.well-known/` — the dynamic-route input #744's
    /// `WellKnownInventory` merges alongside user-static files, generators, and runtime
    /// reservations. Ownership attribution is preserved for collision reporting.
    public static func wellKnownClaims(_ claims: [OwnedClaim]) -> [OwnedClaim] {
        claims.filter { $0.claim.path.hasPrefix("/.well-known/") }
    }

    /// Deterministic `[assets].run_worker_first` patterns for a set of route claims: exact
    /// claims contribute their path, prefix claims their path plus a `path/*` glob (Cloudflare's
    /// glob does not match the bare prefix path itself). Sorted and deduplicated so regenerated
    /// Wrangler configuration diffs are stable.
    public static func runWorkerFirstPatterns(_ claims: [WorkerRouteClaim]) -> [String] {
        var patterns = Set<String>()
        for claim in claims {
            patterns.insert(claim.path)
            if claim.match == .prefix {
                patterns.insert(claim.path + "/*")
            }
        }
        return patterns.sorted()
    }
}
