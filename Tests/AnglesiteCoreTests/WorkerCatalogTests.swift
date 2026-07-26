import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WorkerDescriptor")
struct WorkerDescriptorTests {
    @Test("round-trips a componentTied worker through JSONEncoder/JSONDecoder")
    func roundTripsComponentTied() throws {
        let worker = WorkerDescriptor(
            id: "webmention",
            displayName: "Webmentions",
            description: "Receive and verify webmentions for posts",
            group: "social",
            binding: .componentTied(componentIDs: ["webmention-form"]),
            resources: WorkerDescriptor.Resources(needsD1: true, needsKV: true, needsR2: false)
        )

        let data = try JSONEncoder().encode(worker)
        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: data)

        #expect(decoded == worker)
        #expect(decoded.binding == .componentTied(componentIDs: ["webmention-form"]))
    }

    @Test("round-trips a settingsActivated worker with no componentIDs")
    func roundTripsSettingsActivated() throws {
        let worker = WorkerDescriptor(
            id: "solid-pod",
            displayName: "Solid Pod",
            description: "Expose a Solid-compatible personal data store for this site",
            group: "storage",
            binding: .settingsActivated,
            resources: WorkerDescriptor.Resources(needsD1: false, needsKV: true, needsR2: true)
        )

        let data = try JSONEncoder().encode(worker)
        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: data)

        #expect(decoded == worker)
        #expect(decoded.binding == .settingsActivated)
    }

    @Test("decodes the typed-array resources shape catalog.json now publishes")
    func decodesTypedArrayResources() throws {
        let json = """
        {
          "id": "micropub",
          "displayName": "Micropub",
          "description": "Publish posts to this site from any Micropub client",
          "group": "publishing",
          "binding": { "kind": "settingsActivated" },
          "resources": [
            { "type": "d1", "binding": "MICROPUB_DB" },
            { "type": "d1", "binding": "AUTH_DB" },
            { "type": "r2", "binding": "MEDIA" },
            { "type": "secret", "binding": "TOKEN_SIGNING_KEY" }
          ]
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.resources.needsD1 == true)
        #expect(decoded.resources.needsKV == false)
        #expect(decoded.resources.needsR2 == true)
    }

    @Test("a durable-object resource entry decodes without throwing and sets no D1/KV/R2 flag")
    func decodesDurableObjectResourceEntry() throws {
        let json = """
        {
            "id": "activitypub",
            "displayName": "Fediverse",
            "description": "Make this site a Fediverse actor",
            "group": "social",
            "binding": { "kind": "settingsActivated" },
            "resources": [
                { "type": "durable-object", "binding": "ACTOR", "className": "ActivityPubObject", "sqlite": true }
            ]
        }
        """
        let workers = try WorkerCatalogReader.parse(Data("{\"workers\":[\(json)]}".utf8))
        let activitypub = try #require(workers.first)
        #expect(activitypub.resources.needsD1 == false)
        #expect(activitypub.resources.needsKV == false)
        #expect(activitypub.resources.needsR2 == false)
    }

    @Test("still decodes the legacy flat-object resources shape")
    func decodesLegacyFlatResources() throws {
        let json = """
        {
          "id": "solid-pod",
          "displayName": "Solid Pod",
          "description": "Expose a Solid-compatible personal data store for this site",
          "group": "storage",
          "binding": { "kind": "settingsActivated" },
          "resources": { "needsD1": false, "needsKV": true, "needsR2": true }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.resources.needsD1 == false)
        #expect(decoded.resources.needsKV == true)
        #expect(decoded.resources.needsR2 == true)
    }

    @Test("decodes requires when present")
    func decodesRequires() throws {
        let json = """
        {
          "id": "micropub",
          "displayName": "Micropub",
          "description": "Publish posts to this site from any Micropub client",
          "group": "publishing",
          "binding": { "kind": "settingsActivated" },
          "requires": ["indieauth"],
          "resources": { "needsD1": true, "needsKV": false, "needsR2": true }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.requires == ["indieauth"])
    }

    @Test("requires defaults to nil when absent")
    func requiresDefaultsToNil() throws {
        let json = """
        {
          "id": "indieauth",
          "displayName": "IndieAuth",
          "description": "Sign in to apps with your own domain",
          "group": "identity",
          "binding": { "kind": "settingsActivated" },
          "resources": { "needsD1": true, "needsKV": false, "needsR2": false }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.requires == nil)
    }

    @Test("decoding an unknown binding kind throws")
    func unknownBindingKindThrows() {
        let json = """
        { "kind": "somethingElse" }
        """.data(using: .utf8)!

        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(WorkerDescriptor.Binding.self, from: json)
        }
    }
}

@Suite("WorkerCatalogReader")
struct WorkerCatalogReaderTests {
    private let sampleJSON = """
    {
      "workers": [
        {
          "id": "webmention",
          "displayName": "Webmentions",
          "description": "Receive and verify webmentions for posts",
          "group": "social",
          "binding": { "kind": "componentTied", "componentIDs": ["webmention-form"] },
          "resources": { "needsD1": true, "needsKV": true, "needsR2": false }
        },
        {
          "id": "solid-pod",
          "displayName": "Solid Pod",
          "description": "Expose a Solid-compatible personal data store for this site",
          "group": "storage",
          "binding": { "kind": "settingsActivated" },
          "resources": { "needsD1": false, "needsKV": true, "needsR2": true }
        }
      ]
    }
    """.data(using: .utf8)!

