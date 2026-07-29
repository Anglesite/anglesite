# Solid Pod, Solid-OIDC, and WebDAV worker support

## Problem

Activating the `webdav` worker in Settings and deploying fails entirely:

```
worker route claims are invalid: worker "webdav" route "/dav" has invalid
methods: unknown or non-uppercase method "PROPFIND"
```

`WorkerRouteClaims.allowedMethods` ([WorkerRouteClaims.swift:52](../../../Sources/AnglesiteCore/WorkerRouteClaims.swift))
is a closed set (`GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`) that predates WebDAV's
catalog entry. The Settings UI lets a user activate `webdav` (the Workers tab is generic over any
catalog descriptor with `binding: settingsActivated` — there's no readiness field in
`WorkerDescriptor`), but nothing in this app actually implements the WebDAV/Solid-Pod dispatch
path, so the deploy hard-fails with no actionable next step.

Investigation (this session, cross-referenced against `davidwkeith/workers` — see PRs
[#464](https://github.com/davidwkeith/workers/pull/464) and
[#465](https://github.com/davidwkeith/workers/pull/465), both merged) confirmed the underlying
packages are real and further along than the catalog/allowlist suggested:

- `@dwk/solid-pod@1.0.0-beta.1` — an edge-native Solid Pod (LDP, WAC, N3 Patch, RDF content
  negotiation, notifications) fronting a per-pod Durable Object, R2 for blobs.
- `@dwk/webdav@1.0.0-beta.1` — an RFC 4918 Class 2 façade over the same pod. `createSolidPodWebdav`
  / `createSolidPodWebdavCredentials` are implemented and exported from `@dwk/solid-pod` (confirmed
  against `packages/solid-pod/src/handler.ts`/`index.ts`, not just docs).
- `@dwk/solid-oidc@1.0.0-beta.1` — a Solid-OIDC OpenID Provider issuing the DPoP-bound, ES256,
  `webid`-claim tokens `@dwk/solid-pod`'s Resource Server validates. This is the actual token
  issuer — **not** `@dwk/indieauth`'s HS256 tokens, despite indieauth's README previously (and
  incorrectly) claiming otherwise; that was stale documentation, corrected in #464.

Conformance caveat: `@dwk/webdav`'s litmus conformance run is currently **failing**
(`basic` 15/16 passing, `copymove`/`props`/`locks` never ran because litmus halts after the first
failing group — see `conformance/status.json` upstream). This design ships the app-side plumbing
now; it does not wait for litmus to go green, matching this app's existing precedent of shipping
`@dwk/webmention` receive while its own conformance status was `"pending"` (V-3.1, #359/#887).
Readiness is surfaced to the debug pane as an advisory, not a deploy blocker (see §6).

## Scope

**In scope:**
- Compose `solid-oidc`, `solid-pod`, and `webdav` into the per-site Worker (bindings + dispatch).
- Widen `WorkerRouteClaims.allowedMethods` for the WebDAV verb set.
- Reuse the site owner's existing IndieAuth identity/consent for solid-oidc — no second login.
- Extend the existing conformance-advisory mechanism with a storage phase.
- Note (not make) the upstream `catalog.json` `requires` edits this depends on.

**Out of scope (deferred, tracked separately):**
- A Settings UI for minting/listing/revoking WebDAV app passwords (the `/dav-credentials`
  endpoint already exists server-side; a user can exercise it directly for now). Follow-up issue.
- Waiting for litmus to go green, or doing any work inside `davidwkeith/workers` itself — that
  repo's owner is handling the WebDAV/Solid-Pod package work; this spec is app-side only.
- Any UI for browsing/managing pod contents beyond mounting it as a network drive.
- Solid-oidc features its own README lists as deferred (refresh tokens, DCR/PAR, UserInfo).

## Design

### 1. Identity & consent

`solid-oidc`'s `approveAuthorization` hook reuses the same owner-password check
`@dwk/indieauth`'s `approveAuthorization` already gates on (the `INDIEAUTH_OWNER_PASSWORD` secret
and its existing verification helper in [worker.ts](../../../Resources/Template/worker/worker.ts)) —
no second credential, no second login screen. The pod's WebID is derived from the site's own base
URL: `{baseUrl}/profile/card#me`.

Upstream catalog data needed (yours to add, per the existing `@dwk/workers` catalog-coordination
pattern — #746/#829 precedent): `solid-oidc.requires: ["indieauth"]`. This isn't just a UX
nicety — `@dwk/solid-oidc` hardcodes its D1 binding name to `AUTH_DB` (confirmed in its README's
bindings table), exactly the same literal name `@dwk/indieauth` already requires
([WorkerComposition.swift:22](../../../Sources/AnglesiteCore/WorkerComposition.swift)). With
`requires: ["indieauth"]`, `WorkerActivation`'s transitive resolution guarantees indieauth's
`AUTH_DB` block is always emitted alongside solid-oidc, so solid-oidc's binding need is satisfied
by the *same* per-site D1 database indieauth already provisions — solid-oidc's own
`solid_oidc_codes` table coexists there under its own name, no second D1 database, no binding
collision. Composition should key off `WorkerComposition.solidOidcWorkerID` the same way
`microsubWorkerID` already documents this "bindings fall out for free via `requires`" pattern.

Also needed upstream: `solid-pod.requires: ["solid-oidc"]`, so activating `webdav` in Settings
cascades `solid-pod` → `solid-oidc` → `indieauth` automatically, matching how `webdav.requires:
["solid-pod"]` already cascades today.

A third issue was found during implementation, and is now **resolved app-side, no catalog change
needed**: `solid-pod`/`webdav`'s `catalog.json` entries each declare both an exact claim (`/pod`,
`/dav`) and a prefix claim (`/pod/`, `/dav/`) for the same base path, which used to throw
`duplicateClaim` (both normalize to the same path from the same owner). This is exactly the same
shape Micropub's catalog entry already used for `/media`, and was fixed generally in #1072
(`45d75d49`): `WorkerRouteClaims.activeClaims`'s duplicate check now keys by `(path, match)`
rather than path alone, so a worker's own exact+prefix pair at the same path coexist, while a
genuine same-match-kind collision is still caught. `WorkerRouteClaimsTests.sameOwnerExactPlusPrefixCollide`
pins the solid-pod/webdav-shaped case specifically.

### 2. Composition (`WorkerComposition.swift`)

New bespoke bindings, following the existing `indieauthWorkerID`/`webmentionWorkerID`/etc. pattern
(a `public static let` catalog-id constant plus a dedicated code branch, since these binding names
are each package's public contract, not expressible via the generic `needsD1`/`needsKV`/`needsR2`
resource flags):

- `solid-oidc`: secret `OIDC_SIGNING_KEY` (an ES256 JWK generated once via `@dwk/solid-oidc`'s
  `generateSigningJwk()` and persisted — same provisioning shape as
  `ActivityPubKeyProvisioning.swift`'s actor keypair). `AUTH_DB` requires no new binding block, per
  §1.
- `solid-pod`: Durable Object `POD`/`SolidPodObject` (sqlite class), R2 `BLOBS`, optional D1
  `GC_DB`, and a cron trigger for `createSolidPodGc`.
- `webdav`: no new resources of its own — it reuses `solid-pod`'s `POD`/`BLOBS` — plus secret
  `WEBDAV_PEPPER`.

### 3. Dispatch (`worker.ts`)

Import `createSolidOidc`/`generateSigningJwk` from `@dwk/solid-oidc`, and
`createSolidPod`/`createSolidPodGc`/`createSolidPodWebdav`/`createSolidPodWebdavCredentials`/
`SolidPodObject` from `@dwk/solid-pod`. Wire each into the existing declarative `ROUTES` dispatch
table alongside indieauth/webmention/micropub/etc., with the same graceful-degrade-when-unbound
posture already established there: optional `Env` fields, a route whose binding isn't present
degrades to `503` rather than throwing at module load. `SolidPodObject` is re-exported the same way
`ActivityPubObject` already is, for `wrangler.toml`'s Durable Object class binding.

`solid-pod`'s config trusts `solid-oidc`'s issuer/JWKS at the site's own origin (same-origin
same-site, `mountPath: "/oidc"`), with `audience` including the pod's own identifier — both
same-site config, no cross-site secrets to provision.

### 4. Route claims (`WorkerRouteClaims.swift`)

Widen `allowedMethods` to add: `PROPFIND`, `PROPPATCH`, `MKCOL`, `COPY`, `MOVE`, `LOCK`, `UNLOCK`.
This was previously withheld because "new methods need app-side dispatch support anyway" — that
dispatch now exists (§3), so the restriction's own stated condition is satisfied. `solid-oidc` and
`solid-pod`'s own routes need no new methods (`GET`/`HEAD`/`POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS`
are already allowed).

### 5. Conformance advisory (`WorkersConformance.swift`)

Add a `.storage` case to `WorkersConformanceStatus.Phase`, with `phaseRequirements[.storage] =
["@dwk/webdav", "@dwk/solid-pod"]`. `WorkerActivation.conformanceAdvisory` picks this up for free
via its existing `for phase in [.v2, .v3, .v4]` loop (extend to include `.storage`) — no new
blocking logic, matching the "advisory only, never blocks" contract already documented on that
function. With litmus currently failing, activating `webdav` today logs something like
`conformance: @dwk/webdav not yet release-ready for this phase` in the debug pane, exactly the
same posture V-3's "pending" packages get today.

### 6. What this does *not* change

- `PreDeployCheck`/`pre-deploy-check.ts` — untouched; this is a Worker-composition change, not a
  template security-gate change.
- The Settings UI — already generic over any `settingsActivated` catalog descriptor; no new UI
  code needed for the toggle itself. Credential management (app passwords) UI is deferred (see
  Scope).
- No paired PR against `Anglesite/anglesite-skills` — this doesn't touch the MCP message schema.

## Testing

- `WorkerRouteClaimsTests`: the widened `allowedMethods` accepts a `webdav`-shaped descriptor
  (PROPFIND et al.) and still rejects a genuinely unknown/lowercase method.
- `WorkerCompositionTests`: new cases for `solid-oidc` (secret + reused `AUTH_DB`, no duplicate D1
  block when `indieauth` is also active), `solid-pod` (DO/R2/optional-D1/cron), `webdav` (reuses
  `solid-pod`'s DO/R2, adds `WEBDAV_PEPPER`), and the full cascade (`webdav` active alone still
  provisions `solid-pod` + `solid-oidc` + `indieauth` bindings via `requires` resolution).
- `WorkerActivationTests` / catalog fixtures: once the upstream `requires` edits land, add a fixture
  covering the four-deep transitive cascade.
- `worker.test.ts`: new cases mirroring the existing per-package dispatch tests — bound vs.
  unbound (503) for each of the three new route groups, plus an owner-password consent case for
  `solid-oidc`'s `approveAuthorization` reusing the IndieAuth check.
- `WorkersConformanceReaderTests`/`WorkerActivationTests`: `.storage` phase gate reports blocked
  when `@dwk/webdav` status is anything other than release-ready, matching the `.v2`/`.v3`/`.v4`
  pattern already tested.

## Open questions / follow-ups (not blocking this PR)

- WebDAV app-password management UI (Settings surface for mint/list/revoke) — separate issue.
- Whether `GC_DB` (optional D1 for solid-pod's R2 GC) should default on or stay opt-in; leaning
  opt-in initially, consistent with "optional" in the catalog resource entry, revisit once real
  usage data exists.
- Upstream litmus conformance going green is entirely on the `davidwkeith/workers` side; this app
  only reflects that status, it doesn't drive it.
