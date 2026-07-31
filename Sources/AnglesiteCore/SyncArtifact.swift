#if canImport(Darwin)
import Foundation

/// A single ref recorded in a sync artifact: `oid` is the ref's direct target (a 40-hex SHA-1),
/// `name` is its full name (`refs/heads/<n>`, `refs/tags/<n>`, or the literal `HEAD`) — the same
/// shape `git show-ref`/`git bundle list-heads` produce. For an annotated tag, `oid` is the tag
/// object's own id, not the peeled commit — matching stock git's own bundle/show-ref convention.
public struct SyncArtifactRef: Sendable, Equatable, Hashable, Codable {
    /// The ref's direct target as a 40-hex SHA-1 (an annotated tag's own object id, not the
    /// peeled commit — see the type doc).
    public let oid: String
    /// Full ref name (`refs/heads/<n>`, `refs/tags/<n>`, or the literal `HEAD`).
    public let name: String

    /// Creates a ref record. No validation — the codecs that produce these are the ones that
    /// enforce the `<40-hex> <name>` shape on parse.
    public init(oid: String, name: String) {
        self.oid = oid
        self.name = name
    }
}

/// Errors a `SyncArtifact` codec can raise. Cases distinguish "this isn't our problem to fix"
/// (malformed/corrupt input — the caller should treat the artifact as untrustworthy) from
/// ordinary I/O and libgit2 failures.
public enum SyncArtifactError: Error, Equatable, Sendable, LocalizedError {
    /// No file exists at the given artifact URL.
    case notFound(URL)
    /// The first line isn't a recognized bundle signature at all.
    case invalidSignature(String)
    /// The signature names a bundle format version this codec doesn't implement (only v2 is
    /// supported).
    case unsupportedFormat(String)
    /// The header never reached its terminating blank line before EOF.
    case truncatedHeader
    /// A header line (prerequisite or ref) doesn't match `<40-hex> <rest>`.
    case malformedRefLine(String)
    /// The header parsed, but there's no packfile data after it.
    case emptyPack
    /// The packfile is present but fails libgit2's own indexing/checksum validation (e.g. a torn
    /// pack cut off mid-object or before its trailer).
    case corruptPack(String)
    /// `write(from:to:)` was asked to capture a repository with no commits and no refs — there's
    /// nothing to bundle yet.
    case noRefsToWrite
    /// A libgit2 call failed for a reason unrelated to malformed input (e.g. the source directory
    /// isn't a repository at all).
    case libgit2(String)
    /// A filesystem operation (read/write/temp-file swap) failed.
    case io(String)

    /// Diagnostic phrasing per case — lower-case sentences that read naturally when a caller
    /// prefixes its own context ("couldn't sync: …"). These name bundle/packfile specifics for
    /// the debug pane; `SyncEngine` wraps them in owner-facing language before surfacing.
    public var errorDescription: String? {
        switch self {
        case .notFound(let url):
            return "no sync artifact found at \(url.path)."
        case .invalidSignature(let line):
            return "not a git bundle (expected \"# v2 git bundle\", found \"\(line)\")."
        case .unsupportedFormat(let line):
            return "unsupported bundle format: \"\(line)\" — only v2 bundles are supported."
        case .truncatedHeader:
            return "the artifact's header is truncated (missing the blank line that ends it)."
        case .malformedRefLine(let line):
            return "malformed bundle header line: \"\(line)\"."
        case .emptyPack:
            return "the artifact has no packfile data."
        case .corruptPack(let reason):
            return "the artifact's packfile is corrupt: \(reason)"
        case .noRefsToWrite:
            return "this repository has no commits yet — nothing to write."
        case .libgit2(let reason):
            return "git operation failed: \(reason)"
        case .io(let reason):
            return "couldn't read or write the sync artifact: \(reason)"
        }
    }
}

/// A codec that captures a git repository's history into (and restores it from) a single-file
/// artifact — the transport unit `SyncEngine` (#879) moves through iCloud (design doc
/// `2026-07-21-icloud-git-sync-design.md` §2). Swappable behind this seam: the primary
/// implementation is `BundleArtifact` (git bundle v2 on libgit2); the design names a
/// compressed-bare-repo-archive fallback if bundle v2 ever proves unworkable, without either
/// `SyncEngine` or this protocol needing to change.
///
/// Every method here does real, potentially slow file/git I/O — conforming types are expected to
/// be cheap value types with no shared mutable state (see `BundleArtifact`), and callers are
/// responsible for keeping libgit2 access serialized the same way the rest of this module's
/// git-touching code does (libgit2 is not safe for uncoordinated concurrent use here).
public protocol SyncArtifact: Sendable {
    /// Writes an artifact at `artifactURL` capturing every object reachable from
    /// `sourceDirectory`'s local branches, tags, and HEAD (the #283 ref policy: `--branches
    /// --tags HEAD`). Returns the refs written. Throws `SyncArtifactError.noRefsToWrite` if the
    /// repository has no commits yet.
    @discardableResult
    func write(from sourceDirectory: URL, to artifactURL: URL) throws -> [SyncArtifactRef]

    /// Reads the refs recorded in the artifact at `artifactURL`'s header, without touching any
    /// repository or importing any objects.
    func refs(of artifactURL: URL) throws -> [SyncArtifactRef]

    /// Imports the artifact's objects into `sourceDirectory`'s repository and lands its refs
    /// under a synthetic `refs/remotes/<namespace>/...` namespace (branches at
    /// `refs/remotes/<namespace>/<name>`, tags at `refs/remotes/<namespace>/tags/<name>`) — never
    /// the repository's real `refs/heads/*`/`refs/tags/*`, mirroring how `BundleSync` fetched
    /// into its own `icloud` remote namespace. The caller (`SyncEngine`) reconciles from there.
    /// Returns the namespaced refs actually created.
    @discardableResult
    func fetch(into sourceDirectory: URL, namespace: String, from artifactURL: URL) throws -> [SyncArtifactRef]

    /// Validates that the artifact at `artifactURL` is well-formed — header parses, packfile
    /// checksum and object graph are intact — without importing it into any repository. Throws on
    /// any defect; returns normally when valid.
    func verify(artifactURL: URL) throws
}
#endif
