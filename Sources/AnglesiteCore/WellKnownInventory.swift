import Foundation

// See docs/superpowers/specs/2026-07-14-well-known-support-design.md — #744 owns the portable
// `/.well-known/` endpoint descriptor, the filesystem inventory scan, and cross-owner collision
// enforcement. It consumes #746's `WorkerRouteClaims.wellKnownClaims(_:)` for the dynamic-route
// input and #748's `RuntimeOwnedPathClaim`/`WellKnownClaimManifest`/`WellKnownBuildSeamResult` for
// the runtime-reservation input and the build-seam round trip; it must not re-derive either.

/// A portable, attributed claim on one `/.well-known/` path — the merged view across all four
/// delivery-owner classes the design doc defines (design doc §"Endpoint inventory and
/// validation"). `suffix` is relative to `.well-known/` itself (no leading slash, no
/// `.well-known/` prefix) — e.g. `"security.txt"`, `"webfinger"`, `"acme-challenge/"` — matching
/// `WellKnownClaimManifest.Entry.path`'s convention.
public struct WellKnownEndpointDescriptor: Sendable, Codable, Equatable, Identifiable {
    /// The four delivery-owner classes the design doc defines — *how* an endpoint gets served
    /// decides which collision and verification rules apply to it.
    public enum Delivery: String, Sendable, Codable, Equatable {
        /// A committed file in `Source/public/.well-known/` with no recognized Anglesite marker.
        case userStatic
        /// A deterministic static file Anglesite generates from git-visible site source (e.g.
        /// `security.txt`), identified by its first-line marker.
        case generated
        /// An exact or specification-approved-prefix Worker route owned by an enabled feature.
        case dynamic
        /// A path demonstrably controlled by the active hosting/TLS runtime (`RuntimeOwnedPathClaim`).
        case externalRuntime
    }

    /// IANA Well-Known URI registry status, or `.custom` for anything else (including "not
    /// registered at all" and "registration unknown to this descriptor").
    public enum Registration: Sendable, Codable, Equatable {
        /// Permanently registered in the IANA Well-Known URIs registry.
        case permanent
        /// Provisionally registered with IANA.
        case provisional
        /// Registered but deprecated — inventoried, not endorsed.
        case deprecated
        /// Anything else, carrying the raw string so an unrecognized future status round-trips
        /// instead of failing to decode.
        case custom(String)

        /// Hand-written to decode unknown strings as `.custom` — a raw-value enum would throw on
        /// a status this build doesn't know, making the inventory brittle against registry churn.
        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            switch raw {
            case "permanent": self = .permanent
            case "provisional": self = .provisional
            case "deprecated": self = .deprecated
            default: self = .custom(raw)
            }
        }

        /// Encodes as the plain status string, so `.custom(raw)` round-trips byte-identically.
        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .permanent: try container.encode("permanent")
            case .provisional: try container.encode("provisional")
            case .deprecated: try container.encode("deprecated")
            case .custom(let raw): try container.encode(raw)
            }
        }
    }

    /// Stable identifier, unique within one assembled inventory.
    public var id: String
    /// Path relative to `.well-known/` — see the type doc for the exact convention.
    public var suffix: String
    /// Whether `suffix` is claimed exactly or as a prefix.
    public var match: WellKnownPathMatch
    /// Which delivery-owner class serves this endpoint.
    public var delivery: Delivery
    /// Stable feature, generator, or runtime id — e.g. `"generator:security-txt"`,
    /// `"webfinger"` (a `WorkerDescriptor.id`), or a `RuntimeOwnedPathClaim.owner`.
    public var owner: String
    /// IANA registry status for this well-known URI.
    public var registration: Registration
    /// Link to the governing specification, when known.
    public var specificationURL: URL?
    /// `nil` means inventory-only: Anglesite makes no conformance claim for this endpoint.
    public var validatorID: String?
    /// Whether this endpoint binds domain authority (e.g. an ACME challenge proves control of the
    /// host) — flagged so authority-carrying paths can be treated more strictly than plain
    /// metadata documents.
    public var authorityBinding: Bool

    /// Memberwise creation; the optional/`false` defaults describe a plain inventory row with no
    /// spec link, no conformance claim, and no authority binding.
    public init(
        id: String,
        suffix: String,
        match: WellKnownPathMatch,
        delivery: Delivery,
        owner: String,
        registration: Registration,
        specificationURL: URL? = nil,
        validatorID: String? = nil,
        authorityBinding: Bool = false
    ) {
        self.id = id
        self.suffix = suffix
        self.match = match
        self.delivery = delivery
        self.owner = owner
        self.registration = registration
        self.specificationURL = specificationURL
        self.validatorID = validatorID
        self.authorityBinding = authorityBinding
    }
}

