# Anywhere Runtime P0 — `AnglesiteP2P` Transport Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **As-built note (2026-08-04):** P0 landed via PR #1219; the exit criterion passed on macOS (confirming stasel/WebRTC 150.0.0 ships a `macos-x86_64_arm64` slice). This plan text was updated post-review to match as-built decisions: commit-revision dependency pin, percent-decode-then-check traversal guard, and load-tolerant (event-driven) heartbeat timing tests.

**Goal:** Vendor libwebrtc and build the `AnglesiteP2P` SwiftPM target — four logical data channels (`mcp`/`http`/`hmr`/`control`), a `WebRTCTransport: MCPTransport` conformer, a fetch bridge with faithful HTTP semantics, and file-based signaling — proven by a two-process E2E where a page and an MCP round-trip cross the bridge.

**Architecture:** All protocol logic (framing, MCP transport, fetch bridge, relays) is written against a small `P2PConnection` abstraction and unit-tested with an in-process fake pair — no network, no libwebrtc. libwebrtc appears only in one conformer (`WebRTCPeer`) plus the signaling glue, exercised by opt-in gated tests (`ANGLESITE_P2P_E2E=1`), mirroring how `ANGLESITE_CONTAINER_TESTS` gates the container suites. Epic: [#1208](https://github.com/Anglesite/Anglesite/issues/1208); spec: `docs/superpowers/specs/2026-08-03-anywhere-runtime-webrtc-design.md`.

**Tech Stack:** Swift 6.4 / Xcode 27, SwiftPM, Swift Testing (`import Testing`), [stasel/WebRTC](https://github.com/stasel/WebRTC) release `150.0.0` pinned **by commit revision** (`6ed87f05…` — repo convention: every third-party dependency pins a revision and is bumped deliberately, see the pin-policy comments in `Package.swift`; dependency approved in #1208). The prebuilt xcframework includes a macOS slice (verified — the P0 E2E runs on macOS).

## Global Constraints

- `swift test` needs `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` on the owner's machine (CommandLineTools swift is too old).
- Every new target gets `swiftSettings: strictConcurrency` like its siblings in `Package.swift`.
- Conformers of `MCPTransport` must be actors ("Conformers own mutable connection state, so each is an `actor`" — `Sources/AnglesiteCore/MCPTransport.swift:8`).
- `AnglesiteP2P` is **Darwin-only** in P0 (the WebRTC binary is Darwin-only): gate the target and its test target with the existing `#if canImport(Darwin)` pattern used for SwiftGit2 in `Package.swift`.
- Do not touch `project.yml` — the app target does not link `AnglesiteP2P` until P1/P4; P0 is pure SwiftPM.
- New public API needs `///` doc comments per `docs/comment-style-guide.md` (CI fails on broken DocC links).
- Commit subjects ≤72 chars, conventional-commit format, reference #1208.
- Tests are Swift Testing (`@Test`, `#expect`), not XCTest.
- Code lands on a new branch `feat/1208-p0-p2p-transport-core` cut from `main` in a fresh worktree (`.claude/worktrees/1208-p0-p2p/`) — not on this spec's docs branch or worktree. Run `xcodegen generate` there once (repo convention), though P0 never builds the app target.

## File Structure

```
Sources/AnglesiteP2P/
  P2PChannel.swift          # P2PChannelID enum + P2PConnection protocol
  P2PFraming.swift          # HTTPBridgeFrame / HMRFrame / ControlMessage codecs
  InProcessP2PPair.swift    # loopback P2PConnection pair (test double, shipped in target for reuse by later phases' tests)
  WebRTCTransport.swift     # MCPTransport over the mcp channel (client side)
  MCPChannelResponder.swift # host side: mcp frames -> handler -> response frames
  FetchBridge.swift         # FetchBridgeClient (client) + FetchBridgeServer (host) + HTTPExecutor
  DirectoryHTTPExecutor.swift # file-serving HTTPExecutor for tests/demo (P1 replaces with dev-server executor)
  HMRRelay.swift            # host-side websocket relay + client-side frame stream
  Signaling.swift           # SignalingChannel protocol + SignalingEnvelope
  FileSignalingChannel.swift# file-directory signaling (E2E + UTM rig)
  WebRTCPeer.swift          # libwebrtc conformer of P2PConnection (only PRODUCTION file importing WebRTC — SmokeTests.swift also imports it for the link check)
Sources/anglesite-p2p-demo/
  main.swift                # host/client subcommands for the two-process E2E
Tests/AnglesiteP2PTests/
  SmokeTests.swift          # Task 1 link check (imports WebRTC directly)
  P2PFramingTests.swift
  InProcessP2PPairTests.swift
  WebRTCTransportTests.swift
  FetchBridgeTests.swift
  HMRRelayTests.swift
  FileSignalingChannelTests.swift
  WebRTCPeerTests.swift     # gated ANGLESITE_P2P_E2E=1 (real libwebrtc, in-process pair)
  TwoProcessE2ETests.swift  # gated ANGLESITE_P2P_E2E=1 (spawns anglesite-p2p-demo twice)
```

Out of P0 scope (explicitly deferred): CloudKit signaling + key pinning (P2), TURN credentials (P3), `P2PSiteRuntime`/`WKURLSchemeHandler` (P4), helper app + real dev-server/MCP endpoints behind the bridge (P1).

---

### Task 1: Package scaffolding — WebRTC dependency + `AnglesiteP2P` target

**Files:**
- Modify: `Package.swift` (dependency list — anchor on the SwiftGit2 `.package` entry and its pin-policy comment, not a line number; `packageTargets` array; test-target list)
- Create: `Sources/AnglesiteP2P/P2PChannel.swift`
- Test: `Tests/AnglesiteP2PTests/SmokeTests.swift`

**Interfaces:**
- Produces: `P2PChannelID` (enum `mcp`, `http`, `hmr`, `control`: `String`, `CaseIterable`, `Sendable`) — every later task uses it. Target `AnglesiteP2P` depends on `AnglesiteCore` (for `JSONValue`/`MCPTransport`) and `.product(name: "WebRTC", package: "WebRTC")`.

- [ ] **Step 1: Add the dependency + targets to `Package.swift`**

Follow the SwiftGit2 Darwin-gating pattern already in the file. Add next to the SwiftGit2 `.package` line:

```swift
// Anywhere runtime (#1208): prebuilt libwebrtc for the P2P transport core.
// Darwin-only binary xcframework — the target set below only includes
// AnglesiteP2P on Darwin, so the dependency never enters the Linux graph.
```

and inside the existing `#if canImport(Darwin)` dependency section:

```swift
// Corresponds to release 150.0.0; pinned by revision per repo policy —
// every third-party dependency here is bumped deliberately.
.package(url: "https://github.com/stasel/WebRTC.git", revision: "6ed87f05368632f71dc95c89c14c051561710925")
```

Append to `packageTargets` inside a `#if canImport(Darwin)` block (same mechanism as the `includeContainer` append):

```swift
#if canImport(Darwin)
packageTargets.append(contentsOf: [
    .target(
        name: "AnglesiteP2P",
        dependencies: [
            "AnglesiteCore",
            .product(name: "WebRTC", package: "WebRTC"),
        ],
        path: "Sources/AnglesiteP2P",
        swiftSettings: strictConcurrency
    ),
    .executableTarget(
        name: "anglesite-p2p-demo",
        dependencies: ["AnglesiteP2P"],
        path: "Sources/anglesite-p2p-demo",
        swiftSettings: strictConcurrency
    ),
    .testTarget(
        name: "AnglesiteP2PTests",
        dependencies: ["AnglesiteP2P"],
        path: "Tests/AnglesiteP2PTests",
        swiftSettings: strictConcurrency
    ),
])
#endif
```

- [ ] **Step 2: Create `P2PChannel.swift` with the channel enum only**

```swift
import Foundation

/// The four logical data channels of an Anywhere-runtime session (spec §Architecture 1).
/// Each maps 1:1 to a WebRTC data channel; the label is the channel's wire name.
public enum P2PChannelID: String, CaseIterable, Sendable {
    /// MCP JSON-RPC frames — one message per frame, no envelope.
    case mcp
    /// Fetch-bridge frames (`HTTPBridgeFrame` envelope) for preview HTTP.
    case http
    /// HMR websocket relay frames (`HMRFrame` envelope).
    case hmr
    /// Session lifecycle: heartbeat, deploy request/progress (`ControlMessage` JSON).
    case control
}
```

- [ ] **Step 3: Write the smoke test**

`Tests/AnglesiteP2PTests/SmokeTests.swift`:

```swift
import Testing
import WebRTC
@testable import AnglesiteP2P

@Suite struct SmokeTests {
    @Test func libwebrtcLinksAndInstantiates() {
        let factory = RTCPeerConnectionFactory()
        _ = factory
        #expect(P2PChannelID.allCases.count == 4)
    }
}
```

- [ ] **Step 4: Resolve + run**

Run: `swift package resolve && swift test --filter AnglesiteP2PTests`
Expected: PASS (note: `--filter` still compiles the whole package — a broken sibling target blocks it).

- [ ] **Step 5: Commit**

```bash
git add Package.swift Package.resolved Sources/AnglesiteP2P Tests/AnglesiteP2PTests
git commit -m "feat(#1208): vendor libwebrtc + AnglesiteP2P target scaffold"
```

---

### Task 2: Wire framing — `HTTPBridgeFrame`, `HMRFrame`, `ControlMessage`

**Files:**
- Create: `Sources/AnglesiteP2P/P2PFraming.swift`
- Test: `Tests/AnglesiteP2PTests/P2PFramingTests.swift`

**Interfaces:**
- Produces (all `Sendable`, `Equatable`):

```swift
public struct BridgeRequestHead: Codable, Sendable, Equatable {
    public var method: String            // "GET", "POST", …
    public var path: String              // path + query, e.g. "/blog/?draft=1"
    public var headers: [String: String]
    public init(method: String, path: String, headers: [String: String])
}
public struct BridgeResponseHead: Codable, Sendable, Equatable {
    public var status: Int
    public var headers: [String: String]
    public init(status: Int, headers: [String: String])
}
/// One message on the `http` channel. Concurrent requests interleave, correlated by `id`.
public enum HTTPBridgeFrame: Sendable, Equatable {
    case requestHead(id: UInt32, BridgeRequestHead)
    case requestBody(id: UInt32, Data)      // zero or more
    case requestEnd(id: UInt32)
    case responseHead(id: UInt32, BridgeResponseHead)
    case responseBody(id: UInt32, Data)     // zero or more
    case responseEnd(id: UInt32)
    case abort(id: UInt32, reason: String)  // either direction; terminal for that id

    public func encoded() throws -> Data
    public static func decode(_ data: Data) throws -> HTTPBridgeFrame
}
/// One message on the `hmr` channel — a verbatim websocket event.
public enum HMRFrame: Sendable, Equatable {
    case text(String)
    case binary(Data)
    case closed(code: Int)
    public func encoded() throws -> Data
    public static func decode(_ data: Data) throws -> HMRFrame
}
/// JSON messages on the `control` channel. `deployRequest`/`deployEvent` are
/// declared now so the wire enum is stable, but P0 ships no handler for them (P5).
public enum ControlMessage: Codable, Sendable, Equatable {
    case hello(sessionID: String)
    case ping(seq: Int)
    case pong(seq: Int)
    case deployRequest(id: String)
    case deployEvent(id: String, line: String)
}
public enum P2PFramingError: Error, Equatable { case malformed, unknownKind(UInt8) }
```

Wire format for `HTTPBridgeFrame`: `[u8 kind][u32 big-endian id][payload]` where kind ∈ 0=requestHead…6=abort; head/abort payloads are JSON, body payloads are raw bytes. `HMRFrame`: `[u8 kind][payload]` (0=text UTF-8, 1=binary, 2=closed with 2-byte BE code). `ControlMessage` is plain `JSONEncoder` output (no envelope — the channel is homogeneous).

- [ ] **Step 1: Write failing round-trip + malformed-input tests**

```swift
import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct P2PFramingTests {
    @Test func httpFrameRoundTripsAllKinds() throws {
        let frames: [HTTPBridgeFrame] = [
            .requestHead(id: 7, BridgeRequestHead(method: "GET", path: "/a?b=1", headers: ["Accept": "text/html"])),
            .requestBody(id: 7, Data([0x00, 0xFF])),
            .requestEnd(id: 7),
            .responseHead(id: 7, BridgeResponseHead(status: 200, headers: ["Content-Type": "text/html"])),
            .responseBody(id: 7, Data("hi".utf8)),
            .responseEnd(id: 7),
            .abort(id: 9, reason: "cancelled"),
        ]
        for frame in frames {
            #expect(try HTTPBridgeFrame.decode(frame.encoded()) == frame)
        }
    }

    @Test func truncatedFrameThrowsMalformed() {
        #expect(throws: P2PFramingError.malformed) { _ = try HTTPBridgeFrame.decode(Data([0x00, 0x01])) }
    }

    @Test func unknownKindThrows() {
        var data = Data([0x63]); data.append(contentsOf: [0, 0, 0, 1])
        #expect(throws: P2PFramingError.unknownKind(0x63)) { _ = try HTTPBridgeFrame.decode(data) }
    }

    @Test func hmrFrameRoundTrips() throws {
        for frame in [HMRFrame.text("reload"), .binary(Data([1, 2])), .closed(code: 1001)] {
            #expect(try HMRFrame.decode(frame.encoded()) == frame)
        }
    }

    @Test func controlMessageRoundTrips() throws {
        let msg = ControlMessage.ping(seq: 3)
        let data = try JSONEncoder().encode(msg)
        #expect(try JSONDecoder().decode(ControlMessage.self, from: data) == msg)
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test --filter P2PFramingTests` → FAIL (types undefined).

- [ ] **Step 3: Implement `P2PFraming.swift`** — the types above; `encoded()` builds `Data` by appending kind byte, `UInt32.bigEndian` bytes, payload; `decode` validates length ≥5 before slicing and throws `P2PFramingError.malformed`/`.unknownKind`.

- [ ] **Step 4: Run to verify pass** — `swift test --filter P2PFramingTests` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): P2P wire framing (http/hmr/control)"`

---

### Task 3: `P2PConnection` protocol + `InProcessP2PPair`

**Files:**
- Modify: `Sources/AnglesiteP2P/P2PChannel.swift` (add protocol)
- Create: `Sources/AnglesiteP2P/InProcessP2PPair.swift`
- Test: `Tests/AnglesiteP2PTests/InProcessP2PPairTests.swift`

**Interfaces:**
- Produces:

```swift
/// A connected P2P session: four message-oriented duplex channels.
/// Conformers: `WebRTCPeer` (production), `InProcessP2PPair.End` (tests).
public protocol P2PConnection: Sendable {
    /// Send one message on a channel. Suspends under backpressure; throws once the connection is closed.
    func send(_ data: Data, on channel: P2PChannelID) async throws
    /// The single inbound stream for a channel. Call once per channel; finishes on close.
    func inbound(_ channel: P2PChannelID) -> AsyncStream<Data>
    /// Tear down; all inbound streams finish, subsequent sends throw `P2PConnectionError.closed`.
    func close() async
}
public enum P2PConnectionError: Error, Equatable { case closed }

/// Loopback pair: whatever one end sends, the other receives, per channel.
public struct InProcessP2PPair {
    public let a: End
    public let b: End
    public static func make() -> InProcessP2PPair
    public actor End: P2PConnection { … }
}
```

- [ ] **Step 1: Write failing tests**

```swift
import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct InProcessP2PPairTests {
    @Test func messagesCrossPerChannelInOrder() async throws {
        let pair = InProcessP2PPair.make()
        let inbound = pair.b.inbound(.mcp)
        try await pair.a.send(Data("one".utf8), on: .mcp)
        try await pair.a.send(Data("two".utf8), on: .mcp)
        var it = inbound.makeAsyncIterator()
        #expect(await it.next() == Data("one".utf8))
        #expect(await it.next() == Data("two".utf8))
    }

    @Test func channelsAreIsolated() async throws {
        let pair = InProcessP2PPair.make()
        let http = pair.b.inbound(.http)
        try await pair.a.send(Data("mcp".utf8), on: .mcp)
        try await pair.a.send(Data("http".utf8), on: .http)
        var it = http.makeAsyncIterator()
        #expect(await it.next() == Data("http".utf8))
    }

    @Test func closeFinishesInboundAndFailsSend() async throws {
        let pair = InProcessP2PPair.make()
        let inbound = pair.b.inbound(.control)
        await pair.a.close()
        var it = inbound.makeAsyncIterator()
        #expect(await it.next() == nil)
        await #expect(throws: P2PConnectionError.closed) {
            try await pair.b.send(Data(), on: .control)
        }
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test --filter InProcessP2PPairTests` → FAIL.

- [ ] **Step 3: Implement.** `End` is an actor holding `[P2PChannelID: AsyncStream<Data>.Continuation]` (created lazily via `makeStream`, `.unbounded`), a weak/unowned-safe reference to its peer via a small shared `actor Mailbox` (simplest: `make()` builds both ends, then sets `a.peer = b`, `b.peer = a` through an internal `setPeer` method), and a `closed` flag. `send` throws `.closed` when either side closed; `close()` finishes both ends' continuations.

- [ ] **Step 4: Run to verify pass** — PASS, then run the full new suite once: `swift test --filter AnglesiteP2PTests`.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): P2PConnection seam + in-process loopback pair"`

