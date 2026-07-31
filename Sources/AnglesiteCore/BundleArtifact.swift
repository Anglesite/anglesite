#if canImport(Darwin)
import Foundation
import Clibgit2
import SwiftGit2

/// Git bundle v2 codec for `SyncArtifact` (#878): a text header of refs (branches + tags + HEAD,
/// the #283 ref policy — `--branches --tags HEAD`) followed by a packfile.
///
/// **Why libgit2's raw C API, not a reimplemented packfile writer.** libgit2 has no *bundle*
/// support (`git_clone`/fetch against a `.bundle` file fails outright — #655/#988) but it does
/// expose the two primitives a bundle's packfile needs: `git_packbuilder` (write) and
/// `git_indexer` (read). Neither is wrapped by the `SwiftGit2` Swift API this module otherwise
/// uses, so this file imports `Clibgit2` directly — its module turns out to be importable from
/// AnglesiteCore despite the fork's `Package.swift` only declaring the `SwiftGit2` product
/// (verified empirically before writing this; SwiftPM makes a C target's module available to
/// anything that transitively builds against it), so no fork change was needed. This is
/// preferable to hand-rolling packfile delta compression and object serialization in Swift: the
/// resulting file is byte-for-byte a real packfile, so `git bundle verify`, `git clone
/// <bundle>`, and `git bundle create` interoperate directly (the acceptance bar for #878).
///
/// **Header/pack split.** The header is plain text (`renderHeader`/`parseHeader`); everything
/// after its terminating blank line is passed straight through to/from libgit2 as opaque bytes —
/// this codec never re-derives object hashes or re-encodes object content itself, so there's no
/// risk of it silently diverging from git's own canonical object encoding.
///
/// **Concurrency.** Like `InProcessGit`, libgit2 calls here are synchronous and assume the caller
/// serializes access — this codebase's libgit2 use isn't safe under uncoordinated concurrency
/// (see `InProcessGit`'s doc comment and this module's `.serialized` test suites). Each call opens
/// its own `Repository`/`git_indexer`/`git_packbuilder` handles and shares no state across calls.
public struct BundleArtifact: SyncArtifact {
    /// Creates a codec instance. Stateless by design — every operation opens and frees its own
    /// libgit2 handles (see the type's concurrency note) — so instances are interchangeable and
    /// free to construct at the call site.
    public init() {}

    private static let signatureLine = "# v2 git bundle"

    // MARK: - SyncArtifact

    /// Writes the bundle: packs everything reachable from branches + tags + HEAD (the #283 ref
    /// policy) via `git_packbuilder`, then lands header + pack with an atomic temp-file swap so a
    /// concurrent reader (e.g. an iCloud upload racing this write) never observes a torn artifact.
    @discardableResult
    public func write(from sourceDirectory: URL, to artifactURL: URL) throws -> [SyncArtifactRef] {
        SwiftGit2Bootstrap.ensureInitialized
        let repo = try Self.open(sourceDirectory)
        let (refs, packData) = try Self.buildPack(repo: repo)
        try Self.atomicWrite(header: Self.renderHeader(refs: refs), pack: packData, to: artifactURL)
        return refs
    }

    /// Header-only read: parses the ref lines up to the terminating blank line without ever
    /// initializing libgit2 or touching the packfile — so it stays cheap, and works even on an
    /// artifact whose pack wouldn't `verify`.
    public func refs(of artifactURL: URL) throws -> [SyncArtifactRef] {
        try Self.parseHeader(Self.readData(artifactURL)).refs
    }

    /// Verifies by *actually indexing* the pack (into a throwaway scratch repository) rather than
    /// re-implementing checksum math — `git_indexer` with `verify` on runs the same
    /// checksum/delta-resolution path a real import does, so anything this accepts will also
    /// `fetch`. A pack that indexes zero objects is rejected as `SyncArtifactError.emptyPack`.
    public func verify(artifactURL: URL) throws {
        SwiftGit2Bootstrap.ensureInitialized
        let data = try Self.readData(artifactURL)
        let header = try Self.parseHeader(data)
        try Self.checkPackSignature(data, from: header.packOffset)
        // Index into a scratch, throwaway repo so this exercises the real libgit2
        // checksum/delta-resolution path without touching any real repository.
        let scratch = try Self.makeScratchRepository()
        defer { try? FileManager.default.removeItem(at: scratch.root) }
        let stats = try Self.importPack(data: data, from: header.packOffset, into: scratch.repo)
        guard stats.indexedObjects > 0 else { throw SyncArtifactError.emptyPack }
    }

