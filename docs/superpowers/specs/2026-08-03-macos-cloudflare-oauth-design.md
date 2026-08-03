# macOS Cloudflare OAuth onboarding — design

**Date:** 2026-08-03
**Issue:** [#1204](https://github.com/Anglesite/Anglesite/issues/1204), spun out of #1195's
brainstorming. Sibling to the iOS work (#889/#890/#891, epic #71), documented in
[`2026-07-21-ios-cloudflare-onboarding-design.md`](2026-07-21-ios-cloudflare-onboarding-design.md).
**Status:** Approved design; ready for implementation planning.

## Scope

macOS's current "no Cloudflare token" flow is `CloudflareTokenPromptView`: a guided sheet that
opens `AnglesiteTokenTemplate.createTokenURL` (a dashboard deep link pre-filling one custom API
token covering all 17 permission groups the app uses across deploy, harden, and the integration
wizards) and asks the user to paste the resulting token. `DeployModel` verifies and persists it via
`TokenOnboarding`.

This is a fundamentally different use case from iOS's OAuth token: iOS's token only authenticates
the user to *their own* Sandbox Control Worker's custom routes (the Worker itself holds whatever
credentials it needs internally), so a minimal "User Details (Read)" scope was enough. macOS's
token is used as a direct bearer credential against **Cloudflare's own management API** — deploying
Workers, editing DNS/WAF/Zaraz/Registrar records, reading analytics — exactly the same permission
surface the pasted custom token covers today. That's why this design (unlike iOS's) requests the
full permission-group scope list rather than a minimal one.

This slice replaces `CloudflareTokenPromptView` outright with a "Sign in with Cloudflare" OAuth
flow, reusing the already-portable `CloudflareOAuthClient` (`AnglesiteCore`, built for iOS in
#890, not iOS-gated). It is **app-side only**: it does not build the callback Worker (tracked at
#891, still open in the sibling repo) — it specifies what the macOS app needs from it (an added
Team ID entry) as a manual follow-up action, same division of labor the iOS doc used.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Paste flow (`CloudflareTokenPromptView`) | Replaced outright, not kept as a fallback | One sign-in path is simpler to support; existing pasted tokens keep working (see Migration) so nothing breaks on upgrade |
| OAuth scope | Full `AnglesiteTokenTemplate.permissionGroups` list, space-joined into the `scope` param | Cloudflare's self-managed OAuth scope names equal API-token permission-group names (confirmed in `CloudflareOAuthClient`'s doc comment) — no separate scope vocabulary to design |
| OAuth client registration | Widen the existing registered client (`e6705eb5f46254ecae0641b2e4da0ee2`), don't register a second one | One client to maintain in the Cloudflare dashboard; iOS keeps requesting its own narrower scope at authorize time from the same client |
| Token lifetime | Add refresh-token support to `OAuthToken`/`CloudflareOAuthClient` | Deploy is a workflow used often; forcing a browser re-auth on every expiry (typically ~1hr) would be disruptive. Contingency: if the token endpoint turns out not to return a `refresh_token` (unverified today), fall back to a silent non-ephemeral `ASWebAuthenticationSession` re-authorize instead of building a refresh flow that has nothing to call |
| Migration | Existing pasted tokens keep working until invalid; only re-onboarding shows OAuth | No forced re-auth wave; matches this repo's precedent of not forcing migrations on existing local state (e.g. the `~/Sites/` → iCloud non-migration decision) |
| Presentation | `ASWebAuthenticationSession` + a new `NSObject`-based `ASWebAuthenticationPresentationContextProviding` type resolving the anchor `NSWindow` | Standard macOS pattern; no open question analogous to iOS's `.https(host:path:)` SwiftUI-overload uncertainty |

## Components

### 1. `OAuthToken` (AnglesiteCore, extend)

Add `refreshToken: String?` alongside the existing `accessToken`/`tokenType`/`expiresIn`, decoded
from the token endpoint's `refresh_token` field when present (optional — some grants may not
return one, e.g. if Cloudflare doesn't issue refresh tokens for this client type; that's the
contingency case in the table above).

### 2. `CloudflareOAuthClient` (AnglesiteCore, extend)

Add `refresh(refreshToken: String, tokenEndpoint: URL) async throws -> OAuthToken`. A refresh
happens well after the original authorize/exchange round trip, so `CloudflareOAuthRequest`'s
`codeVerifier`/`state` (single-use, tied to one authorize attempt) are no longer relevant — only
`tokenEndpoint` needs to persist across the token's lifetime, so the caller (`TokenOnboarding`)
stores it alongside the refresh token itself rather than the whole `CloudflareOAuthRequest`. Posts
`grant_type=refresh_token`, `refresh_token`, `client_id` to the token endpoint; same error mapping
as `exchange` (`tokenExchangeFailed` on non-2xx or bad decode).