/// Assembles and validates the effective `/.well-known/` inventory: a filesystem scan of
/// `Source/public/.well-known/`, Anglesite's own generators, active dynamic Worker routes, and
/// runtime-reported reservations. Pure — no actor isolation — mirroring `WorkerRouteClaims`'s
/// shape: the app/deploy orchestrator gathers each input first (design doc: "Worker activation
/// lives in package `Config/`, and provider capabilities are host-side; neither is present inside
/// the site's runtime clone").
public enum WellKnownInventory {

    /// One party attributed to a collision, for naming both remediation sources in an error.
    public struct Claimant: Sendable, Equatable, Hashable {
        /// The claiming feature/generator/runtime id.
        public let owner: String
        /// How the claimant delivers its endpoint — included so a collision message can tell
        /// static-vs-dynamic apart without a second lookup.
        public let delivery: WellKnownEndpointDescriptor.Delivery

        /// Memberwise creation.
        public init(owner: String, delivery: WellKnownEndpointDescriptor.Delivery) {
            self.owner = owner
            self.delivery = delivery
        }
    }

    /// A non-fatal scan or build-verification finding — a rejected file, a missing expected
    /// artifact, or an unexpected artifact. Never blocks assembly by itself; callers decide how to
    /// surface these (e.g. as `PreDeployCheck.ScanWarning`/`ScanFailure`).
    public struct Finding: Sendable, Equatable {
        /// The `.well-known`-relative path the finding is about, or `nil` for a scan-wide note.
        public var path: String?
        /// Human-readable description, surfaced verbatim to the caller's warning channel.
        public var message: String

        /// Memberwise creation; `path` defaults to `nil` for findings not tied to one file.
        public init(path: String? = nil, message: String) {
            self.path = path
            self.message = message
        }
    }

    /// A cross-owner collision the design doc requires to stop build/deploy and name both owners.
    /// There is no collision precedence ("static wins" or "dynamic wins") — every case names the
    /// exact path and every claimant involved.
    public enum CollisionError: Error, Equatable, CustomStringConvertible {
        /// Two or more claims for the same exact path — covers exact/exact, static/generated,
        /// static/dynamic, and active-runtime collisions alike; the claimants' `delivery` values
        /// tell the caller which case it is.
        case duplicateClaim(path: String, claimants: [Claimant])
        /// An exact or prefix claim falls inside another owner's prefix claim — covers
        /// exact/prefix and prefix/prefix collisions.
        case overlappingClaims(path: String, claimant: Claimant, otherPath: String, other: Claimant)

        /// The design-doc-mandated error text: every message names the exact path and every
        /// claimant (owner + delivery class), so the owner knows both sides of the conflict.
        public var description: String {
            switch self {
            case .duplicateClaim(let path, let claimants):
                let owners = claimants.map { "\($0.owner) (\($0.delivery.rawValue))" }.joined(separator: ", ")
                return "/.well-known/\(path) is claimed more than once: \(owners)"
            case .overlappingClaims(let path, let claimant, let otherPath, let other):
                return "/.well-known/\(path) (\(claimant.owner), \(claimant.delivery.rawValue)) overlaps " +
                    "/.well-known/\(otherPath) (\(other.owner), \(other.delivery.rawValue))"
            }
        }
    }