---

### Task 4: `WebRTCTransport: MCPTransport` + `MCPChannelResponder`

**Files:**
- Create: `Sources/AnglesiteP2P/WebRTCTransport.swift`, `Sources/AnglesiteP2P/MCPChannelResponder.swift`
- Test: `Tests/AnglesiteP2PTests/WebRTCTransportTests.swift`

**Interfaces:**
- Consumes: `P2PConnection`, `P2PChannelID.mcp`; `MCPTransport` + `JSONValue` from `AnglesiteCore` (`JSONValue` has `encodedData()`/decoding used by `HTTPTransport` — reuse the same encode/decode helpers; check `MCPClient.swift` for the exact names and mirror `HTTPTransport`'s usage).
- Produces:

```swift
/// Client-side MCP transport: one JSON-RPC message per data-channel frame on `mcp`.
public actor WebRTCTransport: MCPTransport {
    public init(connection: any P2PConnection)
    public func open() async throws        // no-op; the connection pre-exists
    public func send(_ message: JSONValue) async throws
    public func inbound() -> AsyncStream<JSONValue>
    public func close() async              // closes only the stream, NOT the connection (shared with 3 other channels)
}

/// Host-side counterpart: decodes each inbound mcp frame, invokes `handler`,
/// sends the non-nil result back. P1 supplies the production handler that
/// bridges to the container's MCP endpoint; P0 uses stubs.
public actor MCPChannelResponder {
    public typealias Handler = @Sendable (JSONValue) async -> JSONValue?
    public init(connection: any P2PConnection, handler: @escaping Handler)
    public func run() async                // consume inbound(.mcp) until it finishes
}
```

- [ ] **Step 1: Write failing round-trip test over the loopback pair**

```swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteP2P

@Suite struct WebRTCTransportTests {
    @Test func requestCrossesBridgeAndResponseReturns() async throws {
        let pair = InProcessP2PPair.make()
        let responder = MCPChannelResponder(connection: pair.b) { message in
            guard case let .object(fields) = message, fields["id"] != nil else { return nil }
            return .object(["jsonrpc": .string("2.0"), "id": fields["id"]!, "result": .object(["ok": .bool(true)])])
        }
        let serverTask = Task { await responder.run() }
        let transport = WebRTCTransport(connection: pair.a)
        try await transport.open()
        let inbound = transport.inbound()
        try await transport.send(.object(["jsonrpc": .string("2.0"), "id": .number(1), "method": .string("initialize")]))
        var it = inbound.makeAsyncIterator()
        let reply = await it.next()
        guard case let .object(fields)? = reply else { Issue.record("no reply"); return }
        #expect(fields["result"] == .object(["ok": .bool(true)]))
        serverTask.cancel()
    }

    @Test func notificationGetsNoReply() async throws {
        let pair = InProcessP2PPair.make()
        let responder = MCPChannelResponder(connection: pair.b) { _ in nil }
        let serverTask = Task { await responder.run() }
        let transport = WebRTCTransport(connection: pair.a)
        try await transport.send(.object(["jsonrpc": .string("2.0"), "method": .string("notifications/x")]))
        // Close the far end; the transport's inbound stream must finish without emitting.
        await pair.b.close()
        var it = transport.inbound().makeAsyncIterator()
        #expect(await it.next() == nil)
        serverTask.cancel()
    }
}
```

(Adjust `JSONValue` case spellings to the real enum in `Sources/AnglesiteCore/MCPClient.swift:10` — read it before writing the test; `.number`/`.string`/`.object`/`.bool` names above are assumptions to verify, not gospel.)

- [ ] **Step 2: Run to verify failure** — `swift test --filter WebRTCTransportTests` → FAIL.

- [ ] **Step 3: Implement.** `WebRTCTransport`: `send` encodes `JSONValue` with the same JSON encoding `HTTPTransport` uses and calls `connection.send(_:on:.mcp)`; a task started in `init` (or first `inbound()` call) decodes `connection.inbound(.mcp)` frames into the stream, dropping undecodable frames **loudly** via `Logger` (no silent discard — logs are sacred). `close()` finishes the stream and cancels the pump task. `MCPChannelResponder.run()`: `for await` frames, decode, `handler`, encode + send non-nil results; decode failures log and continue.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): MCP over data channel (WebRTCTransport + responder)"`