No changes to `makeAuthorizationRequest`, `authorizationCode(from:matching:)`, or `exchange` —
those are shared with iOS unchanged.

### 3. `AnglesiteTokenTemplate` (AnglesiteCore, no code change, new consumer)

`permissionGroups` becomes the source of the OAuth `scope` string
(`permissionGroups.map(\.key).joined(separator: " ")` or similar) as well as the existing
`createTokenURL` pre-fill — one list, two consumers. No changes to this type itself.

### 4. `CloudflareOAuthPresentationContext` (AnglesiteApp, new)

A small `NSObject` conforming `ASWebAuthenticationPresentationContextProviding`, returning the
relevant `NSWindow` as the presentation anchor (`presentationAnchor(for:)`). No state, no logic
beyond resolving the window — the macOS analogue of what iOS's `.https(host:path:)` matcher or
`UIWindow`-based provider would do, but without iOS's open question about which SwiftUI API
exposes it: macOS uses the `AuthenticationServices` API directly.

### 5. `TokenOnboarding` (AnglesiteCore, change token source)

Keeps its existing verify → persist → flash → cancellation-recheck → proceed ordering. What
changes is where the token comes from:

- New entry point wraps `CloudflareOAuthClient.makeAuthorizationRequest()` →
  `ASWebAuthenticationSession` (via `CloudflareOAuthPresentationContext`) → `authorizationCode(from:matching:)`
  → `exchange(code:for:)`, producing an `OAuthToken` in place of a pasted string.
- Before a deploy attempt, if the stored token is expired (via `expiresIn` + a recorded issue
  timestamp), `TokenOnboarding` calls `refresh(_:for:)` first; a refresh failure falls through to
  a fresh interactive `makeAuthorizationRequest()` rather than surfacing an error (an expired
  refresh token is an expected, recoverable case, not a bug).
- Verification against the resulting access token reuses whatever `TokenOnboarding` already
  calls to confirm a token works (unchanged).

### 6. `CloudflareTokenPromptView` (AnglesiteApp, deleted) → new sign-in view

Replaced by a minimal view: a "Sign in with Cloudflare" button driving the new `TokenOnboarding`
entry point, with the same `.idle/.checking/.connected/.failed(message:)` states
`CloudflareTokenPromptView` already had a version of. No dashboard link, no `SecureField` paste —
those UI elements are removed along with the type.

### 7. `PlatformSecretStore` / `KeychainStore` (AnglesiteCore, new keys)