    // MARK: Filesystem scan

    /// Default cap on a single `.well-known` file — generous for text-based protocol documents
    /// (JRDs, policy files) while still bounding what an unreviewed static file can commit.
    public static let defaultMaxFileSizeBytes = 64 * 1024

    /// Scans `wellKnownDirectory` (normally `<siteDirectory>/public/.well-known`) and returns one
    /// row per file, classified `.generated` when its first line matches a known Anglesite marker
    /// (`GeneratedEndpoints`) or `.userStatic` otherwise. A missing directory returns no rows and
    /// no findings — a site need not have any `.well-known` content yet.
    ///
    /// Rejects (as a `Finding`, excluding the entry from `rows`) any symlink, any path whose
    /// standardized location resolves outside `wellKnownDirectory`, and any file over
    /// `maxFileSizeBytes`. A filename containing `%` is also rejected — real filesystems cannot
    /// contain `..` or an empty segment, but a percent-encoded-looking name could still smuggle a
    /// path-traversal segment past a later URL-facing consumer that decodes it.
    public static func scanUserStatic(
        wellKnownDirectory: URL,
        maxFileSizeBytes: Int = defaultMaxFileSizeBytes,
        ownerID: String = "user-static"
    ) -> (rows: [WellKnownEndpointDescriptor], findings: [Finding]) {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: wellKnownDirectory.path, isDirectory: &isDir), isDir.boolValue else {
            return ([], [])
        }
        let standardizedRoot = wellKnownDirectory.resolvingSymlinksInPath().standardizedFileURL.path

        var rows: [WellKnownEndpointDescriptor] = []
        var findings: [Finding] = []

