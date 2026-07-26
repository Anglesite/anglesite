# DPoP-nonce challenge/retry for `SiteIndieAuthClient`/`MicrosubClient`

Issue: [#936](https://github.com/Anglesite/Anglesite-app/issues/936)

## Problem

`SiteIndieAuthClient.exchange(code:for:dpopKeyPair:)` signs one DPoP proof and POSTs once, with
no handling for RFC 9449 §8's nonce challenge/response: a server rejecting with `use_dpop_nonce`
(plus a `DPoP-Nonce` response header) and expecting the client to retry with that nonce echoed
into the next proof's `nonce` claim. `MicrosubClient`'s request path has the same gap — one
proof per request, no nonce retry.

This isn't a live bug today: `@dwk/indieauth`'s token endpoint and `@dwk/microsub`'s `authorize`
never pass `expectedNonce` to `@dwk/dpop`'s `verifyDpopProof`, so neither server issues a nonce
challenge yet (confirmed 2026-07-24 against `@dwk/dpop`'s `src/index.ts`, which already supports
`expectedNonce`/`nonce_mismatch` as a first-class input — RFC 9449 §9 recommends turning it on as
a replay defense). If/when a future `@dwk/indieauth` or `@dwk/microsub` release turns it on,
every sign-in and every Microsub request would start failing with no path to recover without an
app update. This work closes that gap defensively, ahead of the server-side change.

## Wire contract (RFC 9449 §8, confirmed against `@dwk/dpop`)

- Challenge: HTTP 400 or 401, JSON body `{"error": "use_dpop_nonce", ...}`, response header
  `DPoP-Nonce: <nonce>`.
- Retry: a fresh DPoP proof whose `nonce` claim equals the echoed value, same request otherwise.
- Cap at one retry — RFC 9449 §8's expected flow is a single challenge/response round trip, not
  a loop.

## Design

### 1. `DPoPKeyPair.proof(htm:htu:accessToken:nonce:)`

Add an optional `nonce: String? = nil` parameter. When present, embed it as the JWT payload's
`nonce` claim (RFC 9449 §4.2). Defaults to `nil`, so every existing call site is unaffected.

### 2. `DPoPNonceChallenge` (new, in `DPoPKeyPair.swift`)

A pure function shared by both clients:

```swift
enum DPoPNonceChallenge {
    /// Returns the challenge nonce if `data`/`http` is an RFC 9449 §8 DPoP-nonce challenge,
    /// else nil.
    static func nonce(in data: Data, response http: HTTPURLResponse) -> String?
}
```

Matches only when **all** of: status is 400 or 401, the `DPoP-Nonce` response header is present
and non-empty, and the JSON body decodes with `"error" == "use_dpop_nonce"`. Any other 4xx/5xx
(including a plain `invalid_dpop_proof` with no nonce header) falls through to each client's
existing failure handling unchanged.

### 3. `SiteIndieAuthClient.exchange`

Build the token-endpoint POST request as a closure over the fixed body, taking `nonce: String?`
so it can be re-signed. Send once with `nonce: nil`. If `DPoPNonceChallenge.nonce(in:response:)`
matches, rebuild and send exactly once more with the echoed nonce. Either way, fall through to
the existing status-code guard and `SiteIndieAuthToken` decode — a second challenge (or any other
failure) surfaces as today's `.tokenExchangeFailed`, no further retries.

### 4. `MicrosubClient`

`get`/`post` currently build a request, call `authorize(_:method:)` to attach `Authorization`/
`DPoP` headers, then `send(_:)`. Introduce one shared authorized-send path both route through:

```swift
private func sendAuthorized<Response: Decodable>(_ request: URLRequest, method: String) async throws -> Response
```

It signs+sends with `nonce: nil`; on a matching `DPoPNonceChallenge`, re-signs the *original*
request (same method/body/URL) with the echoed nonce and sends once more; then applies the
existing 2xx-status guard and JSON decode. `authorize(_:method:)` gains the same `nonce: String?
= nil` passthrough to `DPoPKeyPair.proof`.

Every Microsub action (`listChannels`, `createChannel`, `follow`, `unfollow`, `timeline`,
`markRead`) gets the retry for free since they all funnel through `get`/`post`.

## Alternative considered

**Cache the nonce on the client instance** to skip the extra round trip on *future* calls (a
server-issued nonce is often valid for more than one request). Rejected for now: both types are
immutable `Sendable` structs with no mutable state today; this is a low-frequency interactive
flow (sign-in, timeline polls), not a hot path; and — per "Problem" above — nothing server-side
issues nonces yet, so there's no real cost to optimize away. The stateless per-request retry
matches the issue's literal "cap at one retry" and the existing per-request-proof pattern
(`jti`/`iat` are already freshly minted per call). Revisit if/when nonce enforcement actually
ships and proves chatty in practice.

## Testing

Against each type's existing injected `Transport` seam, no real networking:

- `DPoPKeyPairTests`: `proof(nonce:)` embeds the `nonce` claim when passed, omits it when not.
- `SiteIndieAuthClientTests`: fake transport returns a nonce challenge on the first call and a
  valid token on the second — assert exactly 2 transport calls, the token decodes, and the
  second request's DPoP proof payload carries the echoed `nonce` claim. A second case: the
  challenge repeats on every call — assert exactly 2 transport calls total (no further retries)
  and `.tokenExchangeFailed`.
- `MicrosubClientTests`: same two cases against `listChannels` (GET) and `follow` (POST) — one
  representative action of each HTTP method is enough since both route through the same
  `sendAuthorized` path.

## Cross-repo note

Not a paired-PR change — `@dwk/dpop` already supports `expectedNonce` and needs no change here;
this PR only makes the app-side clients resilient to a future `@dwk/indieauth`/`@dwk/microsub`
release turning nonce enforcement on. Worth a follow-up ping to `davidwkeith/workers` per the
issue's cross-repo note, but that's a coordination task, not a code dependency for this PR.