New account keys `cloudflareOAuthAccessToken` and `cloudflareOAuthRefreshToken` (same
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` policy as every existing slot), mirroring the
existing two-key `indieAuthAccessToken`/`indieAuthDPoPKey` pattern rather than inventing a new
storage shape. Expiry and the token endpoint URL (both non-secret) are stored outside Keychain,
alongside other non-secret settings state — same split `SiteConfigStore` uses elsewhere; the token
endpoint is what `refresh(refreshToken:tokenEndpoint:)` needs and is cheap to keep since it's
already resolved once at sign-in time (§2). The legacy single `cloudflareToken` key is **not
deleted**; see Migration.

### 8. `DeployModel.hasUsableToken()` (AnglesiteApp, extend)

Gains a third source, checked in this order:

1. Env var `CLOUDFLARE_API_TOKEN` — unchanged, dev/CI escape hatch, not user-facing UI.
2. OAuth Keychain pair, refreshing if expired (see §5).
3. Legacy pasted-token Keychain key, if still present and valid — read-only path, never
   re-populated by any UI once `CloudflareTokenPromptView` is gone.

### 9. macOS entitlements (`Resources/Anglesite*.entitlements`, `project.yml`)

Add `com.apple.developer.associated-domains = ["webcredentials:auth.anglesite.dwk.io"]` to the
Release entitlements file and whichever Debug entitlements variant `project.yml` selects
(`ANGLESITE_DEBUG_ENTITLEMENTS`). Unlike iOS's ad-hoc-Debug-signing risk (flagged unresolved in the
iOS doc), macOS ships MAS-only (`ANGLESITE_MAS`) with per-window security-scoped bookmarks already
in place, so provisioning is expected to be more consistent — but this is still unverified until a
real signed build is tested against the live Associated Domains handoff (see Testing).

## Data flow

- **Sign in:** tap "Sign in with Cloudflare" → `CloudflareOAuthClient.makeAuthorizationRequest()`
  (discovery → PKCE) → `ASWebAuthenticationSession` presents `authorizeURL`, anchored via
  `CloudflareOAuthPresentationContext` → Cloudflare authorization → redirect to
  `https://auth.anglesite.dwk.io/oauth-callback`, intercepted by the OS via Associated Domains (or
  the callback Worker's fallback page renders, per #891) → `authorizationCode(from:matching:)`
  validates `state` → `exchange(code:for:)` → `OAuthToken` → Keychain (§7) → `TokenOnboarding`'s
  existing flash/proceed sequence.
- **Deploy attempt with a stored, expired OAuth token:** `refresh(_:for:)` → success updates the
  stored token silently; failure clears it and falls back to a fresh interactive sign-in.
- **Deploy attempt with a legacy pasted token still present:** used as-is, unchanged from today —
  no OAuth call happens at all.

## Error handling & edge cases

- OAuth cancel/deny (`ASWebAuthenticationSessionError.canceledLogin`, `CloudflareOAuthError.callbackDenied`) →
  no error banner, same as a dismissed paste sheet today.
- `CloudflareOAuthError.stateMismatch` → hard fail, discard, generic "connection attempt failed" —
  never silently accepted (unchanged from the existing type's behavior).
- Discovery/token-endpoint network failure (`discoveryUnavailable`, `tokenExchangeFailed`) →
  surfaced inline, same treatment `CloudflareTokenPromptView`'s failed-verify state had.
- Refresh failure → silent fallback to full re-auth (§5), not surfaced as an error — an expired or
  revoked refresh token is expected, recoverable behavior.
- A cancelled sign-in mid-flow must not persist a partial token — same ordering guarantee
  `TokenOnboarding` already provides today (verify happens before persist).

## Testing

- `CloudflareOAuthClientTests` (`AnglesiteCoreTests`) — extend with `refresh(_:for:)` request
  shape and error-mapping tests, against the existing injected `Transport` seam. No live network.
- `TokenOnboardingTests` — extend for: expired-token-refreshes-successfully,
  expired-token-refresh-fails-falls-back-to-reauth, env-var-present-skips-OAuth,
  legacy-pasted-token-still-honored. All via fakes, same style as the existing suite.
- `KeychainStore`/`PlatformSecretStore` tests — extend for the new two-key pair, mirroring the
  existing IndieAuth pair tests.
- `CloudflareOAuthPresentationContext` — thin enough (resolves one `NSWindow`) that it's treated
  as a manual/smoke-test item rather than unit-tested, flagged explicitly rather than silently
  skipped.
- **Not covered by automated tests:** the live Associated Domains handoff against a real signed
  build, and whether Cloudflare's token endpoint actually returns `refresh_token` for this client
  — both need a manual verification pass during implementation (see Open items).

## Open items (verify during implementation; non-blocking)

- Whether Cloudflare's token endpoint returns a `refresh_token` for this client/grant at all. If
  not, fall back to a silent non-ephemeral `ASWebAuthenticationSession` re-authorize instead of a
  refresh-token grant that has nothing to call.
- Whether Cloudflare's self-managed OAuth actually accepts the full 17-key permission-group list
  as a space-separated `scope` value in one request, or whether some of those permission groups
  aren't exposed as OAuth scopes at all (only as classic API-token permission groups) — verify
  against the widened client registration before assuming full parity with the pasted-token flow.
- Exact Associated Domains behavior under MAS provisioning — expected to be more reliable than
  iOS's ad-hoc-Debug case, but not yet verified against a real signed build.

## Manual / out-of-band follow-ups (not app code)

1. Widen the registered OAuth client's (`e6705eb5f46254ecae0641b2e4da0ee2`) allowed scopes in the
   Cloudflare dashboard to include the full `AnglesiteTokenTemplate.permissionGroups` list.
2. Add the macOS `Anglesite` target's Team ID to the callback Worker's
   `apple-app-site-association` (`Workers/anglesite-oauth-callback`, sibling repo, tracked at
   #891 — not yet built).

## Epic touchpoints

- **#1204** — this design.
- **#1195** — the brainstorming this was spun out of (Registrar write scope requirement).
- **iOS design** (`2026-07-21-ios-cloudflare-onboarding-design.md`) — sibling flow; shares
  `CloudflareOAuthClient`/`OAuthToken` but differs in scope size and token *purpose* (macOS calls
  Cloudflare's management API directly; iOS authenticates to its own Control Worker).
- **#890/#891** — the OAuth client and callback Worker this design consumes and extends.
- Implementation is expected to split into separate tracked issues (mirroring #889/#890/#891's
  breakdown) rather than one large PR — decided at plan-writing time, not here.