    /// Imports the pack into the site repository's object database, then lands the header's refs
    /// under the protocol's synthetic `refs/remotes/<namespace>/...` namespace. Objects land
    /// before refs on purpose: a pack that indexes zero objects is refused up front, so refs can
    /// never be created pointing at history that didn't arrive.
    @discardableResult
    public func fetch(into sourceDirectory: URL, namespace: String, from artifactURL: URL) throws -> [SyncArtifactRef] {
        SwiftGit2Bootstrap.ensureInitialized
        let data = try Self.readData(artifactURL)
        let header = try Self.parseHeader(data)
        try Self.checkPackSignature(data, from: header.packOffset)
        let repo = try Self.open(sourceDirectory)
        let stats = try Self.importPack(data: data, from: header.packOffset, into: repo)
        guard stats.indexedObjects > 0 else { throw SyncArtifactError.emptyPack }
        return try Self.landRefs(header.refs, namespace: namespace, into: repo)
    }

    // MARK: - Opening the repository

    private static func open(_ sourceDirectory: URL) throws -> Repository {
        switch Repository.at(sourceDirectory) {
        case .success(let repo): return repo
        case .failure(let error): throw SyncArtifactError.libgit2(error.localizedDescription)
        }
    }

    // MARK: - Header format

    private struct ParsedHeader {
        let refs: [SyncArtifactRef]
        let prerequisites: [String]
        /// Byte offset in the artifact's `Data` where the packfile begins.
        let packOffset: Int
    }

    /// Reads one `\n`-terminated line starting at `offset`. Returns `nil` if no `\n` is found
    /// before EOF (an unterminated/truncated line).
    private static func readLine(_ data: Data, from offset: Int) -> (line: String, next: Int)? {
        guard offset <= data.count else { return nil }
        guard let newline = data[offset...].firstIndex(of: 0x0A) else { return nil }
        let line = String(decoding: data[offset..<newline], as: UTF8.self)
        return (line, newline + 1)
    }

    private static func parseHeader(_ data: Data) throws -> ParsedHeader {
        guard let (first, afterFirst) = readLine(data, from: 0) else {
            throw SyncArtifactError.truncatedHeader
        }
        guard first == signatureLine else {
            if first.hasPrefix("# v") && first.hasSuffix(" git bundle") {
                throw SyncArtifactError.unsupportedFormat(first)
            }
            throw SyncArtifactError.invalidSignature(first)
        }

        var offset = afterFirst
        var refs: [SyncArtifactRef] = []
        var prerequisites: [String] = []
        while true {
            guard let (line, next) = readLine(data, from: offset) else {
                throw SyncArtifactError.truncatedHeader
            }
            offset = next
            if line.isEmpty { break } // the blank line that ends the header
            if line.hasPrefix("-") {
                let oid = String(line.dropFirst().prefix(40))
                guard oid.count == 40, oid.allSatisfy(\.isHexDigit) else {
                    throw SyncArtifactError.malformedRefLine(line)
                }
                prerequisites.append(oid)
            } else {
                let parts = line.split(separator: " ", maxSplits: 1)
                guard parts.count == 2, parts[0].count == 40, parts[0].allSatisfy(\.isHexDigit), !parts[1].isEmpty else {
                    throw SyncArtifactError.malformedRefLine(line)
                }
                refs.append(SyncArtifactRef(oid: String(parts[0]), name: String(parts[1])))
            }
        }
        return ParsedHeader(refs: refs, prerequisites: prerequisites, packOffset: offset)
    }

    private static func renderHeader(refs: [SyncArtifactRef]) -> Data {
        var text = signatureLine + "\n"
        for ref in refs {
            text += "\(ref.oid) \(ref.name)\n"
        }
        text += "\n"
        return Data(text.utf8)
    }

    private static func checkPackSignature(_ data: Data, from offset: Int) throws {
        guard offset < data.count else { throw SyncArtifactError.emptyPack }
        let packBytes = data[offset...]
        guard packBytes.count >= 12 else { throw SyncArtifactError.corruptPack("packfile is too short to be valid") }
        guard packBytes.prefix(4).elementsEqual("PACK".utf8) else {
            throw SyncArtifactError.corruptPack("missing the packfile's \"PACK\" signature")
        }
    }

    // MARK: - I/O

    private static func readData(_ artifactURL: URL) throws -> Data {
        guard FileManager.default.fileExists(atPath: artifactURL.path) else {
            throw SyncArtifactError.notFound(artifactURL)
        }
        do {
            return try Data(contentsOf: artifactURL)
        } catch {
            throw SyncArtifactError.io(error.localizedDescription)
        }
    }

