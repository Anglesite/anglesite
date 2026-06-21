# Passkey-backed IndieAuth (`approveAuthorization`)

**Date:** 2026-06-21 · **Issue:** Anglesite/anglesite#363 (problem 2, IndieAuth slice) · **Status:** draft — awaiting review

Successor to `2026-06-09-active-indieweb-design.md` and ADR-0020. Sibling of the
Webmention realignment (shipped, #370). Micropub realignment is a separate spec
(#2c) that depends on this one.

## Problem

`@dwk/indieauth` owns all IndieAuth protocol mechanics (PKCE, code/token
issuance, metadata) but **deliberately delegates authentication and consent to
the deployer**:

```ts
readonly approveAuthorization: ApproveAuthorization; // required config
type ApproveAuthorization =
  (request: AuthorizationRequest, httpRequest: Request)
    => Promise<AuthorizationApproval | Response>;
```

The current template calls `createIndieAuth()` with no config — it cannot even
construct, and there is no mechanism for the owner to prove they are the owner
before a token is minted. We need to build that mechanism. Per brainstorming
(2026-06-21) the chosen mechanism is **passkeys via `@dwk/webauthn`**.

## The contract we build against

`approveAuthorization` returns one of two things:

- **`AuthorizationApproval { me, scopes?, profile? }`** — the library mints a code
  and redirects to the client. Return this only when the current request carries
  a valid owner session **and** a consent token bound to this exact request.
- **`Response`** — the library returns it verbatim, handing us the exchange. This
  is the escape hatch for interactive auth: we return the login/consent page.

This single seam is the whole integration point. Everything else is the page,
the session, and the credential store behind it.

## What `@dwk/webauthn` gives us (and what it doesn't)

`createWebAuthn({ rpId, rpName, origin })` → a `fetch` handler exposing four
ceremony endpoints, backed by a **`WEBAUTHN` Durable Object namespace**
(`WebAuthnObject`, exported by the package) that holds challenge state +
credential records (strongly consistent):

| Endpoint | Purpose |
|---|---|
| `POST /register/options` | issue creation options + challenge |
| `POST /register/verify` | verify attestation, **store the credential** |
| `POST /authenticate/options` | issue request options + challenge |
| `POST /authenticate/verify` | verify assertion, advance the counter |

**Critical gap:** the package is a generic relying party. Its `/register/*`
endpoints will enrol **any** passkey that completes the ceremony — it has no
notion of "the owner." Gating registration so only the owner can enrol the first
credential is **our** responsibility. This is the load-bearing design decision
(see Open decisions §1).

> Caveat to record: `@dwk/webauthn` is self-described "exploratory, lowest
> priority" — the least-mature package in the set. We are putting the owner's
> primary identity on it. Acceptable given the owner controls the whole stack and
> can reset auth (§ Recovery), but worth stating plainly.

## Architecture

Everything mounts under `/auth` in `site-entry.js`, ahead of the `ASSETS`
fallthrough, gated on `env.AUTH_DB` (as today):

```
/auth                       → @dwk/indieauth authorization + token + metadata
/auth/webauthn/register/*    → @dwk/webauthn (owner-only gated, see §1)
/auth/webauthn/authenticate/* → @dwk/webauthn (open — proves possession only)
/auth/register               → owner-only registration page (HTML)
/auth/consent                → POST target: validate session, mint consent token
```

Per-request construction, memoized per `env` (the `webmentionFor` pattern from
#370), because `createIndieAuth`/`createWebAuthn` need config (`baseUrl`,
`rpId`, `origin`) that derives from `env.SITE_URL`.

### The flow

```
1. Client → GET /auth?response_type=code&client_id&redirect_uri&state
            &code_challenge&code_challenge_method=S256&scope&me
2. @dwk/indieauth validates → approveAuthorization(request, httpRequest)
3. our hook reads the signed __anglesite_owner session cookie:
   a. no/expired session →
        return Response: consent page (HTML). The page:
          - runs a WebAuthn assertion via /auth/webauthn/authenticate/*
            (navigator.credentials.get)
          - on success POSTs to /auth/consent with the assertion result +
            the original authorization params
          - /auth/consent verifies the assertion server-side, sets the
            __anglesite_owner session cookie, mints a per-request consent
            token (HMAC over client_id|redirect_uri|scope|nonce|exp), and
            302-redirects back to /auth?...original...&_consent=<token>
   b. session present + valid _consent token for THIS request →
        return AuthorizationApproval { me: SITE_URL, scopes, profile }
   c. session present, no consent token →
        return Response: consent page in "already authenticated" mode
        (skip the passkey step, just show client+scopes, Approve → mint token)
4. @dwk/indieauth mints the code, redirects to redirect_uri with code+state
```

The consent token is what prevents a malicious client from deep-linking
`/auth?...&_consent=…` to skip the visible consent screen: the token is an HMAC
the owner's browser only receives after POSTing through `/auth/consent`, bound to
the specific request parameters and short-lived.

### Session

A signed cookie `__anglesite_owner`, reusing the existing membership HMAC helper
shape in `site-entry.js` (`verifyMembershipCookie`/`crypto.subtle` HMAC-SHA-256).
Payload `{ sub: "owner", iat, exp }`, `exp` ~15 min, `HttpOnly; Secure; SameSite=Lax`.
A fresh passkey assertion re-issues it. Signing key: a new
`INDIEAUTH_SESSION_KEY` secret (or reuse `INDIEAUTH_SIGNING_KEY`).

### Registration

The owner enrols a passkey at `/auth/register` (HTML page driving
`/auth/webauthn/register/*`). Gated owner-only (§1). The page encourages
enrolling **two** credentials (e.g. phone + laptop, or a hardware key) so a lost
device isn't a lockout. Once authenticated, the same page (reached with a valid
session) lets the owner add or remove credentials.

### Backup codes

A second recovery factor alongside multiple passkeys and the redeploy root. At
setup (and regenerable from an authenticated session), the worker generates **10
single-use backup codes**, shows them once for the owner to print/save, and
stores only their hashes. The consent page offers "Use a backup code instead of a
passkey"; a submitted code is hashed and matched against an unused stored hash —
on match it establishes the owner session and the code is marked consumed. A used
or unknown code returns the consent page unchanged (no oracle).

- **Storage:** a small owned table (`owner_backup_codes`: `code_hash`,
  `created_at`, `used_at`) in a dedicated `OWNER_AUTH_DB` D1 binding — *not* in
  `AUTH_DB`, whose schema belongs to `@dwk/indieauth`. Single-use is enforced by
  `used_at`, which a Worker secret could not provide (secrets are read-only at
  runtime).
- **Hashing:** SHA-256 of the code (codes are high-entropy, so a fast hash is
  fine); compare in constant time.
- **Rate limit:** cap backup-code attempts per session/IP to blunt guessing,
  even against high-entropy codes.

## Bindings & wrangler

| Binding | Type | Source |
|---|---|---|
| `AUTH_DB` | D1 | already declared (indieauth codes/tokens) |
| `WEBAUTHN` | **Durable Object namespace** → `WebAuthnObject` | **new** |
| `SITE_URL` | var | already added (#370); also drives `rpId`/`origin` |
| `INDIEAUTH_SIGNING_KEY` | secret | already (token signing) |
| `INDIEAUTH_SESSION_KEY` | secret | **new** (owner session cookie) — or reuse above |
| `INDIEWEB_REG_TOKEN` | secret | **new** (registration bootstrap, §1) |
| `OWNER_AUTH_DB` | D1 | **new** (single-use backup-code hashes) |

The `WEBAUTHN` DO is the **first Durable Object in the Anglesite template**. It
needs a `durable_objects.bindings` entry **and** a `migrations` block in
`wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "WEBAUTHN", "class_name": "WebAuthnObject" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["WebAuthnObject"] }]
```

`site-entry.js` must re-export the class: `export { WebAuthnObject } from "@dwk/webauthn";`.
SQLite-backed Durable Objects are available on the Workers **free** plan, so this
adds no cost. (Confirm at build time against the current Cloudflare limits.)

## Resolved decisions

1. **Registration bootstrap — how does the owner enrol the *first* passkey so a
   stranger can't claim the identity?** **Resolved:** a one-time
   `INDIEWEB_REG_TOKEN` secret the skill generates and shows the owner once as a
   setup link (`/auth/register?token=…`). `/auth/webauthn/register/*` is gated on
   *either* that token *or* a valid owner session (for adding later credentials).
   After the first credential exists, the bare-token path can be disabled (the
   skill rotates/clears the token). Alternatives considered: "first registration
   wins in a time window" (racy — a bot could win; rejected); GitHub/Cloudflare
   OAuth as the bootstrap root (heavier; the token *is* effectively that root
   since only the deployer can set the secret).

2. **Recovery if all passkeys are lost.** **Resolved:** three layers — encourage
   ≥2 passkeys at setup; **printable single-use backup codes** (see § Backup
   codes); and the redeploy root (`/anglesite:indieweb --reset-auth` rotates
   `INDIEWEB_REG_TOKEN` and re-opens registration) as the ultimate fallback for
   the owner who controls the Cloudflare account + GitHub repo.

3. **Session signing key.** **Resolved:** a separate new `INDIEAUTH_SESSION_KEY`
   (rotating the session key doesn't invalidate issued IndieAuth tokens, and vice
   versa).

4. **Profile (`me`/h-card) returned to clients.** **Resolved:** `me = SITE_URL`;
   `profile.name` from `OWNER_NAME` (collected on-demand per the PII policy),
   `profile.photo` from the site logo if present.

## Security considerations

- **rpId / origin** derive from `SITE_URL`; passkeys are domain-bound, so an
  endpoint served from `*.workers.dev` can't impersonate the custom domain (the
  skill already requires a custom domain).
- **Consent token** is HMAC-bound to `client_id|redirect_uri|scope|nonce|exp` and
  delivered only via the POST-through, blocking consent-screen-skip deep links.
- **`user_verification: "required"`** so a stolen unlocked device still needs the
  biometric/PIN gate.
- The deploy scan already treats `/auth*` as intentional public routes and
  asserts `INDIEAUTH_*` keys are secret bindings; extend it to `INDIEAUTH_SESSION_KEY`
  and `INDIEWEB_REG_TOKEN`.
- Registration endpoints must fail closed: no token and no session → 403.

## Testing (TDD)

Plugin-side, against `@dwk/webauthn`/`@dwk/indieauth` stubs (the established
pattern), each behavior failing-first:

- `approveAuthorization`: no session → returns a `Response` (the consent page),
  not an approval; never mints on an unauthenticated request.
- valid session + matching consent token → returns `AuthorizationApproval` with
  `me === SITE_URL` and the requested scopes.
- forged/missing/mismatched `_consent` token with a valid session → still returns
  the consent page, never an approval (deep-link-skip blocked).
- `/auth/webauthn/register/*` with neither token nor session → 403.
- backup code: an unused code establishes a session and is marked `used_at`; the
  same code a second time fails; an unknown code returns the consent page
  unchanged (no oracle); attempts are rate-limited.
- session cookie verify mirrors the membership-cookie tests (tamper, expiry).
- dispatch: `/auth/*` routes only when `AUTH_DB` is bound; `WEBAUTHN`-less env
  fails closed with a clear error.

## Out of scope

- **Micropub realignment (#2c)** — `createMicropub({ baseUrl, me })`; its auth is
  the IndieAuth *token*, so it depends on this shipping but needs no passkey work.
- IndieAuth client features (signing *into* other sites) beyond what
  `@dwk/indieauth` already provides.
- Multi-user / delegated identity — one owner per site.

## Build sequence (for the implementation plan)

1. DO binding + `migrations` + `WebAuthnObject` re-export; `createWebAuthn` wired,
   ceremonies reachable (no gating yet) — prove the DO boots.
2. Owner session cookie (issue/verify), mirroring membership helpers.
3. Registration gating (§1) + `/auth/register` page; enrol a credential E2E.
4. `approveAuthorization` + consent page + `/auth/consent` + consent token.
5. Backup codes: `OWNER_AUTH_DB` table, generation/display, single-use redemption
   on the consent page, regeneration from an authenticated session.
6. `createIndieAuth({ baseUrl, approveAuthorization })` wired into dispatch.
7. Skill (`/anglesite:indieweb`) provisions the DO, `OWNER_AUTH_DB`, secrets, the
   one-time registration link, and shows the backup codes once; deploy-scan
   extensions; docs + ADR-0022.