        func walk(_ dir: URL, prefix: [String]) {
            guard let entries = try? fm.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey], options: []
            ) else { return }
            for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let name = entry.lastPathComponent
                let relPath = (prefix + [name]).joined(separator: "/")
                let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey])

                if values?.isSymbolicLink == true {
                    findings.append(Finding(path: relPath, message: "symlink not allowed under .well-known/ — excluded from inventory"))
                    continue
                }
                if name.contains("%") {
                    findings.append(Finding(path: relPath, message: "percent-encoded-looking filename not allowed under .well-known/ — excluded from inventory"))
                    continue
                }
                if values?.isDirectory == true {
                    walk(entry, prefix: prefix + [name])
                    continue
                }
                let standardizedEntry = entry.resolvingSymlinksInPath().standardizedFileURL.path
                guard standardizedEntry == standardizedRoot || standardizedEntry.hasPrefix(standardizedRoot + "/") else {
                    findings.append(Finding(path: relPath, message: "resolved path escapes .well-known/ root — excluded from inventory"))
                    continue
                }
                if let size = values?.fileSize, size > maxFileSizeBytes {
                    findings.append(Finding(path: relPath, message: "file exceeds \(maxFileSizeBytes) bytes — excluded from inventory"))
                    continue
                }
                let content = try? String(contentsOf: entry, encoding: .utf8)
                if let generator = GeneratedEndpoints.matching(content: content, suffix: relPath) {
                    rows.append(generator.descriptor(suffix: relPath))
                } else {
                    rows.append(WellKnownEndpointDescriptor(
                        id: "\(ownerID):\(relPath)",
                        suffix: relPath,
                        match: .exact,
                        delivery: .userStatic,
                        owner: ownerID,
                        registration: .custom("unregistered")
                    ))
                }
            }
        }
        walk(wellKnownDirectory, prefix: [])
        return (rows, findings)
    }

    // MARK: Dynamic and runtime conversion

    /// Converts already-filtered well-known dynamic route claims (the caller passes
    /// `WorkerRouteClaims.wellKnownClaims(WorkerRouteClaims.activeClaims(...))`) into inventory
    /// rows. A claim whose path isn't actually under `/.well-known/` is dropped defensively —
    /// `wellKnownClaims` already filters this, but this function must not fabricate a nonsensical
    /// suffix if a caller passes an unfiltered claim by mistake.
    public static func dynamicRows(from claims: [WorkerRouteClaims.OwnedClaim]) -> [WellKnownEndpointDescriptor] {
        let prefix = "/.well-known/"
        return claims.compactMap { owned -> WellKnownEndpointDescriptor? in
            guard owned.claim.path.hasPrefix(prefix) else { return nil }
            let suffix = String(owned.claim.path.dropFirst(prefix.count))
            return WellKnownEndpointDescriptor(
                id: "\(owned.owner):\(suffix)",
                suffix: suffix,
                match: owned.claim.match == .prefix ? .prefix : .exact,
                delivery: .dynamic,
                owner: owned.owner,
                registration: .custom("worker-declared"),
                specificationURL: owned.claim.specificationURL,
                validatorID: owned.claim.validatorID,
                authorityBinding: owned.claim.authorityBinding
            )
        }
    }

    /// Converts runtime/provider-reported ownership claims (#748) into inventory rows. Pass an
    /// empty array both when no runtime has been asked and when a runtime affirmatively reports no
    /// claims — either way, no reservation should suppress a static or dynamic claim at that path.
    public static func runtimeRows(from claims: [RuntimeOwnedPathClaim]) -> [WellKnownEndpointDescriptor] {
        claims.map { claim in
            WellKnownEndpointDescriptor(
                id: claim.id,
                suffix: claim.path,
                match: claim.match,
                delivery: .externalRuntime,
                owner: claim.owner,
                registration: .custom("runtime-reported"),
                specificationURL: claim.specificationURL
            )
        }
    }

    // MARK: Merge and collision enforcement

    /// Merges every delivery class into one effective, collision-checked inventory, sorted by
    /// suffix then owner for deterministic output. Throws the first collision found, naming every
    /// claimant involved — there is no "static wins" or "dynamic wins" recovery (design doc
    /// §"Collision rules"). Call this both before generation (to reject a declared collision early)
    /// and again after build against the observed artifacts via `verifyBuildArtifacts`.
    public static func merge(
        userStatic: [WellKnownEndpointDescriptor] = [],
        generated: [WellKnownEndpointDescriptor] = [],
        dynamic: [WellKnownEndpointDescriptor] = [],
        runtime: [WellKnownEndpointDescriptor] = []
    ) throws -> [WellKnownEndpointDescriptor] {
        let all = userStatic + generated + dynamic + runtime

        var claimantsBySuffix: [String: [Claimant]] = [:]
        for row in all {
            claimantsBySuffix[row.suffix, default: []].append(Claimant(owner: row.owner, delivery: row.delivery))
        }
        if let (suffix, claimants) = claimantsBySuffix.sorted(by: { $0.key < $1.key }).first(where: { $0.value.count > 1 }) {
            throw CollisionError.duplicateClaim(
                path: suffix,
                claimants: claimants.sorted { ($0.owner, $0.delivery.rawValue) < ($1.owner, $1.delivery.rawValue) })
        }

        // The design doc's overlap rules are scoped to "another owner['s]" prefix / "different
        // owners" — a descriptor nested inside its OWN prefix claim is self-delegation, not a
        // collision (e.g. a runtime reporting both "I own acme-challenge/ generally" and "I've
        // placed a token at acme-challenge/http-01 right now"). This deliberately differs from
        // `WorkerRouteClaims.activeClaims`'s stricter same-worker rejection: that type validates
        // one flat HTTP dispatch table, where two overlapping declared routes from one worker are
        // a manifest bug: there's nothing to reconcile once dispatch is fixed. Here, ownership
        // claims and materialized artifacts are different concerns even from the same owner, so
        // only a genuine cross-owner overlap blocks.
        let sorted = all.sorted { ($0.suffix, $0.owner) < ($1.suffix, $1.owner) }
        for (index, row) in sorted.enumerated() where row.match == .prefix {
            let prefixPath = row.suffix.hasSuffix("/") ? row.suffix : row.suffix + "/"
            for other in sorted[(index + 1)...] where other.suffix.hasPrefix(prefixPath) && other.owner != row.owner {
                throw CollisionError.overlappingClaims(
                    path: other.suffix, claimant: Claimant(owner: other.owner, delivery: other.delivery),
                    otherPath: row.suffix, other: Claimant(owner: row.owner, delivery: row.delivery))
            }
        }
        return sorted
    }

    // MARK: #748 build-seam derivation and verification

    /// Derives the ephemeral, non-secret `WellKnownClaimManifest` (#748) a runtime's build step
    /// receives so it can detect a fresh on-disk collision against the effective claim set.
    public static func claimManifest(from rows: [WellKnownEndpointDescriptor]) -> WellKnownClaimManifest {
        WellKnownClaimManifest(entries: rows.map {
            WellKnownClaimManifest.Entry(
                id: $0.id, path: $0.suffix, match: $0.match, owner: $0.owner, delivery: $0.delivery.rawValue)
        })
    }

    /// Verifies static/generated rows actually reached their exact `dist/.well-known/...` path
    /// (design doc: "Static/generated claims are verified at their exact `dist/.well-known/...`
    /// paths"), and folds in whatever findings the build step itself reported. Only meaningful
    /// once a `WellKnownBuildSeamResult` actually exists — callers can only obtain one from a
    /// `WellKnownBuildSeamOutcome.completed` case, so calling this after `.unsupported` or
    /// `.cancelled` is structurally avoided rather than silently claiming protection that never ran.
    public static func verifyBuildArtifacts(
        expected: [WellKnownEndpointDescriptor],
        result: WellKnownBuildSeamResult
    ) -> [Finding] {
        var findings = result.findings.map { Finding(path: $0.path, message: $0.message) }
        let observed = Set(result.observedArtifacts)
        let staticallyDelivered = expected.filter { $0.delivery == .userStatic || $0.delivery == .generated }
        for row in staticallyDelivered where !observed.contains(row.suffix) {
            findings.append(Finding(
                path: row.suffix,
                message: "expected .well-known/\(row.suffix) (owner: \(row.owner)) was not found in the built output"))
        }
        // A build-generated artifact counts as claimed even though the host-side inventory couldn't
        // have seen it: Anglesite's generators run inside the runtime clone at prebuild, so a
        // first-deploy `security.txt` exists only after the host finished scanning. The build step
        // identifies these by the generator's own content marker, exactly as `GeneratedEndpoints`
        // does host-side — so this stays "recognized generator output," never "anything new."
        let expectedSuffixes = Set(staticallyDelivered.map(\.suffix)).union(result.generatedArtifacts)
        for artifact in result.observedArtifacts where !expectedSuffixes.contains(artifact) {
            findings.append(Finding(
                path: artifact,
                message: "unexpected .well-known/\(artifact) appeared in the built output with no matching inventory claim"))
        }
        return findings
    }
}

