import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WorkerRouteClaims")
struct WorkerRouteClaimsTests {
    private func descriptor(
        id: String,
        routes: [WorkerRouteClaim]?
    ) -> WorkerDescriptor {
        WorkerDescriptor(
            id: id,
            displayName: id,
            description: "test worker",
            group: "social",
            binding: .settingsActivated,
            resources: .init(needsD1: false, needsKV: false, needsR2: false),
            routes: routes
        )
    }

    private func claim(
        _ path: String,
        match: WorkerRouteClaim.Match = .exact,
        methods: [String] = ["GET"],
        specificationURL: URL? = nil
    ) -> WorkerRouteClaim {
        WorkerRouteClaim(
            path: path, match: match, methods: methods, handler: "handler",
            specificationURL: specificationURL)
    }

    private let spec = URL(string: "https://www.rfc-editor.org/rfc/rfc8555")!

    // MARK: Path validation

    @Test("accepts a well-formed exact claim")
    func acceptsWellFormedClaim() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "w", routes: [claim("/.well-known/webfinger", methods: ["GET", "HEAD"])])],
            activeIDs: ["w"])
        #expect(claims.map(\.claim.path) == ["/.well-known/webfinger"])
        #expect(claims.map(\.owner) == ["w"])
    }

    @Test("rejects malformed, traversal, and encoded paths", arguments: [
        "",                          // empty
        "webfinger",                 // relative
        "/",                         // origin root
        "/.well-known",              // bare directory
        "/a//b",                     // empty segment
        "/a/b/",                     // trailing slash
        "/a/../b",                   // traversal
        "/a/./b",                    // dot segment
        "/a%2Fb",                    // encoded separator
        "/%2E%2E/secrets",           // encoded traversal
        "/a?x=1",                    // query
        "/a#frag",                   // fragment
        "/a b",                      // whitespace
        "/a\\b",                     // backslash
        "/a\"b",                     // quote (TOML injection)
    ])
    func rejectsBadPaths(path: String) {
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [descriptor(id: "w", routes: [claim(path)])],
                activeIDs: ["w"])
        }
    }

    @Test("rejects an over-long path")
    func rejectsOverlongPath() {
        let path = "/" + String(repeating: "a", count: 600)
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [descriptor(id: "w", routes: [claim(path)])],
                activeIDs: ["w"])
        }
    }

    // MARK: Method validation

    @Test("rejects empty, unknown, lowercase, duplicate, and unpaired-HEAD method lists", arguments: [
        [String](),
        ["FETCH"],
        ["get"],
        ["GET", "GET"],
        ["HEAD"],           // HEAD is served by mirroring GET, so it requires a paired GET
        ["HEAD", "POST"],
    ])
    func rejectsBadMethods(methods: [String]) {
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [descriptor(id: "w", routes: [claim("/a", methods: methods)])],
                activeIDs: ["w"])
        }
    }

    @Test("accepts the full WebDAV Class 2 method set")
    func acceptsWebDavMethods() throws {
        let claim = WorkerRouteClaim(
            path: "/dav",
            match: .exact,
            methods: ["GET", "PUT", "DELETE", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "OPTIONS"],
            handler: "createSolidPodWebdav",
            specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc4918")
        )
        try WorkerRouteClaims.validate(claim, owner: "webdav")
    }

    @Test("still rejects a genuinely unknown method after the WebDAV widening")
    func stillRejectsUnknownMethod() {
        let claim = WorkerRouteClaim(path: "/dav", match: .exact, methods: ["TRACE"], handler: "createSolidPodWebdav")
        #expect(throws: WorkerRouteClaims.ValidationError.invalidMethods(
            owner: "webdav", path: "/dav", reason: "unknown or non-uppercase method \"TRACE\""
        )) {
            try WorkerRouteClaims.validate(claim, owner: "webdav")
        }
    }

    @Test("documents the upstream catalog bug: same-owner exact + prefix claims to the same base path collide as duplicates")
    func sameOwnerExactPlusPrefixCollide() {
        // Mirrors the *current* (unfixed) catalog.json shape for solid-pod/webdav: an exact "/pod"
        // claim and a prefix "/pod/" claim from the same owner. The prefix claim alone already covers
        // the bare path (see WorkerRouteClaims.runWorkerFirstPatterns), so the exact claim is
        // redundant — but activeClaims doesn't know that, and both claims normalize to path "/pod".
        // This test exists so a future catalog fix (drop the redundant exact claim) has a red-to-green
        // signal, and so nobody "fixes" this by loosening duplicate detection instead.
        let exact = WorkerRouteClaim(path: "/pod", match: .exact, methods: ["GET"], handler: "createSolidPod")
        let prefix = WorkerRouteClaim(
            path: "/pod/", match: .prefix, methods: ["GET"], handler: "createSolidPod",
            specificationURL: URL(string: "https://solidproject.org/TR/protocol")
        )
        let catalog = [
            WorkerDescriptor(
                id: "solid-pod", displayName: "Solid Pod", description: "test fixture", group: "storage",
                binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: true),
                routes: [exact, prefix]
            ),
        ]
        #expect(throws: WorkerRouteClaims.ValidationError.duplicateClaim(path: "/pod", owners: ["solid-pod", "solid-pod"])) {
            try WorkerRouteClaims.activeClaims(catalog: catalog, activeIDs: ["solid-pod"])
        }
    }

    // MARK: Prefix claims

    @Test("rejects a prefix claim with no governing specification (undeclared prefix)")
    func rejectsUndeclaredPrefix() {
        #expect(throws: WorkerRouteClaims.ValidationError.undeclaredPrefix(
            owner: "w", path: "/.well-known/acme-challenge")
        ) {
            try WorkerRouteClaims.activeClaims(
                catalog: [descriptor(id: "w", routes: [claim("/.well-known/acme-challenge", match: .prefix)])],
                activeIDs: ["w"])
        }
    }

    @Test("accepts a specification-approved prefix claim")
    func acceptsSpecApprovedPrefix() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "w", routes: [
                claim("/.well-known/acme-challenge", match: .prefix, specificationURL: spec)
            ])],
            activeIDs: ["w"])
        #expect(claims.count == 1)
    }

    @Test("normalizes a published prefix claim's trailing slash (davidwkeith/workers catalog convention)")
    func normalizesPrefixTrailingSlash() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "activitypub", routes: [
                claim("/users/", match: .prefix, specificationURL: spec)
            ])],
            activeIDs: ["activitypub"])
        #expect(claims.map(\.claim.path) == ["/users"])
    }

    @Test("an exact claim's trailing slash is still rejected — normalization is prefix-only")
    func exactClaimTrailingSlashStillRejected() {
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [descriptor(id: "w", routes: [claim("/users/", match: .exact)])],
                activeIDs: ["w"])
        }
    }

    // MARK: Overlap rejection

    @Test("rejects two exact claims for the same path, naming both owners")
    func rejectsDuplicateExact() {
        #expect(throws: WorkerRouteClaims.ValidationError.duplicateClaim(
            path: "/.well-known/webfinger", owners: ["a", "b"])
        ) {
            try WorkerRouteClaims.activeClaims(
                catalog: [
                    descriptor(id: "b", routes: [claim("/.well-known/webfinger")]),
                    descriptor(id: "a", routes: [claim("/.well-known/webfinger")]),
                ],
                activeIDs: ["a", "b"])
        }
    }

    @Test("rejects an exact claim inside another worker's prefix claim")
    func rejectsExactInsidePrefix() {
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [
                    descriptor(id: "acme", routes: [
                        claim("/.well-known/acme-challenge", match: .prefix, specificationURL: spec)
                    ]),
                    descriptor(id: "rogue", routes: [claim("/.well-known/acme-challenge/token")]),
                ],
                activeIDs: ["acme", "rogue"])
        }
    }

    @Test("rejects overlapping prefix claims")
    func rejectsOverlappingPrefixes() {
        #expect(throws: WorkerRouteClaims.ValidationError.self) {
            try WorkerRouteClaims.activeClaims(
                catalog: [
                    descriptor(id: "outer", routes: [claim("/api", match: .prefix, specificationURL: spec)]),
                    descriptor(id: "inner", routes: [claim("/api/v1", match: .prefix, specificationURL: spec)]),
                ],
                activeIDs: ["outer", "inner"])
        }
    }

    @Test("disjoint sibling claims from different workers coexist")
    func acceptsDisjointClaims() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [
                descriptor(id: "webfinger", routes: [claim("/.well-known/webfinger")]),
                descriptor(id: "webmention", routes: [claim("/webmention", methods: ["POST"])]),
            ],
            activeIDs: ["webfinger", "webmention"])
        #expect(claims.count == 2)
    }

    // MARK: Effective active-set filtering

    @Test("only active workers' claims are exposed; a colliding inactive claim is invisible")
    func filtersToActiveSet() throws {
        let catalog = [
            descriptor(id: "active", routes: [claim("/.well-known/webfinger")]),
            // Same path — would be a duplicateClaim error if it were active.
            descriptor(id: "inactive", routes: [claim("/.well-known/webfinger")]),
        ]
        let claims = try WorkerRouteClaims.activeClaims(catalog: catalog, activeIDs: ["active"])
        #expect(claims.map(\.owner) == ["active"])
    }

    @Test("a descriptor without routes contributes nothing")
    func noRoutesNoClaims() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "w", routes: nil)], activeIDs: ["w"])
        #expect(claims.isEmpty)
    }

    @Test("output order is deterministic regardless of catalog order")
    func deterministicOrder() throws {
        let routesA = [claim("/zeta", methods: ["POST"])]
        let routesB = [claim("/alpha")]
        let forward = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "a", routes: routesA), descriptor(id: "b", routes: routesB)],
            activeIDs: ["a", "b"])
        let reversed = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "b", routes: routesB), descriptor(id: "a", routes: routesA)],
            activeIDs: ["a", "b"])
        #expect(forward == reversed)
        #expect(forward.map(\.claim.path) == ["/alpha", "/zeta"])
    }

    // MARK: run_worker_first derivation

    @Test("exact claims map to their path; prefix claims add a glob; sorted and deduplicated")
    func runWorkerFirstPatterns() {
        let patterns = WorkerRouteClaims.runWorkerFirstPatterns([
            claim("/token", methods: ["POST"]),
            claim("/authorize"),
            claim("/authorize"),  // duplicate collapses
            claim("/.well-known/acme-challenge", match: .prefix, specificationURL: spec),
        ])
        #expect(patterns == [
            "/.well-known/acme-challenge",
            "/.well-known/acme-challenge/*",
            "/authorize",
            "/token",
        ])
    }

    @Test("no claims yields no patterns")
    func emptyPatterns() {
        #expect(WorkerRouteClaims.runWorkerFirstPatterns([]).isEmpty)
    }

    @Test("a catalog-style prefix claim with a trailing slash yields a clean glob, not a doubled slash")
    func runWorkerFirstPatternsNormalizesCatalogPrefix() {
        let patterns = WorkerRouteClaims.runWorkerFirstPatterns([
            claim("/users/", match: .prefix, specificationURL: spec)
        ])
        #expect(patterns == ["/users", "/users/*"])
    }

    // MARK: #744 seam

    @Test("wellKnownClaims filters to the /.well-known/ namespace, keeping ownership")
    func wellKnownFilter() throws {
        let claims = try WorkerRouteClaims.activeClaims(
            catalog: [descriptor(id: "w", routes: [
                claim("/.well-known/webfinger"),
                claim("/webmention", methods: ["POST"]),
            ])],
            activeIDs: ["w"])
        let wellKnown = WorkerRouteClaims.wellKnownClaims(claims)
        #expect(wellKnown.map(\.claim.path) == ["/.well-known/webfinger"])
        #expect(wellKnown.map(\.owner) == ["w"])
    }
}
