# Anywhere runtime — WebRTC P2P remote access to the Mac-hosted site runtime

**Status:** Approved design (owner-reviewed 2026-08-03) — umbrella spec; each phase gets its own plan
**Relates to:** #71 / #342 (iOS thin client / iOS-iPadOS epic — re-based by this spec), #66 (Cloudflare remote runtime — stays deferred), #67 (remote preview security), #531 (quick-capture posting), #589 (UTM rig), `docs/specs/2026-07-09-lan-site-runtime-design.md` (LAN precedent for the control-client seam)
**Inspiration:** BitBang (<https://github.com/richlegrand/bitbang>) — zero-config remote terminals over WebRTC: a trustless signaling server brokers the handshake, then steps aside; everything after is E2E-encrypted P2P.

## Problem

Mobile website development in Anglesite is currently gated on the Cloudflare remote runtime (#66): the iOS thin client (#71) was scoped as "remote runtime only," and #66 is blocked on a Workers Paid plan. Meanwhile every Anglesite owner already operates a perfectly good site runtime — the Apple Containerization container on their own Mac. The only missing piece is reach: the phone can't get to it from outside the LAN without port forwarding, VPNs, or tunnels.

WebRTC solves exactly that. With a rendezvous channel for the handshake and STUN/TURN for NAT traversal, the phone and the Mac establish a direct, E2E-encrypted connection from anywhere — no cloud runtime, no standing server, no open ports on the Mac, no billing dependency.

**This spec re-bases the iOS thin client (#71, tracked under epic #342) onto the owner's own Mac.** #66 stays deferred; if it ever ships, it becomes the "Mac is offline" fallback, not the mainline.

## Owner-approved scope decisions (2026-08-03)

1. **Client surface:** native iOS/iPadOS app (epic #342), per the platform-UX standard. No browser client.
2. **Mac availability model:** a background helper (login item) serves sessions even when the main app is closed, booting the container on demand.
3. **Signaling:** CloudKit private database — no server, no accounts beyond the shared Apple ID.
4. **v1 capability:** full editing **including publish** — preview, content edit journeys, quick capture (#531), and deploy triggered from the phone with the gate staying Mac-side.
5. **NAT fallback:** Cloudflare Realtime TURN, minted from the owner's already-onboarded Cloudflare token.
6. **Transport architecture:** protocol-aware bridge (approach B below), not a generic port tunnel.
7. **Dependency:** libwebrtc (prebuilt Swift package) is approved. There is no Apple-native WebRTC/ICE API; hand-rolling NAT traversal over Network.framework was considered and rejected as a research project.

## Approaches considered for the transport

- **A. Generic port tunnel (most BitBang-like).** Mux'd TCP-over-data-channel; iOS runs a loopback proxy so WKWebView and the HTTP MCP transport hit `localhost`. Everything tunnels automatically (incl. HMR websockets) and `VsockTCPProxy`'s splice machinery is reusable, but iOS loopback listeners are fiddly (backgrounding, ATS, port collisions) and it tunnels HTTP framing we don't need.
- **B. Protocol-aware bridge (chosen).** MCP rides a data channel natively via the `MCPTransport` seam; preview loads through a `WKURLSchemeHandler` backed by fetch-over-data-channel; HMR gets a dedicated relay channel. No listeners on iOS, everything in-process, every piece lands on an existing seam. Cost: the fetch bridge must faithfully reproduce HTTP semantics (streaming, redirects, headers). Note on redirects: `WKURLSchemeHandler` has no built-in 3xx following, so the bridge passes redirects through verbatim and the **P4 scheme handler must mechanize them explicitly** (follow internally within the bridge, or synthesize the navigation) — a P4-plan requirement, not something WebKit provides for free.
- **C. Hybrid (B for MCP, A for preview).** Rejected: ships two transport mechanisms.

## Architecture

Five components:

### 1. `AnglesiteP2P` (new SwiftPM target, shared macOS/iOS)

Wraps libwebrtc behind a small Swift API. Four logical data channels per session:

- **`mcp`** — MCP JSON-RPC frames. On the phone, a new `WebRTCTransport: MCPTransport` conformer; on the Mac, the helper replays frames against the container's MCP endpoint over loopback HTTP. No HTTP anywhere on the phone.
- **`http`** — the fetch bridge: request-id + method/URL/headers/body up; status/headers/streamed body chunks down. The helper replays requests against the container's dev-server port.
- **`hmr`** — relays the Astro dev server's HMR websocket so live-reload works on the phone.
- **`control`** — heartbeat, session lifecycle, deploy request/progress events.

### 2. Mac helper (`Anglesite Remote.app`, LSUIElement)

Registered as a login item via `SMAppService.agent`. It is a real (faceless) app rather than a bare LaunchAgent binary **specifically so it can receive CloudKit push** — bare agents can't register for remote notifications, which would degrade connect latency to CloudKit polling. The helper owns the signaling listener, the WebRTC endpoint, on-demand container boot, and the deploy path.

The helper has **no standing listening ports** — it only dials out. (WebRTC's ICE negotiation still binds ephemeral UDP ports for hole-punching while a session is being established; what the design eliminates is any *stable inbound service*.) That is a materially better security posture than a port-forwarding or tunnel design: there is no always-on endpoint on the Mac to scan, probe, or brute-force.

Introducing the helper **amends the "`Anglesite` is the only app target" invariant** documented in `CLAUDE.md`/`AGENTS.md` ▸ "Build target": P1 adds a second, embedded app bundle. The P1 plan must update that document alongside the code rather than leaving the two silently disagreeing.

**File access.** Sites in the iCloud Drive "Anglesite" folder need no grants — both processes carry the ubiquity-container entitlement. For a site stored elsewhere, security-scoped bookmarks are app-scoped, so the main app's grants don't transfer; instead, when the owner enables remote access for such a site, the **helper presents a one-time `NSOpenPanel`** pre-targeted at the `.anglesite` package and saves its own bookmark from the powerbox grant. iCloud sites: zero-prompt; non-iCloud sites: one approval panel at enable time.

### 3. Signaling over CloudKit private DB

SDP offers/answers and trickle-ICE candidates are short-TTL records in the owner's own private database, delivered by `CKSubscription` push. Both devices share the Apple ID; there is no server, no account, no infrastructure, and Apple's transport already encrypts the mailbox. Abstracted behind a **`SignalingChannel` protocol** so tests use a deterministic fake and a future non-Apple client (Android per its platform spec, or Windows/Linux under #571) could ride a tiny Worker instead without touching the transport core.

### 4. iOS app (epic #342)

Gains `P2PSiteRuntime: SiteRuntime`: `start()` drives signaling → connected session → reports a preview URL in a custom scheme (`anglesite-p2p://…`) resolved by a `WKURLSchemeHandler` through the fetch bridge, plus an `MCPClient` connected over `WebRTCTransport`. `PreviewView`'s contract — load whatever URL the runtime reports — is untouched. All edit journeys arrive via the same MCP tools the Mac app uses.

`AnglesiteMobile`'s existing #71 scaffold (`RemoteSessionModel`, the HTTP-only `MCPClient` wiring, `RemoteSandboxSiteRuntime`) is not deleted by this re-base: `P2PSiteRuntime` becomes the mainline runtime the app selects, and the remote-sandbox path stays behind it as the deferred #66 fallback. The P4 plan owns the runtime-selection policy and any pruning of that scaffold.

### 5. Mac-side runtime glue

On session start the helper boots `LocalContainerSiteRuntime` for the requested site and bridges the channels to the container's loopback proxy ports. **One container owner per site, always:** if the main app already has the site open, the helper does not boot a second container — the app publishes its live proxy ports in app-group state and the helper bridges to those instead. The helper links `AnglesiteContainer` and carries the virtualization entitlement.

Multiple paired devices (iPhone + iPad) may hold sessions concurrently: the helper runs one bridge stack per WebRTC session, and each bridge opens its **own loopback HTTP/MCP connections** to the shared container — sessions never multiplex over a single loopback socket. The MCP server serializes edits across sessions exactly as it does for two Mac windows; the P1 plan specifies the helper's session table.

Git remains the source of truth exactly as today (#72): phone edits land in the container working copy via MCP, and commit/push semantics are identical whether the editor was the Mac app or the phone.

## Pairing and security

**Pairing (one-time).** The Mac app's Settings gains an "Anglesite on iPhone/iPad" pane showing a QR code containing the Mac's device ID and a fresh public key. The phone scans it, writes its own device record + public key to the shared CloudKit zone, and both sides **pin** each other's keys. Every subsequent signaling payload (SDP, ICE) is signed with the pinned keys, and the WebRTC DTLS certificate fingerprint is carried inside the signed SDP — so even a compromised iCloud account cannot man-in-the-middle a session. **The QR is the trust root; iCloud is just a mailbox.** The pane lists paired devices with last-connected time and a Revoke button (deletes the device record, drops the pinned key; the helper refuses unknown keys).

**Session auth.** DTLS provides transport encryption and mutual authentication against pinned certificates. `SessionToken` stays `nil` on the MCP connect path — there is nothing a bearer adds inside an already-mutually-authenticated channel. The TURN relay, when used, only ever sees DTLS ciphertext.

**TURN via the owner's Cloudflare account.** The helper holds the already-onboarded Cloudflare token (the deploy credential). At session setup it mints short-lived Cloudflare Realtime TURN credentials and hands them to the phone inside the signed signaling payload. No token onboarded → STUN-only, with an honest failure when P2P is impossible. Relayed bytes bill to the owner's own free-tier allowance — no shared infrastructure, no operator-run relay.

Scope separation: the deploy token's privileges are broader than TURN minting needs, so the **P3 plan must mint TURN credentials from a separately-scoped token** (created during onboarding, alongside the deploy token) — a compromised minting path must not be able to touch deploys. P3 also defines mid-session failure behavior (rate limit, revocation): an established relay path keeps working on its already-issued short-lived credential; only new ICE restarts lose the relay and fall back to STUN-or-fail.

**Publish from the phone.** The phone never deploys. It sends a deploy *request* over `control`; the **Mac** runs the exact existing pipeline — `PreDeployCheck` (the non-bypassable gate, unchanged and unreachable from the phone) then deploy — streaming progress back over `control`. Failure output streams to the phone verbatim (logs are sacred).

## Failure modes

Each maps to owner-comprehensible UI, per the "the app advises; it does not delegate the decision" rule — messages speak about the owner's site and network, never about ICE or SDP.

- **Mac asleep/offline.** The helper writes a lightweight presence heartbeat to CloudKit (~every 15 min + on network change). The phone renders "Your Mac was last reachable at 3:12 PM" instead of spinning. CloudKit push cannot reliably wake a sleeping Mac — the UI is honest about that (Power Nap may help; not promised).
- **P2P unreachable.** ICE failure → automatic TURN retry (when a CF token is present) → clear terminal error naming the likely cause ("this network blocks direct connections").
- **Container boot latency.** The helper boots on demand; `SiteRuntimeState` already streams progress and the phone renders it ("Starting your site…").
- **Both editors live.** One container owner per site (§ Architecture 5); the MCP server serializes edits, same as two Mac windows today.
- **Mid-session drop.** Data channels die → the runtime re-enters `.starting`, the phone auto-reconnects through signaling; in-flight MCP requests fail loudly, never silently.

## Testing

- **`AnglesiteP2P` unit tests** run a loopback WebRTC pair in-process (no network): channel framing, fetch-bridge HTTP faithfulness (streamed bodies, redirects, headers, content types), HMR relay, reconnect behavior.
- **`SignalingChannel` fake** covers all signaling logic deterministically; real CloudKit integration is opt-in (`ANGLESITE_CK_TESTS=1`), matching the container-test pattern.
- **End-to-end:** two processes on one Mac with real libwebrtc + file-based signaling, gated `ANGLESITE_P2P_E2E=1`. The UTM rig (#589) and a real phone cover the NAT-traversal matrix manually.
- **Adversarial pairing tests:** tampered SDP, unknown device key, revoked device — all must refuse.

## Phasing

One spec/plan per phase; each phase lands independently.

| Phase | Deliverable | Exit criterion |
|---|---|---|
| P0 | libwebrtc vendored + `AnglesiteP2P` transport core | A page and an MCP round-trip cross the bridge between two Mac processes with file signaling |
| P1 | Mac helper: login item, on-demand container boot, powerbox grants, app coexistence | A second Mac process edits a site with the main app closed |
| P2 | CloudKit signaling + QR pairing + revocation UI | Two real devices pair and connect across networks |
| P3 | TURN via the owner's CF token | Connection succeeds on a symmetric-NAT network |
| P4 | iOS app v1 (re-based #342): preview + edit journeys | Edit a page from a phone on cellular |
| P5 | Publish from phone | Deploy triggered from the phone; gate + logs Mac-side |

## Non-goals

- No browser/web client — the client is the native iOS app per the platform-UX standard.
- No multi-user collaboration (#399) — one owner, their own devices.
- No relay/tunnel infrastructure operated by the project — TURN rides the owner's own Cloudflare account; signaling rides their iCloud.
- No change to #66's status — the Cloudflare remote runtime stays deferred and is *not* a dependency of any phase here.