    @Test("parses a two-worker manifest with both binding kinds")
    func parsesTwoWorkers() throws {
        let workers = try WorkerCatalogReader.parse(sampleJSON)
        #expect(workers.count == 2)

        let webmention = try #require(workers.first { $0.id == "webmention" })
        #expect(webmention.group == "social")
        #expect(webmention.binding == .componentTied(componentIDs: ["webmention-form"]))
        #expect(webmention.resources.needsD1)
        #expect(!webmention.resources.needsR2)

        let solidPod = try #require(workers.first { $0.id == "solid-pod" })
        #expect(solidPod.binding == .settingsActivated)
    }

    @Test("throws on malformed JSON")
    func throwsOnMalformedJSON() {
        let json = "{ \"not-workers\": [] }".data(using: .utf8)!
        #expect(throws: (any Error).self) {
            _ = try WorkerCatalogReader.parse(json)
        }
    }

    @Test("a catalog without route claims still parses (routes is nil)")
    func parsesWithoutRoutes() throws {
        let workers = try WorkerCatalogReader.parse(sampleJSON)
        #expect(workers.allSatisfy { $0.routes == nil })
    }

    @Test("parses generic HTTP route claims, defaulting authorityBinding to false")
    func parsesRouteClaims() throws {
        let json = """
        {
          "workers": [
            {
              "id": "webfinger",
              "displayName": "WebFinger",
              "description": "RFC 7033 account discovery",
              "group": "social",
              "binding": { "kind": "settingsActivated" },
              "resources": { "needsD1": false, "needsKV": false, "needsR2": false },
              "routes": [
                {
                  "path": "/.well-known/webfinger",
                  "match": "exact",
                  "methods": ["GET", "HEAD"],
                  "handler": "webfinger",
                  "validatorID": "rfc7033",
                  "authorityBinding": true,
                  "specificationURL": "https://www.rfc-editor.org/rfc/rfc7033"
                },
                {
                  "path": "/webmention",
                  "match": "exact",
                  "methods": ["POST"],
                  "handler": "webmention"
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let workers = try WorkerCatalogReader.parse(json)
        let routes = try #require(workers.first?.routes)
        #expect(routes.count == 2)

        let webfinger = try #require(routes.first { $0.path == "/.well-known/webfinger" })
        #expect(webfinger.match == .exact)
        #expect(webfinger.methods == ["GET", "HEAD"])
        #expect(webfinger.handler == "webfinger")
        #expect(webfinger.validatorID == "rfc7033")
        #expect(webfinger.authorityBinding)
        #expect(webfinger.specificationURL == URL(string: "https://www.rfc-editor.org/rfc/rfc7033"))

        let webmention = try #require(routes.first { $0.path == "/webmention" })
        #expect(webmention.validatorID == nil)
        #expect(!webmention.authorityBinding)
        #expect(webmention.specificationURL == nil)
    }

    @Test("parse accepts the published array resources shape (davidwkeith/workers spec/catalog.md)")
    func parseAcceptsPublishedResourcesArrayShape() throws {
        let json = Data("""
        {
          "workers": [
            {
              "id": "indieauth",
              "package": "@dwk/indieauth",
              "displayName": "IndieAuth",
              "description": "Sign in with your own domain",
              "group": "identity",
              "binding": { "kind": "settingsActivated" },
              "requires": [],
              "resources": [
                { "type": "d1", "binding": "AUTH_DB" },
                { "type": "secret", "binding": "TOKEN_SIGNING_KEY" }
              ]
            },
            {
              "id": "solid-pod",
              "displayName": "Solid Pod",
              "description": "Personal data store",
              "group": "storage",
              "binding": { "kind": "settingsActivated" },
              "resources": [
                { "type": "kv", "binding": "POD_KV" },
                { "type": "r2", "binding": "POD_BLOBS" }
              ]
            }
          ]
        }
        """.utf8)

        let workers = try WorkerCatalogReader.parse(json)

        let indieauth = try #require(workers.first { $0.id == "indieauth" })
        #expect(indieauth.resources == WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: false))
        let solidPod = try #require(workers.first { $0.id == "solid-pod" })
        #expect(solidPod.resources == WorkerDescriptor.Resources(needsD1: false, needsKV: true, needsR2: true))
    }

    @Test("Resources round-trips through its encoded object shape")
    func resourcesEncodedObjectShapeRoundTrips() throws {
        let original = WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: true)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WorkerDescriptor.Resources.self, from: data)
        #expect(decoded == original)
    }

    @Test("decoding a prefix route strips the published trailing slash (davidwkeith/workers spec/catalog.md convention)")
    func decodingPrefixRouteStripsTrailingSlash() throws {
        let json = Data("""
        {
          "workers": [
            {
              "id": "activitypub",
              "package": "@dwk/activitypub",
              "displayName": "Fediverse",
              "description": "ActivityPub actor",
              "group": "social",
              "binding": { "kind": "settingsActivated" },
              "resources": { "needsD1": false, "needsKV": false, "needsR2": false },
              "routes": [
                {
                  "path": "/users/",
                  "match": "prefix",
                  "methods": ["GET"],
                  "handler": "createActivityPub",
                  "specificationURL": "https://www.w3.org/TR/activitypub/"
                }
              ]
            }
          ]
        }
        """.utf8)

        let workers = try WorkerCatalogReader.parse(json)
        let route = try #require(workers.first?.routes?.first)
        #expect(route.path == "/users")
    }

    @Test("route claims round-trip through JSONEncoder/JSONDecoder")
    func routeClaimRoundTrip() throws {
        let claim = WorkerRouteClaim(
            path: "/.well-known/acme-challenge",
            match: .prefix,
            methods: ["GET"],
            handler: "acme",
            validatorID: "rfc8555",
            authorityBinding: true,
            specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc8555")
        )
        let decoded = try JSONDecoder().decode(
            WorkerRouteClaim.self, from: JSONEncoder().encode(claim))
        #expect(decoded == claim)
    }
}
