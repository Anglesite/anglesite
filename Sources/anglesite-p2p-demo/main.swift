import Foundation
import AnglesiteCore
import AnglesiteP2P

// Two-process E2E driver for the Anywhere-runtime transport core (#1208 P0). This is the CLI
// that `TwoProcessE2ETests` spawns twice (a host process and a client process) to prove a page
// fetch and an MCP round-trip actually cross the bridge between two real Mac processes over file
// signaling — the epic's P0 exit criterion. It is a demo/test harness binary, not app code, so it
// prints straight to stdout/stderr rather than going through `os.Logger` or `ProcessSupervisor`.
//
// Host: answerer + FetchBridgeServer(DirectoryHTTPExecutor) + MCP stub responder. Runs until the
// client's `close()` sends `.bye` over the shared connection, which unwinds both `run()` loops.
// Client: offerer + FetchBridgeClient + WebRTCTransport; on success prints `P2P-E2E-OK` and exits
// 0. Any failure prints the error to stderr and exits 1.
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
    try await transport.send(.object(["jsonrpc": .string("2.0"), "id": .int(1), "method": .string("initialize")]))
    var it = transport.inbound().makeAsyncIterator()
    guard await it.next() != nil else { die("no MCP reply") }
    await transport.close()

    // Beyond the literal brief: don't just trust that closing tears down cleanly — prove it.
    // Close the peer, then confirm a *new* bridge request over it fails promptly rather than
    // hanging, racing it against a bounded timeout so a regression here fails the demo loudly
    // instead of wedging the process.
    await peer.close()
    let closedRequestFailedPromptly = await withTaskGroup(of: Bool.self) { group -> Bool in
        group.addTask {
            do {
                _ = try await client.perform(BridgeRequestHead(method: "GET", path: "/index.html", headers: [:]))
                return false // unexpectedly succeeded against a closed connection
            } catch {
                return true // failed, as expected
            }
        }
        group.addTask {
            try? await Task.sleep(for: .seconds(5))
            return false // neither succeeded nor failed within the bound — treat as a hang
        }
        guard let first = await group.next() else { return false }
        group.cancelAll()
        return first
    }
    guard closedRequestFailedPromptly else {
        die("post-close bridge request did not fail promptly (hung or unexpectedly succeeded)")
    }

    print("P2P-E2E-OK")

default:
    die("unknown subcommand \(args[1])")
}