---

### Task 5: Fetch bridge — `FetchBridgeClient`, `FetchBridgeServer`, `HTTPExecutor`, `DirectoryHTTPExecutor`

**Files:**
- Create: `Sources/AnglesiteP2P/FetchBridge.swift`, `Sources/AnglesiteP2P/DirectoryHTTPExecutor.swift`
- Test: `Tests/AnglesiteP2PTests/FetchBridgeTests.swift`

**Interfaces:**
- Consumes: `P2PConnection`, `HTTPBridgeFrame`, `BridgeRequestHead`, `BridgeResponseHead`.
- Produces:

```swift
/// Executes one HTTP exchange on the host side. Production (P1): URLSession against the
/// container dev server with redirects NOT followed. P0/tests: DirectoryHTTPExecutor.
public protocol HTTPExecutor: Sendable {
    func execute(_ request: BridgeRequestHead, body: Data?) async throws
        -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>)
}

/// Client (phone/P4) side: turn a request into interleavable frames and reassemble the reply.
public actor FetchBridgeClient {
    public init(connection: any P2PConnection)
    /// Streams the response; the returned stream throws if the host aborts.
    public func perform(_ request: BridgeRequestHead, body: Data? = nil) async throws
        -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>)
}

/// Host side: consume inbound http frames, run them through the executor, stream results back.
public actor FetchBridgeServer {
    public init(connection: any P2PConnection, executor: any HTTPExecutor)
    public func run() async
}

/// Serves GET requests from a directory root (index.html for "/", content-type by extension:
/// html, css, js, mjs, json, svg, png, jpg, webp, txt; else application/octet-stream).
/// Non-GET → 405; missing file → 404; traversal → 400 — percent-decode the raw path FIRST
/// (undecodable → 400), then reject any ".." component, all before touching the filesystem;
/// a raw-substring check alone is bypassable via %2e%2e encoding.
public struct DirectoryHTTPExecutor: HTTPExecutor {
    public init(root: URL)
}
```