    /// Writes `header + pack` to a sibling temp file, then swaps it into place — so a reader
    /// never observes a half-written artifact. (The caller, `SyncEngine`, layers its own
    /// `NSFileCoordinator` swap on top when the destination is an iCloud item; this is
    /// self-contained atomicity for direct callers and tests.)
    private static func atomicWrite(header: Data, pack: Data, to artifactURL: URL) throws {
        let directory = artifactURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw SyncArtifactError.io(error.localizedDescription)
        }
        let tmpURL = directory.appendingPathComponent(".\(artifactURL.lastPathComponent).tmp-\(UUID().uuidString)")
        var combined = header
        combined.append(pack)
        do {
            try combined.write(to: tmpURL, options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: tmpURL)
            throw SyncArtifactError.io(error.localizedDescription)
        }
        do {
            _ = try FileManager.default.replaceItemAt(artifactURL, withItemAt: tmpURL)
        } catch {
            try? FileManager.default.removeItem(at: tmpURL)
            throw SyncArtifactError.io(error.localizedDescription)
        }
    }

    // MARK: - libgit2 error plumbing

    private static func lastErrorMessage() -> String {
        if let error = git_error_last() {
            return String(cString: error.pointee.message)
        }
        return "unknown libgit2 error"
    }

    private static func checkOK(_ code: Int32, _ context: String) throws {
        guard code == GIT_OK.rawValue else {
            throw SyncArtifactError.libgit2("\(context) failed (\(code)): \(lastErrorMessage())")
        }
    }

    // MARK: - Write: packbuilder

    /// Walks branches + tags + HEAD, inserting every reachable commit/tree/blob (and, for
    /// annotated tags, the tag object itself) into a `git_packbuilder`, then writes the result to
    /// an in-memory buffer. Objects are inserted in *recency* order — branch tips first, via a
    /// single shared `git_revwalk` — matching libgit2's own guidance for pack locality.
    private static func buildPack(repo: Repository) throws -> (refs: [SyncArtifactRef], packData: Data) {
        var refs: [SyncArtifactRef] = []
        var pushedAnyRoot = false

        var walk: OpaquePointer?
        try checkOK(git_revwalk_new(&walk, repo.pointer), "git_revwalk_new")
        guard let walk else { throw SyncArtifactError.libgit2("git_revwalk_new returned no walk") }
        defer { git_revwalk_free(walk) }

        var packbuilder: OpaquePointer?
        try checkOK(git_packbuilder_new(&packbuilder, repo.pointer), "git_packbuilder_new")
        guard let packbuilder else { throw SyncArtifactError.libgit2("git_packbuilder_new returned no builder") }
        defer { git_packbuilder_free(packbuilder) }

        func pushWalk(_ oid: git_oid) throws {
            var oid = oid
            try checkOK(git_revwalk_push(walk, &oid), "git_revwalk_push")
            pushedAnyRoot = true
        }
        func insert(_ oid: git_oid, name: String?) throws {
            var oid = oid
            try checkOK(git_packbuilder_insert(packbuilder, &oid, name), "git_packbuilder_insert")
            pushedAnyRoot = true
        }
        func insertRecur(_ oid: git_oid, name: String?) throws {
            var oid = oid
            try checkOK(git_packbuilder_insert_recur(packbuilder, &oid, name), "git_packbuilder_insert_recur")
            pushedAnyRoot = true
        }
        /// Peels `object` toward `targetType`, returning its oid on success or `nil` if it can't
        /// be peeled that far (e.g. peeling a tag-to-a-blob toward `GIT_OBJECT_COMMIT`).
        func peel(_ object: OpaquePointer, to targetType: git_object_t) -> git_oid? {
            var peeled: OpaquePointer?
            guard git_object_peel(&peeled, object, targetType) == GIT_OK.rawValue, let peeled else { return nil }
            defer { git_object_free(peeled) }
            return git_object_id(peeled)?.pointee
        }

        // Local branches (refs/heads/*).
        var branchIterator: OpaquePointer?
        try checkOK(git_branch_iterator_new(&branchIterator, repo.pointer, GIT_BRANCH_LOCAL), "git_branch_iterator_new")
        guard let branchIterator else { throw SyncArtifactError.libgit2("git_branch_iterator_new returned no iterator") }
        defer { git_branch_iterator_free(branchIterator) }
        while true {
            var refPointer: OpaquePointer?
            var branchType = GIT_BRANCH_LOCAL
            let result = git_branch_next(&refPointer, &branchType, branchIterator)
            if result == GIT_ITEROVER.rawValue { break }
            try checkOK(result, "git_branch_next")
            guard let refPointer else { break }
            defer { git_reference_free(refPointer) }
            guard let targetPointer = git_reference_target(refPointer) else { continue } // symbolic; skip
            let name = String(cString: git_reference_name(refPointer))
            let oid = targetPointer.pointee
            refs.append(SyncArtifactRef(oid: OID(oid).description, name: name))
            try pushWalk(oid)
        }

        // Tags (refs/tags/*). The header records each ref's *direct* target — the tag object's
        // own oid for an annotated tag, matching `git show-ref`/stock bundle output — while the
        // packbuilder also needs the tag object itself (a revwalk never visits it) and, peeled,
        // whatever it ultimately points at.
        var tagNames = git_strarray()
        try checkOK(git_tag_list(&tagNames, repo.pointer), "git_tag_list")
        defer { git_strarray_free(&tagNames) }
        for index in 0..<tagNames.count {
            guard let cName = tagNames.strings[index] else { continue }
            let shortName = String(cString: cName)
            let refName = "refs/tags/\(shortName)"

            var tagRefPointer: OpaquePointer?
            try checkOK(git_reference_lookup(&tagRefPointer, repo.pointer, refName), "git_reference_lookup")
            guard let tagRefPointer else { continue }
            defer { git_reference_free(tagRefPointer) }
            guard let targetPointer = git_reference_target(tagRefPointer) else { continue }
            let targetOID = targetPointer.pointee
            refs.append(SyncArtifactRef(oid: OID(targetOID).description, name: refName))

            var object: OpaquePointer?
            var lookupOID = targetOID
            try checkOK(git_object_lookup(&object, repo.pointer, &lookupOID, GIT_OBJECT_ANY), "git_object_lookup")
            guard let object else { continue }
            defer { git_object_free(object) }

            switch git_object_type(object) {
            case GIT_OBJECT_TAG:
                try insert(targetOID, name: shortName) // the tag object itself
                if let commitOID = peel(object, to: GIT_OBJECT_COMMIT) {
                    try pushWalk(commitOID)
                } else if let treeOID = peel(object, to: GIT_OBJECT_TREE) {
                    try insertRecur(treeOID, name: nil)
                } else if let blobOID = peel(object, to: GIT_OBJECT_BLOB) {
                    try insert(blobOID, name: nil)
                }
            case GIT_OBJECT_COMMIT:
                try pushWalk(targetOID)
            default: // lightweight tag pointing straight at a tree or blob
                try insertRecur(targetOID, name: shortName)
            }
        }

        // HEAD — informational (which branch is "default"); GIT_EUNBORNBRANCH on a brand-new
        // repo with no commits yet is expected, not an error.
        var headRefPointer: OpaquePointer?
        let headResult = git_repository_head(&headRefPointer, repo.pointer)
        if headResult == GIT_OK.rawValue, let headRefPointer {
            defer { git_reference_free(headRefPointer) }
            if let targetPointer = git_reference_target(headRefPointer) {
                let oid = targetPointer.pointee
                refs.append(SyncArtifactRef(oid: OID(oid).description, name: "HEAD"))
                try pushWalk(oid)
            }
        } else if headResult != GIT_EUNBORNBRANCH.rawValue && headResult != GIT_ENOTFOUND.rawValue {
            try checkOK(headResult, "git_repository_head")
        }

        guard pushedAnyRoot else { throw SyncArtifactError.noRefsToWrite }

        try checkOK(git_packbuilder_insert_walk(packbuilder, walk), "git_packbuilder_insert_walk")

        var buf = git_buf(ptr: nil, reserved: 0, size: 0)
        try checkOK(git_packbuilder_write_buf(&buf, packbuilder), "git_packbuilder_write_buf")
        defer { git_buf_dispose(&buf) }
        let packData = Data(bytes: buf.ptr, count: buf.size)

        return (refs, packData)
    }

    // MARK: - Read: indexer

    private struct IndexStats {
        let indexedObjects: UInt32
    }

    /// Feeds `data[offset...]` through `git_indexer` into `repo`'s object database. Passing the
    /// repo's own odb lets the indexer resolve a *thin* pack (one whose deltas reference objects
    /// the sender assumed the receiver already has) against locally-available bases; a full,
    /// non-thin pack (what `write(from:to:)` always produces) ignores it. `git_odb_refresh`
    /// afterward makes the newly-written pack visible to a `Repository` that was already open
    /// when it landed.
    private static func importPack(data: Data, from offset: Int, into repo: Repository) throws -> IndexStats {
        var odb: OpaquePointer?
        try checkOK(git_repository_odb(&odb, repo.pointer), "git_repository_odb")
        guard let odb else { throw SyncArtifactError.libgit2("git_repository_odb returned no odb") }
        defer { git_odb_free(odb) }

        guard let gitDirCString = git_repository_path(repo.pointer) else {
            throw SyncArtifactError.libgit2("git_repository_path returned no path")
        }
        let packDirectory = URL(fileURLWithPath: String(cString: gitDirCString))
            .appendingPathComponent("objects", isDirectory: true)
            .appendingPathComponent("pack", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: packDirectory, withIntermediateDirectories: true)
        } catch {
            throw SyncArtifactError.io(error.localizedDescription)
        }

        var options = git_indexer_options()
        try checkOK(git_indexer_options_init(&options, UInt32(GIT_INDEXER_OPTIONS_VERSION)), "git_indexer_options_init")
        options.verify = 1

        var indexer: OpaquePointer?
        let newResult = packDirectory.withUnsafeFileSystemRepresentation { path in
            git_indexer_new(&indexer, path, 0, odb, &options)
        }
        try checkOK(newResult, "git_indexer_new")
        guard let indexer else { throw SyncArtifactError.libgit2("git_indexer_new returned no indexer") }
        defer { git_indexer_free(indexer) }

        var stats = git_indexer_progress()
        let packBytes = data[offset...]
        let appendResult: Int32 = packBytes.withUnsafeBytes { raw in
            git_indexer_append(indexer, raw.baseAddress, raw.count, &stats)
        }
        guard appendResult == GIT_OK.rawValue else {
            throw SyncArtifactError.corruptPack(lastErrorMessage())
        }
        guard git_indexer_commit(indexer, &stats) == GIT_OK.rawValue else {
            throw SyncArtifactError.corruptPack(lastErrorMessage())
        }
        try checkOK(git_odb_refresh(odb), "git_odb_refresh")

        return IndexStats(indexedObjects: stats.indexed_objects)
    }

    // MARK: - Read: landing refs

    /// Creates `refs/remotes/<namespace>/<name>` for every header branch and
    /// `refs/remotes/<namespace>/tags/<name>` for every header tag. `HEAD` is metadata only — no
    /// ref is created for it, matching `BundleSync`'s own synthetic-remote convention (its
    /// `defaultBranch` was likewise derived, never persisted as a ref).
    private static func landRefs(_ headerRefs: [SyncArtifactRef], namespace: String, into repo: Repository) throws -> [SyncArtifactRef] {
        var landed: [SyncArtifactRef] = []
        for ref in headerRefs {
            let mappedName: String
            if ref.name.hasPrefix("refs/heads/") {
                mappedName = "refs/remotes/\(namespace)/\(ref.name.dropFirst("refs/heads/".count))"
            } else if ref.name.hasPrefix("refs/tags/") {
                mappedName = "refs/remotes/\(namespace)/tags/\(ref.name.dropFirst("refs/tags/".count))"
            } else {
                continue // "HEAD" (or anything else a foreign bundle might carry) — informational only
            }

            guard let parsedOID = OID(string: ref.oid) else {
                throw SyncArtifactError.malformedRefLine("\(ref.oid) \(ref.name)")
            }
            var oid = parsedOID.oid
            var createdRef: OpaquePointer?
            let result = mappedName.withCString { cName in
                git_reference_create(&createdRef, repo.pointer, cName, &oid, 1, nil)
            }
            try checkOK(result, "git_reference_create")
            if let createdRef { git_reference_free(createdRef) }

            landed.append(SyncArtifactRef(oid: ref.oid, name: mappedName))
        }
        return landed
    }

    // MARK: - Verify: scratch repository

    private struct ScratchRepository {
        let root: URL
        let repo: Repository
    }

    private static func makeScratchRepository() throws -> ScratchRepository {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("anglesite-bundle-verify-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        } catch {
            throw SyncArtifactError.io(error.localizedDescription)
        }
        switch Repository.create(at: root) {
        case .success(let repo): return ScratchRepository(root: root, repo: repo)
        case .failure(let error):
            try? FileManager.default.removeItem(at: root)
            throw SyncArtifactError.libgit2(error.localizedDescription)
        }
    }
}
#endif