/// Anglesite's own generated `.well-known` endpoints, identified by the first-line marker their
/// generator writes (`Resources/Template/scripts/edge-artifacts.ts`). Content-marker
/// classification means the Swift-side scan never has to re-derive the TypeScript generator's
/// activation logic (`SECURITY_TXT_MODE`, `MTA_STS_MODE`, …) — it just recognizes what that
/// generator already wrote, the same way `isSecurityTxtMarkerOwned`/`isMTAStsMarkerOwned` do on
/// the TypeScript side.
public enum GeneratedEndpoints {
    /// Mirrors `SECURITY_TXT_MARKER` in `Resources/Template/scripts/edge-artifacts.ts` —
    /// duplicated as a content literal (not logic) so this scan needs no JS bridge;
    /// `WellKnownInventoryFixtureTests` guards against the two drifting apart.
    public static let securityTxtMarker =
        "# Generated by Anglesite — do not edit; edit SECURITY_CONTACT/.site-config instead (SECURITY_TXT_MODE=generated)"

    /// Mirrors `MTA_STS_MARKER` in `Resources/Template/scripts/edge-artifacts.ts`.
    public static let mtaStsMarker = "x-anglesite: generated"

    /// Mirrors `ATPROTO_DID_PATTERN` in `Resources/Template/scripts/edge-artifacts.ts`
    /// (`isValidAtprotoDid`) — a syntactically valid DID per the
    /// [W3C DID Core syntax](https://www.w3.org/TR/did-core/#did-syntax).
    /// `WellKnownInventoryFixtureTests` guards against the two drifting apart.
    private static let atprotoDidPattern = try! NSRegularExpression(pattern: "^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$")