Faithfulness rules (spec §Approaches B): status passes through verbatim (incl. 3xx — the client does **not** follow redirects; the P4 scheme handler decides); hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`) are stripped by `FetchBridgeServer` before framing; bodies stream in ≤64 KiB `responseBody` frames; concurrent requests interleave correlated by id (client assigns ids from an incrementing counter).

- [ ] **Step 1: Write failing tests**

```swift
import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct FetchBridgeTests {
    static func makeSiteRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("p2p-bridge-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("<h1>hello</h1>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data(count: 200_000).write(to: root.appendingPathComponent("big.bin"))  // > one 64 KiB frame
        return root
    }

    @Test func pageCrossesTheBridge() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        #expect(head.status == 200)
        #expect(head.headers["Content-Type"] == "text/html")
        var collected = Data()
        for try await chunk in body { collected.append(chunk) }
        #expect(String(decoding: collected, as: UTF8.self) == "<h1>hello</h1>")
        serverTask.cancel()
    }

    @Test func largeBodyStreamsInMultipleFrames() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/big.bin", headers: [:]))
        #expect(head.status == 200)
        var total = 0
        var chunks = 0
        for try await chunk in body { total += chunk.count; chunks += 1 }
        #expect(total == 200_000)
        #expect(chunks >= 3)
        serverTask.cancel()
    }

    @Test func missingFileIs404AndTraversalIs400() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (missing, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/nope.html", headers: [:]))
        #expect(missing.status == 404)
        let (traversal, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/../etc/passwd", headers: [:]))
        #expect(traversal.status == 400)
        serverTask.cancel()
    }

    @Test func concurrentRequestsInterleaveCorrectly() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        try await withThrowingTaskGroup(of: Int.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    let (_, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/big.bin", headers: [:]))
                    var total = 0
                    for try await chunk in body { total += chunk.count }
                    return total
                }
            }
            for try await total in group { #expect(total == 200_000) }
        }
        serverTask.cancel()
    }

    @Test func hopByHopHeadersAreStripped() async throws {
        struct FixedExecutor: HTTPExecutor {
            func execute(_ request: BridgeRequestHead, body: Data?) async throws
                -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>) {
                let head = BridgeResponseHead(status: 301, headers: [
                    "Location": "/new", "Connection": "keep-alive", "Transfer-Encoding": "chunked",
                ])
                return (head, AsyncThrowingStream { $0.finish() })
            }
        }
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: FixedExecutor())
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/old", headers: [:]))
        #expect(head.status == 301)                    // redirect passes through, not followed
        #expect(head.headers["Location"] == "/new")
        #expect(head.headers["Connection"] == nil)
        #expect(head.headers["Transfer-Encoding"] == nil)
        serverTask.cancel()
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test --filter FetchBridgeTests` → FAIL.

- [ ] **Step 3: Implement.** `FetchBridgeClient.perform`: allocate id, register a pending-response continuation in actor state, send `requestHead` (+ `requestBody`/`requestEnd` when body non-nil, else bare `requestEnd`), await head; body stream yields `responseBody` payloads until `responseEnd` (finish) or `abort` (finish throwing). A single pump task (started on first use) demultiplexes `connection.inbound(.http)` by id. `FetchBridgeServer.run`: demultiplex inbound frames by id into per-request accumulators; on `requestEnd`, spawn a child task: `executor.execute` → strip hop-by-hop headers → send `responseHead`, then ≤64 KiB `responseBody` frames, then `responseEnd`; executor throws → `abort(id:reason:)`. `DirectoryHTTPExecutor`: reject non-GET (405); percent-decode the raw path (undecodable → 400), then reject any `..` component (400) — all **before** touching the filesystem; resolve against root, map to 200/404; stream file contents in 64 KiB reads.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): fetch bridge with faithful HTTP semantics"`

