import Foundation

// See docs/superpowers/specs/2026-07-14-well-known-support-design.md — #748 owns this ephemeral,
// non-secret contract so a runtime/provider can report affirmatively-owned `.well-known` paths
// (e.g. ACME managed-TLS) and so a build step can receive a derived claim manifest and report
// back what it observed on disk. #744 assembles the full inventory and consumes this contract;
// it must not duplicate it.

/// Whether a claim matches one exact path or every path under a prefix.
public enum WellKnownPathMatch: String, Sendable, Codable, Equatable {
    case exact
    case prefix
}

/// A portable, non-secret claim that a deploy provider or runtime affirmatively owns a
/// `.well-known` path — e.g. a hosting provider's managed-TLS ACME challenge handler. Never
/// carries credentials, tokens, or runtime bindings.
public struct RuntimeOwnedPathClaim: Sendable, Codable, Equatable, Identifiable {
    public enum Scheme: String, Sendable, Codable, Equatable {
        case http
        case https
    }

    /// Stable identifier for this claim, unique within one provider's report.
    public var id: String
    /// Stable identifier of the owning provider or runtime, e.g. `"cloudflare-managed-tls"`.
    public var owner: String
    /// The `.well-known` path segment (or prefix) this claim covers, no leading slash.
    public var path: String
    public var match: WellKnownPathMatch
    /// Schemes this claim applies under.
    public var schemes: Set<Scheme>
    /// Port this claim applies to, or `nil` for the scheme's default port.
    public var port: Int?
    /// Human-readable capability/provenance description, e.g. "RFC 8555 managed-TLS ownership".
    public var capability: String
    public var specificationURL: URL?

    public init(
        id: String,
        owner: String,
        path: String,
        match: WellKnownPathMatch,
        schemes: Set<Scheme> = [.https],
        port: Int? = nil,
        capability: String,
        specificationURL: URL? = nil
    ) {
        self.id = id
        self.owner = owner
        self.path = path
        self.match = match
        self.schemes = schemes
        self.port = port
        self.capability = capability
        self.specificationURL = specificationURL
    }
}

/// The ephemeral, non-secret manifest the app/deploy orchestrator derives (from #744's full
/// inventory) and hands to a runtime's build step. Only the fields a runtime needs to detect a
/// fresh on-disk collision cross this seam — never raw site settings or credentials.
public struct WellKnownClaimManifest: Sendable, Codable, Equatable {
    public struct Entry: Sendable, Codable, Equatable, Identifiable {
        public var id: String
        public var path: String
        public var match: WellKnownPathMatch
        public var owner: String
        /// The claim's delivery class, as the raw value of
        /// `WellKnownEndpointDescriptor.Delivery` (`AnglesiteCore` owns that enum; this contract
        /// stays a plain string so the seam's JSON has no dependency direction). The build step
        /// needs it to tell a fresh static file that merely *is* a user-static claim from one that
        /// **shadows** a `dynamic`/`externalRuntime` claim — the latter is a collision it must
        /// reject before generation. Decodes as `"userStatic"` when absent so an older producer's
        /// manifest still parses.
        public var delivery: String

        public init(id: String, path: String, match: WellKnownPathMatch, owner: String, delivery: String = "userStatic") {
            self.id = id
            self.path = path
            self.match = match
            self.owner = owner
            self.delivery = delivery
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            path = try container.decode(String.self, forKey: .path)
            match = try container.decode(WellKnownPathMatch.self, forKey: .match)
            owner = try container.decode(String.self, forKey: .owner)
            delivery = try container.decodeIfPresent(String.self, forKey: .delivery) ?? "userStatic"
        }
    }

    public var entries: [Entry]

    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    /// Guest-visible env var whose value is the guest filesystem path where this manifest's
    /// JSON was written. Substrate-neutral by name — any future runtime conformer should expose
    /// the manifest to its build step under this same variable, whatever its transport mechanism.
    public static let environmentVariableName = "ANGLESITE_WELLKNOWN_CLAIM_MANIFEST"

    /// Guest-visible env var whose value is the guest filesystem path a build step should write
    /// its `WellKnownBuildSeamResult` JSON to before exiting.
    public static let resultPathEnvironmentVariable = "ANGLESITE_WELLKNOWN_RESULT_PATH"
}

/// What a build step observed on disk after receiving a `WellKnownClaimManifest`.
public struct WellKnownBuildSeamResult: Sendable, Codable, Equatable {
    public struct Finding: Sendable, Codable, Equatable {
        public var path: String?
        public var message: String

        public init(path: String? = nil, message: String) {
            self.path = path
            self.message = message
        }
    }

    /// Relative `dist/.well-known/...` paths the build actually produced.
    public var observedArtifacts: [String]
    /// The subset of `observedArtifacts` the build recognized as its own generator's output (by
    /// the generator's content marker). Anglesite's generators run *inside* the runtime clone
    /// during prebuild, so the host-assembled inventory legitimately cannot know about a file that
    /// did not exist when it scanned — without this, every generated `security.txt`/`mta-sts.txt`
    /// would read as an unclaimed artifact on a first deploy.
    public var generatedArtifacts: [String]
    public var findings: [Finding]

    public init(observedArtifacts: [String] = [], generatedArtifacts: [String] = [], findings: [Finding] = []) {
        self.observedArtifacts = observedArtifacts
        self.generatedArtifacts = generatedArtifacts
        self.findings = findings
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        observedArtifacts = try container.decodeIfPresent([String].self, forKey: .observedArtifacts) ?? []
        generatedArtifacts = try container.decodeIfPresent([String].self, forKey: .generatedArtifacts) ?? []
        findings = try container.decodeIfPresent([Finding].self, forKey: .findings) ?? []
    }

    /// Parses the JSON blob a build step returns after the result marker. Never throws — an
    /// absent or malformed blob degrades to an empty result rather than failing the build step,
    /// per #748's "malformed results" contract requirement.
    public static func parsing(_ json: String) -> WellKnownBuildSeamResult {
        let trimmed = json.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let result = try? JSONDecoder().decode(WellKnownBuildSeamResult.self, from: data)
        else {
            return WellKnownBuildSeamResult()
        }
        return result
    }
}

/// The outcome of asking a `DeployExecutor` to run the build step with a claim manifest.
public enum WellKnownBuildSeamOutcome: Sendable, Equatable {
    /// This executor does not implement the seam — callers must not claim cross-owner collision
    /// protection when they receive this case.
    case unsupported
    /// The build was cancelled before it produced a result.
    case cancelled
    case completed(DeployStepResult, WellKnownBuildSeamResult)
}