    /// True when `content` (after trimming) is itself a syntactically valid DID. `atproto-did`
    /// (#1235) has no room for a literal ownership marker the way `security.txt`/`mta-sts.txt`
    /// do: the atproto HTTPS handle-verification method
    /// (https://atproto.com/specs/handle#https-method) requires the response body to be *exactly*
    /// the account DID. Ownership is therefore inferred from shape instead — the endpoint's only
    /// legitimate content is a DID, so any existing DID-shaped file is treated as Anglesite's own
    /// prior output, letting a reconnected Bluesky account overwrite it on redeploy without a
    /// manual delete.
    static func isValidAtprotoDid(_ content: String) -> Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        return atprotoDidPattern.firstMatch(in: trimmed, range: range) != nil
    }

    /// One Anglesite generator's identity, for building the row a matched file becomes.
    struct Descriptor {
        let owner: String
        let validatorID: String
        let registration: WellKnownEndpointDescriptor.Registration
        let specificationURL: URL
        let authorityBinding: Bool

        init(
            owner: String, validatorID: String,
            registration: WellKnownEndpointDescriptor.Registration = .permanent, specificationURL: URL,
            authorityBinding: Bool = false
        ) {
            self.owner = owner
            self.validatorID = validatorID
            self.registration = registration
            self.specificationURL = specificationURL
            self.authorityBinding = authorityBinding
        }

        func descriptor(suffix: String) -> WellKnownEndpointDescriptor {
            WellKnownEndpointDescriptor(
                id: owner, suffix: suffix, match: .exact, delivery: .generated, owner: owner,
                registration: registration, specificationURL: specificationURL, validatorID: validatorID,
                authorityBinding: authorityBinding)
        }
    }

    private static let securityTxt = Descriptor(
        owner: "generator:security-txt", validatorID: "rfc9116",
        specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc9116")!)
    private static let mtaSts = Descriptor(
        owner: "generator:mta-sts", validatorID: "rfc8461",
        specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc8461")!)
    /// Not an IANA-registered well-known URI — `atproto-did` is a vendor-defined (AT Protocol)
    /// convention, unlike `security.txt`/`mta-sts.txt`'s RFC registrations. `authorityBinding` is
    /// `true`: serving this file is exactly what proves control of the domain to atproto (#1235).
    private static let atprotoDid = Descriptor(
        owner: "generator:atproto-did", validatorID: "atproto-did", registration: .custom("vendor-defined"),
        specificationURL: URL(string: "https://atproto.com/specs/handle#https-method")!,
        authorityBinding: true)

    /// The generator whose marker appears on `content`'s first line (`security.txt`), anywhere in
    /// `content` (`mta-sts.txt`, matching `isMTAStsMarkerOwned`'s own scan), or whose entire
    /// (trimmed) content is a valid DID at the `atproto-did` suffix, or `nil` when `content` is
    /// `nil` or matches no known generator. `suffix` scopes the DID-shape check to its own path —
    /// a DID-shaped file elsewhere under `.well-known/` is not this generator's concern.
    static func matching(content: String?, suffix: String) -> Descriptor? {
        guard let content else { return nil }
        if content.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first == securityTxtMarker[...] {
            return securityTxt
        }
        if content.split(separator: "\n").contains(where: { $0 == mtaStsMarker[...] }) {
            return mtaSts
        }
        if suffix == "atproto-did", isValidAtprotoDid(content) {
            return atprotoDid
        }
        return nil
    }
}