---

### Task 6: `HMRRelay` + control-channel heartbeat

**Files:**
- Create: `Sources/AnglesiteP2P/HMRRelay.swift`
- Test: `Tests/AnglesiteP2PTests/HMRRelayTests.swift`

**Interfaces:**
- Consumes: `P2PConnection`, `HMRFrame`, `ControlMessage`.
- Produces:

```swift
/// Host-side websocket source seam. Production (P1): URLSessionWebSocketTask to the dev
/// server's HMR endpoint. Tests: scripted fake.
public protocol WebSocketSource: Sendable {
    func events() -> AsyncStream<HMRFrame>
}

/// Host side: forwards every source event onto the hmr channel.
public actor HMRRelayHost {
    public init(connection: any P2PConnection, source: any WebSocketSource)
    public func run() async
}

/// Client side: decoded HMR events for the P4 scheme-handler/webview to consume.
public struct HMRRelayClient: Sendable {
    public init(connection: any P2PConnection)
    public func events() -> AsyncStream<HMRFrame>
}

/// Bidirectional heartbeat over `control`: sends `ping(seq:)` every `interval`,
/// answers inbound pings with pongs, and reports a missed-pong count via `onMiss`
/// so the session owner (P1 helper / P4 runtime) can declare the link dead.
public actor ControlHeartbeat {
    public init(connection: any P2PConnection, interval: Duration, missLimit: Int,
                onMiss: @escaping @Sendable (Int) -> Void)
    public func run() async
}
```

