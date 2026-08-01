# Domain registrar and expiration/renewal tracking (#1194)

**Status:** Approved design, not yet implemented.
**Issue:** [#1194](https://github.com/Anglesite/Anglesite/issues/1194)
**Follow-up to:** `docs/superpowers/specs/2026-07-31-publish-time-domain-step-design.md` (#1180) ▸ Follow-ups §1

## Problem

Anglesite doesn't currently know a connected domain's registrar or when it
expires or renews. Cloudflare's own Registrar API (`TokenCapabilities.registrar`,
`CloudflareCapabilityProber`) only covers domains bought *through* Cloudflare —
a domain that stays at its original registrar (the common "I already own a
domain" path added by #1180) needs a separate, registrar-agnostic lookup.

## Goals

- Look up a connected domain's registrar name and expiration date via RDAP
  (the standardized WHOIS successor, RFC 7480/9082/9083/9224) — no API key,
  no Cloudflare token needed.
- Persist the result into `Source/anglesite.json`'s `domain` section so it
  survives across app launches and is visible to anyone reading the file
  directly.
- Surface it somewhere the owner will actually see it, reachable on demand
  (not just once).

## Non-goals

- Renewal reminders/notifications — deserves its own design once the
  underlying data is being tracked (this issue's explicit non-goal).
- Any registrar API integration beyond read-only RDAP lookups — no
  auto-renew, no registrar account linking, no purchase flow (that's
  [#1195](https://github.com/Anglesite/Anglesite/issues/1195), a distinct
  fast-follow with its own billing/ToS constraints).
- Changing `CustomDomainAttachCommand`'s attach logic, `DeployCommand`'s
  pipeline, or the `.notConnected`/`conflict` handling in `DeployDrawerView`
  — this only adds a passive, informational lookup layered on top of the
  domain that's already declared.
- A general "site settings" screen — no such surface exists yet; this reuses
  the existing Connect Domain sheet instead of inventing a new one.

## Design

### 1. RDAP lookup (`AnglesiteCore`)

**`RDAPDomainInfo`** — a small `Equatable, Sendable` struct:

```swift
public struct RDAPDomainInfo: Equatable, Sendable {
    public let registrar: String?
    /// Raw RDAP `eventDate` string (ISO 8601) for the expiration event, unparsed —
    /// consistent with every other value in `DomainConfig.Domain` being a plain string.
    public let expiresAt: String?
}
```

**`RDAPLookupService`** (protocol) / **`RDAPClient`** (production actor) — mirrors
the `DomainOperationsService`/`DomainOperations` shape so `ConnectDomainModel`
tests can inject a fake:

```swift
public protocol RDAPLookupService: Sendable {
    func lookup(hostname: String) async -> RDAPDomainInfo?
}

public actor RDAPClient: RDAPLookupService {
    public init(bootstrapURL: URL = RDAPClient.productionBootstrapURL, session: URLSession = .shared)
    public func lookup(hostname: String) async -> RDAPDomainInfo?
}
```

Two-hop flow inside `lookup(hostname:)`:

1. Fetch IANA's RDAP bootstrap registry (`https://data.iana.org/rdap/dns.json`),
   which maps each TLD to the RDAP base URL(s) that serve it. Disk-cached
   (fetch → cache → fall back to cache → fall back to giving up, matching
   `WorkerCatalogFetcher`'s degrade path) since it's a few hundred KB and
   changes rarely — avoids a 2-hop fetch every time the sheet opens.
2. Take the hostname's TLD, find its RDAP base URL in the bootstrap data, and
   GET `{base}domain/{hostname}`.
3. Parse the response for the `expiration` event's `eventDate` and the
   `registrar`-role entity's `fn` (formatted name) from its jCard
   `vcardArray`.

Both the bootstrap registry (an array of `[tlds, urls]` pairs — an awkward
shape for a normal `Decodable` struct) and the domain record (registrar name
is buried in a jCard array) are parsed with the existing `JSONValue` type
(`MCPClient.swift`), the same tool `DomainConfigStore` already uses for
arbitrary/heterogeneous JSON, rather than new `Decodable` structs.

Every failure mode — unknown TLD, network error, non-2xx response, malformed
JSON, no matching `expiration` event or `registrar` entity — degrades to
`nil`. `lookup(hostname:)` never throws; this is advisory metadata, never a
blocking requirement.

### 2. Persistence

Extend `DomainConfig.Domain` (`Sources/AnglesiteCore/DomainConfig.swift`) with
two new optional fields, matching every other field in this struct:

```swift
public struct Domain: Codable, Equatable, Sendable {
    public var hostname: String?
    public var choice: String?
    public var attach: Bool?
    public var registrar: String?
    public var expiresAt: String?
    // ...
}
```

`DomainConfigStore`'s existing merge-save handles the round trip (including
unknown-key preservation) with no changes needed there.

### 3. Where it surfaces: the Connect Domain sheet

Today, `ConnectDomainModel.openSheet()` (#1180) unconditionally resets to
`.choosing`, even when `anglesite.json` already declares a hostname. That
means there is currently no way to *revisit* a connected domain through this
sheet — which is exactly the gap this feature needs closed, since
registrar/expiration data is only useful if the owner can check back on it
later. This design changes `openSheet()`'s entry behavior:

- If `anglesite.json`'s `domain.hostname` is non-empty **and**
  `domain.choice == "transfer"`, `openSheet()` goes straight to
  `.connected(hostname:)` instead of `.choosing`.
- Otherwise (no domain, or `choice == "buy"`), behavior is unchanged —
  `.choosing`, exactly as #1180 shipped it.

This is the only behavioral change to `ConnectDomainModel` outside of the new
registrar-info state below. Nothing about `chooseBuy()`, `beginTransfer()`,
`submitTransfer()`, `notNow()`, or the actual attach pipeline changes.

**New model state**, alongside `phase` (not folded into the `Phase` enum,
since it's an orthogonal, independently-loading concern):

```swift
enum RegistrarInfoState: Equatable {
    case idle
    case loading
    case available(RDAPDomainInfo)
    case unavailable
}
private(set) var registrarInfo: RegistrarInfoState = .idle
private let rdap: any RDAPLookupService
```

A private `loadRegistrarInfo(hostname:site:)` is called from both places that
land on `.connected`: `submitTransfer()` (a fresh declaration) and the
`openSheet()` branch above (revisiting an existing one). It:

1. Seeds `registrarInfo` from whatever's already cached in `anglesite.json`
   (`.available(...)`) if present, so reopening the sheet shows last-known
   data instantly with no spinner; otherwise `.loading`.
2. Kicks off `rdap.lookup(hostname:)` in the background.
3. On success, updates `registrarInfo = .available(...)` and persists the
   result into `anglesite.json` via `DomainConfigStore` (guarded on the
   loaded config's `domain.hostname` still matching — a stale write can't
   land if the owner has since changed the domain).
4. On failure (`nil` result), only flips to `.unavailable` if `registrarInfo`
   was still `.loading` — a transient failure never regresses a
   previously-good cached value back to nothing.
5. Guards on `phase` still being `.connected(hostname:)` for the same
   hostname before applying the result — a stale task from a dismissed sheet
   or a different hostname is a no-op.

**View** (`ConnectDomainSheetView`): under the existing `.connected` case's
"We'll connect `<hostname>` on your next Publish." message, one or two
secondary-text lines render the registrar/expiration state — e.g.
*"Registrar: Namecheap"* / *"Expires March 15, 2027"* (parsed from the raw
ISO 8601 string for display; falls back to the raw string if parsing fails).
`.loading` shows a small inline spinner + "Looking up registrar info…";
`.idle`/`.unavailable` render nothing extra.

### 4. Testing

- **`RDAPClientTests`** (`AnglesiteCoreTests`): bootstrap-registry TLD
  matching against a fixture `dns.json`; registrar name + expiration date
  extraction from a fixture RDAP domain response; `nil` on an unknown TLD,
  non-2xx response, and malformed JSON; cache fallback when the live
  bootstrap fetch fails.
- **`ConnectDomainModelTests`** additions: `openSheet()` on a site with an
  already-declared transfer hostname lands on `.connected` (not `.choosing`)
  and seeds `registrarInfo` from the cached `anglesite.json` values;
  `openSheet()` on a site with `choice == "buy"` or no domain still lands on
  `.choosing` (regression guard for the existing behavior); a successful
  lookup persists `registrar`/`expiresAt` into `anglesite.json`; a failed
  lookup leaves a previously-cached value in place rather than clearing it.
- **`DomainConfigStoreTests`** or `DomainConfigTests` additions if needed:
  round-trip encode/decode of the two new `Domain` fields, including
  unknown-key preservation when an older-schema file is merged.
- Manual: connect a real domain via the sheet, confirm registrar/expiration
  appear after the lookup completes and persist into `anglesite.json`; quit
  and relaunch the app, reopen the sheet, confirm the cached values appear
  immediately.
