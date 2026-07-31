import Foundation

// See docs/superpowers/specs/2026-07-14-well-known-support-design.md — #748 owns this ephemeral,
// non-secret contract so a runtime/provider can report affirmatively-owned `.well-known` paths
// (e.g. ACME managed-TLS) and so a build step can receive a derived claim manifest and report
// back what it observed on disk. #744 assembles the full inventory and consumes this contract;
// it must not duplicate it.

/// Whether a claim matches one exact path or every path under a prefix.
public enum WellKnownPathMatch: String, Sendable, Codable, Equatable {
    /// The claim covers only the path itself.
    case exact
    /// The claim covers the path and everything nested under it (e.g. an ACME challenge
    /// directory whose token filenames can't be known in advance).
    case prefix
}

/// A portable, non-secret claim that a deploy provider or runtime affirmatively owns a
/// `.well-known` path — e.g. a hosting provider's managed-TLS ACME challenge handler. Never
/// carries credentials, tokens, or runtime bindings.
public struct RuntimeOwnedPathClaim: Sendable, Codable, Equatable, Identifiable {
    /// URL scheme a claim applies under — modeled explicitly because ACME's HTTP-01 challenge is
    /// specified over plain `http`, so "https-only" cannot be assumed for every claim.
    public enum Scheme: String, Sendable, Codable, Equatable {
        /// Plain HTTP (port 80 by default).
        case http
        /// HTTPS (port 443 by default) — the default for new claims.
        case https
    }

    /// Stable identifier for this claim, unique within one provider's report.
    public var id: String
    /// Stable identifier of the owning provider or runtime, e.g. `"cloudflare-managed-tls"`.
    public var owner: String
    /// The `.well-known` path segment (or prefix) this claim covers, no leading slash.
    public var path: String
    /// Whether `path` is claimed exactly or as a prefix.
    public var match: WellKnownPathMatch
    /// Schemes this claim applies under.
    public var schemes: Set<Scheme>
    /// Port this claim applies to, or `nil` for the scheme's default port.
    public var port: Int?
    /// Human-readable capability/provenance description, e.g. "RFC 8555 managed-TLS ownership".
    public var capability: String
    /// Link to the specification that grants this ownership (e.g. RFC 8555), when there is one.
    public var specificationURL: URL?

    /// Memberwise creation; `schemes` defaults to https-only and `port` to the scheme default,
    /// matching the common managed-TLS case.
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
    /// One claim as the build step sees it — a deliberately narrowed projection of the inventory
    /// row (`WellKnownEndpointDescriptor`), because only these fields are needed to detect and
    /// report an on-disk collision.
    public struct Entry: Sendable, Codable, Equatable, Identifiable {
        /// Stable identifier carried over from the inventory row, so a build-step finding can be
        /// traced back to the exact claim.
        public var id: String
        /// The `.well-known`-relative path (or prefix), no leading slash.
        public var path: String
        /// Whether `path` is claimed exactly or as a prefix.
        public var match: WellKnownPathMatch
        /// The claiming feature/generator/runtime id, for naming the other party in a collision.
        public var owner: String
        /// The claim's delivery class, as the raw value of
        /// `WellKnownEndpointDescriptor.Delivery` (`AnglesiteCore` owns that enum; this contract
        /// stays a plain string so the seam's JSON has no dependency direction). The build step
        /// needs it to tell a fresh static file that merely *is* a user-static claim from one that
        /// **shadows** a `dynamic`/`externalRuntime` claim — the latter is a collision it must
        /// reject before generation. Decodes as `"userStatic"` when absent so an older producer's
        /// manifest still parses.
        public var delivery: String

        /// Memberwise creation; `delivery` defaults to `"userStatic"` to match the decoder's
        /// backward-compatible fallback.
        public init(id: String, path: String, match: WellKnownPathMatch, owner: String, delivery: String = "userStatic") {
            self.id = id
            self.path = path
            self.match = match
            self.owner = owner
            self.delivery = delivery
        }

        /// Hand-written only to make `delivery` optional on the wire — an older producer's
        /// manifest (pre-`delivery`) must keep parsing as `"userStatic"`.
        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            path = try container.decode(String.self, forKey: .path)
            match = try container.decode(WellKnownPathMatch.self, forKey: .match)
            owner = try container.decode(String.self, forKey: .owner)
            delivery = try container.decodeIfPresent(String.self, forKey: .delivery) ?? "userStatic"
        }
    }

    /// The full claim set the build step must check new artifacts against.
    public var entries: [Entry]

    /// Creates a manifest; the empty default is a valid "no claims yet" manifest, not an error
    /// state.
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
    /// One build-step observation worth reporting — a collision, a rejected file, or anything
    /// else the step wants surfaced host-side.
    public struct Finding: Sendable, Codable, Equatable {
        /// The `.well-known`-relative path the finding is about, or `nil` for a step-wide note.
        public var path: String?
        /// Human-readable description, surfaced verbatim in host-side diagnostics.
        public var message: String

        /// Memberwise creation; `path` defaults to `nil` for findings not tied to one file.
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
    /// Whatever the build step chose to report beyond the artifact lists.
    public var findings: [Finding]

    /// Memberwise creation; all-empty defaults are the same shape a malformed result degrades to
    /// (see ``parsing(_:)``).
    public init(observedArtifacts: [String] = [], generatedArtifacts: [String] = [], findings: [Finding] = []) {
        self.observedArtifacts = observedArtifacts
        self.generatedArtifacts = generatedArtifacts
        self.findings = findings
    }

    /// Hand-written so every field is optional on the wire — a build step that predates a field
    /// (or omits an empty list) still produces a valid result.
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
    /// The build ran; carries the step result plus whatever the build step reported — the only
    /// case from which a ``WellKnownBuildSeamResult`` can be obtained, which is what forces
    /// callers to handle `.unsupported`/`.cancelled` honestly.
    case completed(DeployStepResult, WellKnownBuildSeamResult)
}