- [ ] **Step 1: Write failing tests** — relay forwards `text`/`binary`/`closed` in order end-to-end over `InProcessP2PPair` (scripted `WebSocketSource` yielding three events; client collects three equal events); heartbeat answers a ping with a pong (drive `pair.a`'s control channel manually: send an encoded `ControlMessage.ping(seq: 1)`, expect a `pong(seq: 1)` frame back on `pair.a`'s inbound control stream); missed pongs invoke `onMiss` (construct with `interval: .milliseconds(20)`, `missLimit: 2`, no responder on the far end, expect ≥2 `onMiss` calls via **event-driven waiting with a generous cap** — tens of seconds, guarded by a `.timeLimit` trait; loaded CI runners see multi-second scheduling delays, so assert *liveness, not latency*, and **never** use `Task.sleep(.zero)` (CI allocator crash on macos-26 runners — see `CLAUDE.md` ▸ Build / PRs #644/#646)).

- [ ] **Step 2: Run to verify failure** — `swift test --filter HMRRelayTests` → FAIL.

- [ ] **Step 3: Implement** the three types; all JSON/`HMRFrame` decode failures log-and-continue, never silently drop without a log line.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): HMR relay + control heartbeat"`

---

### Task 7: Signaling seam + `FileSignalingChannel` + `WebRTCPeer`

**Files:**
- Create: `Sources/AnglesiteP2P/Signaling.swift`, `Sources/AnglesiteP2P/FileSignalingChannel.swift`, `Sources/AnglesiteP2P/WebRTCPeer.swift`
- Test: `Tests/AnglesiteP2PTests/FileSignalingChannelTests.swift`, `Tests/AnglesiteP2PTests/WebRTCPeerTests.swift`

**Interfaces:**
- Produces:

```swift
/// One signaling message. P2 adds signatures/key-pinning around this envelope;
/// P0 carries it in the clear (file signaling is local-only dev/test infra).
public struct SignalingEnvelope: Codable, Sendable, Equatable {
    public var seq: Int
    public var sender: String        // stable per-endpoint id, e.g. "host" / "client"
    public var kind: Kind
    public var payload: String       // SDP text, or ICE candidate JSON
    public enum Kind: String, Codable, Sendable { case offer, answer, candidate, bye }
    public init(seq: Int, sender: String, kind: Kind, payload: String)
}

/// The rendezvous mailbox (spec §Architecture 3). P2 conformer: CloudKit. P0: files.
public protocol SignalingChannel: Sendable {
    func send(_ envelope: SignalingEnvelope) async throws
    /// Envelopes from OTHER senders only (a channel never echoes its own), in seq order.
    func envelopes() -> AsyncStream<SignalingEnvelope>
    func close() async
}

/// Directory-backed signaling: each envelope is `<seq>-<sender>.json`; a 100 ms
/// polling loop picks up new files. Local-only test/dev infra (E2E + UTM rig #589).
public actor FileSignalingChannel: SignalingChannel {
    public init(directory: URL, sender: String)
}

/// The libwebrtc conformer of `P2PConnection` — the only file importing WebRTC.
public actor WebRTCPeer: P2PConnection {
    public enum Role: Sendable { case offerer, answerer }
    /// Drives signaling to a connected state: offerer creates the four data channels
    /// (labels = P2PChannelID rawValues) + the offer; answerer answers; both trickle ICE.
    /// `iceServers` is empty for loopback tests; P3 injects STUN/TURN.
    public static func connect(role: Role, signaling: any SignalingChannel,
                               iceServers: [String] = []) async throws -> WebRTCPeer
}
```

- [ ] **Step 1: Write failing `FileSignalingChannel` tests** — envelope written by sender "a" arrives at a channel with sender "b" watching the same directory (and not vice-versa echo); envelopes arrive in seq order when written out of order (write seq 2's file before seq 1's, expect delivery 1 then 2 — the poller sorts pending files by seq and only delivers the next contiguous seq per sender); `close()` finishes the stream.

- [ ] **Step 2: Run to verify failure**, then implement, then verify pass. `FileSignalingChannel` polls with `Task.sleep(for: .milliseconds(100))` in a loop; files are written atomically (`Data.write(to:options:.atomic)`) so a reader never sees partial JSON.

- [ ] **Step 3: Commit** — `git commit -m "feat(#1208): SignalingChannel seam + file signaling"`

- [ ] **Step 4: Write the gated `WebRTCPeer` test** (in-process pair of real peers, file signaling in a temp dir):

```swift
import Testing
import Foundation
@testable import AnglesiteP2P

@Suite(.enabled(if: ProcessInfo.processInfo.environment["ANGLESITE_P2P_E2E"] == "1"))
struct WebRTCPeerTests {
    @Test func twoRealPeersConnectAndExchangeOnEveryChannel() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("p2p-sig-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        async let hostPeer = WebRTCPeer.connect(role: .answerer, signaling: FileSignalingChannel(directory: dir, sender: "host"))
        async let clientPeer = WebRTCPeer.connect(role: .offerer, signaling: FileSignalingChannel(directory: dir, sender: "client"))
        let (host, client) = try await (hostPeer, clientPeer)
        for channel in P2PChannelID.allCases {
            let inbound = host.inbound(channel)
            try await client.send(Data(channel.rawValue.utf8), on: channel)
            var it = inbound.makeAsyncIterator()
            #expect(await it.next() == Data(channel.rawValue.utf8))
        }
        await client.close()
        await host.close()
    }
}
```

- [ ] **Step 5: Implement `WebRTCPeer`.** `connect` builds an `RTCPeerConnectionFactory` (shared static), an `RTCPeerConnection` with `iceServers` mapped to `RTCIceServer`; offerer calls `dataChannel(forLabel:configuration:)` for the four labels **before** `offer(for:)`, sets local description, sends `.offer`; answerer sets remote, `answer(for:)`, sends `.answer`; both send each `RTCIceCandidate` from the delegate as `.candidate` envelopes and add inbound ones. `send` waits while the channel's `bufferedAmount` exceeds 1 MiB (poll via delegate's `didChangeBufferedAmount`) — backpressure, not unbounded buffering. Inbound `RTCDataBuffer`s route to per-channel `AsyncStream` continuations. `close()` sends `.bye`, closes channels + connection, finishes streams. Delegate callbacks arrive on libwebrtc threads — hop to the actor with `Task { await self… }`.

- [ ] **Step 6: Run gated + ungated** — `ANGLESITE_P2P_E2E=1 swift test --filter WebRTCPeerTests` → PASS; plain `swift test --filter AnglesiteP2PTests` → gated suite skips cleanly.

- [ ] **Step 7: Commit** — `git commit -m "feat(#1208): WebRTCPeer — libwebrtc P2PConnection conformer"`

---

### Task 8: Two-process E2E — `anglesite-p2p-demo` + exit-criterion test

**Files:**
- Create: `Sources/anglesite-p2p-demo/main.swift`
- Test: `Tests/AnglesiteP2PTests/TwoProcessE2ETests.swift`

**Interfaces:**
- Consumes: everything above.
- Produces: `anglesite-p2p-demo host <signal-dir> <site-root>` (serves the site dir over the fetch bridge + an MCP initialize-stub handler, runs until `bye`/EOF) and `anglesite-p2p-demo client <signal-dir>` (connects, fetches `/index.html`, checks the body is non-empty and status 200, performs one MCP `initialize` round-trip, prints `P2P-E2E-OK`, exits 0; any failure prints the error and exits 1).

- [ ] **Step 1: Implement `main.swift`**

```swift
import Foundation
import AnglesiteCore
import AnglesiteP2P

// Two-process E2E driver for the Anywhere-runtime transport core (#1208 P0).
// Host: answerer + FetchBridgeServer(DirectoryHTTPExecutor) + MCP stub responder.
// Client: offerer + FetchBridgeClient + WebRTCTransport; prints P2P-E2E-OK on success.
let args = CommandLine.arguments
func die(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
guard args.count >= 3 else { die("usage: anglesite-p2p-demo host <signal-dir> <site-root> | client <signal-dir>") }
let signalDir = URL(fileURLWithPath: args[2], isDirectory: true)

switch args[1] {
case "host":
    guard args.count == 4 else { die("host needs <site-root>") }
    let peer = try await WebRTCPeer.connect(role: .answerer, signaling: FileSignalingChannel(directory: signalDir, sender: "host"))
    let bridge = FetchBridgeServer(connection: peer, executor: DirectoryHTTPExecutor(root: URL(fileURLWithPath: args[3], isDirectory: true)))
    let responder = MCPChannelResponder(connection: peer) { message in
        guard case let .object(fields) = message, let id = fields["id"] else { return nil }
        return .object(["jsonrpc": .string("2.0"), "id": id,
                        "result": .object(["serverInfo": .object(["name": .string("anglesite-p2p-demo")])])])
    }
    async let a: Void = bridge.run()
    async let b: Void = responder.run()
    _ = await (a, b)
case "client":
    let peer = try await WebRTCPeer.connect(role: .offerer, signaling: FileSignalingChannel(directory: signalDir, sender: "client"))
    let client = FetchBridgeClient(connection: peer)
    let (head, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/index.html", headers: [:]))
    guard head.status == 200 else { die("page fetch failed: \(head.status)") }
    var page = Data()
    for try await chunk in body { page.append(chunk) }
    guard !page.isEmpty else { die("empty page body") }
    let transport = WebRTCTransport(connection: peer)
    try await transport.send(.object(["jsonrpc": .string("2.0"), "id": .number(1), "method": .string("initialize")]))
    var it = transport.inbound().makeAsyncIterator()
    guard await it.next() != nil else { die("no MCP reply") }
    print("P2P-E2E-OK")
    await peer.close()
default:
    die("unknown subcommand \(args[1])")
}
```

(Same caveat as Task 4: match the real `JSONValue` case spellings. Top-level `await` requires the executable's main file to be `main.swift` with Swift's async main support — if the toolchain rejects top-level `await` here, wrap in `@main struct Demo { static func main() async throws { … } }` in `Demo.swift` instead.)

- [ ] **Step 2: Write the gated two-process test** — spawns the built demo binary twice via `Foundation.Process` (test code, not app code — the `ProcessSupervisor` rule governs the app; existing e2e suites spawn node the same way). Locate the binary next to the test bundle's build products (`Bundle(for:)`-free approach: `URL(fileURLWithPath: CommandLine.arguments[0])` up to the build dir, then `anglesite-p2p-demo`). Start host with a temp site dir containing `index.html`, then client; assert client stdout contains `P2P-E2E-OK` and exit code 0 within a 60 s timeout; terminate the host. Suite trait: `.enabled(if: ProcessInfo.processInfo.environment["ANGLESITE_P2P_E2E"] == "1")`.

- [ ] **Step 3: Run the exit criterion** — `ANGLESITE_P2P_E2E=1 swift test --filter TwoProcessE2ETests` → PASS. This is the epic's P0 exit: **a page and an MCP round-trip cross the bridge between two Mac processes with file signaling.**

- [ ] **Step 4: Full-suite check** — `swift test --package-path .` (serialize with any other agent's runs — FM suites contend) → all green, gated suites skip without the env vars.

- [ ] **Step 5: Commit** — `git commit -m "feat(#1208): two-process P2P E2E demo + exit-criterion test"`

---

### Task 9: PR

- [ ] **Step 1:** Re-read `CONTRIBUTING.md` ▸ "Commits and pull requests"; build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (**Summary**, **Paired PR check** — self-contained, no MCP schema change, so no paired PR — and **Test plan** listing the commands actually run, including the `ANGLESITE_P2P_E2E=1` lanes). Reference `Part of #1208` (P0 is a checklist item on the epic, not closed by this PR — tick its box after merge).
- [ ] **Step 2:** Push and `gh pr create`; verify CI (Linux leg must stay green — it never sees the Darwin-gated targets).

## Self-Review Notes

- Spec coverage: all four channels (Tasks 2/4/5/6), `MCPTransport` seam (Task 4), HTTP faithfulness incl. redirect passthrough + hop-by-hop stripping + streaming (Task 5), loopback unit strategy + gated E2E strategy (Tasks 3/7/8), file signaling + `SignalingChannel` seam for P2 (Task 7), exit criterion (Task 8). Pairing/TURN/CloudKit/scheme-handler intentionally deferred per the spec's phasing.
- Known verification points flagged inline: exact `JSONValue` case spellings (Tasks 4/8) and top-level-await form (Task 8) must be checked against the checkout, not assumed.
