# `.well-known` support — design (#690)

- **Date:** 2026-07-14
- **Status:** Proposed
- **Issue:** [#690 — Audit `.well-known` support](https://github.com/Anglesite/Anglesite-app/issues/690)
- **Related:** [#405 — `security.txt`](https://github.com/Anglesite/Anglesite-app/issues/405), [#366 — WebFinger / identity](https://github.com/Anglesite/Anglesite-app/issues/366), [#338 — federation](https://github.com/Anglesite/Anglesite-app/issues/338), [#700 — local Workers](https://github.com/Anglesite/Anglesite-app/issues/700)

## Decision

Anglesite will treat `/.well-known/` as an **origin-scoped protocol namespace**, not as a
collection of optional site metadata and not as a directory users should populate from a list.

An effective endpoint has one of four delivery owners:

1. **User static:** a committed file in `Source/public/.well-known/`.
2. **Anglesite generated:** a deterministic static file generated from a git-visible site source.
   `security.txt` is the only baseline generator.
3. **Feature dynamic:** an exact or protocol-defined Worker route owned by an enabled feature.
   WebFinger is the first planned example.
4. **External runtime:** a path demonstrably controlled by the active hosting/TLS runtime. ACME
   may be in this class for a particular provider, but is not globally provider-owned.

There is no namespace-wide content type, redirect, CORS, cache, method, or fallback policy. Each
managed endpoint uses a protocol-specific validator. There is also no collision precedence: if
two owners claim the same effective path, build/deploy stops and names both claims.

This document establishes the policy, inventory/collision contract, and the repair required for
Anglesite's existing `security.txt` baseline. It deliberately does **not** add a generic endpoint
editor, a settings tab, a live conformance service, a template migration framework, or new social
protocol implementations. Those need concrete feature issues after the foundation is proven.

## Convention review

### What RFC 8615 provides

[RFC 8615](https://www.rfc-editor.org/rfc/rfc8615.html) reserves `/.well-known/` at an origin's
root for protocols that explicitly use it.

- `/.well-known/example` is well-known; `/blog/.well-known/example` is not.
- `/.well-known/` itself has no defined representation. Anglesite must not create an index there.
- A registered suffix is one non-empty path segment. Additional segments are valid only when the
  owning protocol defines them, as ACME does for `acme-challenge/<token>`.
- RFC 8615 does not define universal HTTP behavior. The registered specification defines schemes,
  ports, origin scope, methods, query handling, status codes, redirects, representation, CORS,
  and caching.
- Anglesite will not invent `/.well-known/anglesite` or another product suffix without a stable
  public specification and IANA registration.
- These resources often bind an identity, application, or policy to an entire origin. Writes can
  therefore be more security-sensitive than ordinary page content.

The [IANA Well-Known URI registry](https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml)
is the collision-control source of truth. Registry status (`permanent`, `provisional`,
`deprecated`, and so on) is not a recommendation that Anglesite implement an entry.

### Assessment of the list linked from #690

[`moul/awesome-well-known`](https://github.com/moul/awesome-well-known) is useful discovery
material, but is not normative. Its last content commit was in 2022, it points to superseded RFC
5785, and it mixes IANA entries, unregistered vendor conventions, and root files such as
`robots.txt` that are not under `/.well-known/`.

Before managing an endpoint, Anglesite must check the current IANA entry and the authoritative
protocol specification. User-authored registered or vendor-defined files remain allowed; the app
labels them externally managed and makes no conformance claim for them.

### Similar discovery mechanisms are not interchangeable

- **IndieAuth:** do not create `/.well-known/indieauth`. Current IndieAuth discovers a
  `rel=indieauth-metadata` link from the identity URL. The server metadata may use RFC 8414's
  registered `/.well-known/oauth-authorization-server` form.
- **WebSub:** do not create `/.well-known/websub`. A publisher advertises `rel=hub` and `rel=self`
  on each topic through HTTP Link headers or document/feed links.
- **WebFinger:** `/.well-known/webfinger` is correct for Mastodon-style address discovery and
  wider Fediverse interoperability, but WebFinger is not itself a normative ActivityPub
  requirement.
- Root conventions such as `/robots.txt`, `/carbon.txt`, `/ads.txt`, and `/humans.txt` stay in
  their own artifact or integration paths.

## Current Anglesite audit

| Area | Current behavior | Finding |
|---|---|---|
| Static files | Astro copies `public/.well-known/`; `.gitignore` ignores only generated `security.txt` | Correct base; preserve the narrow ignore rule |
| `security.txt` | `scripts/edge-artifacts.ts` writes Contact, Expires, and Canonical from `.site-config` | Partial RFC 9116 support with stale-file and placeholder defects |
| Pre-deploy | `checkArtifactPresence` requires `security.txt` regardless of configuration | Presence is not conformance and creates a false warning when disabled |
| Edge hardening | the dotfile WAF rule exempts `/.well-known/` | Correct; preserve it |
| Dynamic routes | only future comments exist in `worker.ts` | No active endpoint or declared collision policy |
| Worker routing | Wrangler omits `assets.run_worker_first` | Cloudflare assets are first by default and can shadow a Worker route |
| Headers | `csp.ts` regenerates `public/_headers` | Static endpoint headers must flow through that generator |
| Runtime | the local container clones the site's git `HEAD` | Host writes are not preview-visible until committed and the runtime is refreshed |
| Scan JSON | TypeScript emits `Issue[]`; two Swift consumers expect another envelope | Existing defect; reconcile in a separate prerequisite before adding findings |

The current `security.txt` generator has four concrete defects:

- clearing or invalidating `SECURITY_CONTACT` leaves an older generated file behind;
- missing `SITE_URL` writes `https://example.com/.well-known/security.txt` as Canonical;
- an existing hand-authored file has no ownership protection; and
- build/pre-deploy checks do not parse the result or verify its deployed media type.

`Policy` and `Preferred-Languages` are useful optional fields left out of #405, but their absence
is not an RFC 9116 conformance defect. They are a product enhancement, not a prerequisite to the
baseline repair.

## Endpoint inventory and validation

### Descriptor

`AnglesiteCore` gains a portable inventory descriptor. Build-side TypeScript and Worker catalog
route metadata use the same JSON field names:

```swift
public struct WellKnownEndpointDescriptor: Sendable, Codable, Equatable, Identifiable {
    public var id: String
    public var suffix: String                 // first segment, no leading slash
    public var match: Match                   // exact or specification-approved prefix
    public var delivery: Delivery             // userStatic/generated/dynamic/externalRuntime
    public var owner: String                  // stable feature, generator, or runtime id
    public var registration: Registration     // permanent/provisional/deprecated/custom/…
    public var specificationURL: URL
    public var validatorID: String?            // nil means inventory-only, no conformance claim
    public var authorityBinding: Bool
}
```

The descriptor locates and attributes a claim; it is not a substitute for the protocol. A
`validatorID` resolves to code that defines the allowed schemes and ports, origin rules, methods,
query grammar, status/error behavior, redirect policy, media types, CORS, caching, size limits,
and body parser. This avoids pretending one generic data model can express WebFinger, ACME, and
`security.txt` completely.

`WellKnownInventory` merges:

1. a scan of `Source/public/.well-known/`;
2. active Anglesite generators;
3. effective routes from enabled Worker descriptors; and
4. reservations reported by the selected deployment runtime.

Each row records its effective path/prefix, owner, delivery, source, active state, registry status,
and validation findings. Unknown files remain user-static inventory rows and are never rewritten.
The inventory code rejects absolute paths, empty segments, `..`, encoded separators, paths that
escape the root after standardization, and symlinks.

The **app/deploy orchestrator**, not template TypeScript, assembles the complete inventory. Worker
activation lives in package `Config/`, and provider capabilities are host-side; neither is present
inside the site's runtime clone. Before build, the orchestrator serializes only the derived,
non-secret effective claims to an ephemeral `WellKnownClaimManifest` and passes it through a new
substrate-neutral build-command input. The runtime writes that input to temporary storage outside
`Source/`, and the build returns its observed static/generated artifact inventory and findings.
Raw site settings, credentials, and provider tokens never cross this seam.

No current `SiteRuntime` or deploy-orchestrator abstraction provides either provider-owned-path
reporting or this build input/output transport. [#748](https://github.com/Anglesite/Anglesite-app/issues/748)
owns those capabilities as a standalone prerequisite; [#744](https://github.com/Anglesite/Anglesite-app/issues/744)
consumes them for inventory and collision enforcement. Until #748 exists, Anglesite can validate
the static/generated subset only; it must not claim cross-owner collision protection for dynamic
or provider-owned paths.

### Source of truth by owner

| Owner | Canonical input | Published form |
|---|---|---|
| User static | committed `Source/public/.well-known/<path>` | Astro copies it to `dist/` unchanged |
| Generated | git-visible `.site-config` or feature source | deterministic marker-owned file, then `dist/` |
| Dynamic | Worker catalog descriptor + effective activation state | exact Worker route; no static approximation |
| External runtime | active runtime/provider capability | runtime-controlled response, or no claim |

Dynamic activation follows the accepted [#700 Workers design](2026-07-13-workers-local-debugging-design.md):
settings-activated worker IDs live in package `Config/`, component-tied activation is computed,
and the catalog describes what each Worker exposes. The well-known layer does not create a second
git-tracked activation system. [#746](https://github.com/Anglesite/Anglesite-app/issues/746) adds
generic HTTP route metadata to the existing `WorkerDescriptor` after #708/#709; it must not
introduce a parallel well-known-only catalog.

Credentials, private keys, ACME tokens, and unpublished configuration never become inventory
content. Runtime bindings and secrets stay in their existing protected stores.

### Collision rules

Validate the effective inventory before generation and again against `dist/`:

- two exact claims for the same path are an error;
- an exact claim inside another owner's prefix is an error unless that descriptor delegates it;
- overlapping prefixes from different owners are an error;
- an enabled generator refuses to overwrite an unmarked hand-authored file;
- a dynamic route and same-path static output conflict even if the current host would choose one;
- a disabled generator may delete only an output carrying its own marker; and
- an external-runtime reservation exists only when that runtime explicitly reports ownership.

ACME illustrates the last rule: RFC 8555 has the client provision a short-lived token under
`/.well-known/acme-challenge/` on HTTP port 80. A hosting provider may own that path for managed
TLS, but Anglesite cannot reserve it globally. Without a runtime claim, a user or ACME client may
manage it under the protocol's rules.

Errors name both owners and the exact file, feature, or runtime claim that must change. Anglesite
does not recover with “static wins” or “dynamic wins.”

## Delivery rules

### Static and generated files

A template module such as `scripts/well-known.ts` owns well-known inventory, generation, and
validation. `edge-artifacts.ts` may delegate to it while keeping root-level `robots.txt` separate.

The build order is:

1. The app assembles the complete effective claim manifest and rejects declared collisions.
2. The runtime receives that manifest ephemerally, scans the actual static files in its clone, and
   rejects any new collision before writing.
3. Materialize generated files and remove only marker-owned stale outputs.
4. Add protocol-specific exact-path rules through `csp.ts`'s `buildHeaders()`; never append to
   `_headers` independently.
5. Build Astro.
6. Verify active static/generated entries at their exact `dist/.well-known/...` paths and return
   the observed artifact inventory to the orchestrator.
7. Recheck the effective inventory, run each managed endpoint's protocol validator, and emit
   structured pre-deploy findings.

Static files use Cloudflare's normal revalidation behavior unless their protocol says otherwise;
they are not blanket `immutable`. Every managed static endpoint receives its exact media type and
`X-Content-Type-Options: nosniff`. CORS and redirects follow required **or recommended**
protocol-specific policy—never a `/.well-known/*` header block. Worker handlers set their own
headers because `_headers` affects static assets only.

### Dynamic Worker routes

Dynamic route work builds on #700/#708:

- route metadata extends the existing `WorkerDescriptor`;
- `WorkerComposition` derives selective `assets.run_worker_first` entries for active dynamic
  routes, because Cloudflare otherwise serves matching assets first;
- the Worker matches exact paths unless the protocol explicitly permits children;
- unsupported methods return `405` plus `Allow` instead of falling back to assets;
- `HEAD` mirrors `GET` headers without a body when allowed; and
- unknown names, the bare directory, malformed encodings, and case/trailing-slash variants return
  a real 404 rather than an HTML page or SPA shell.

Local dynamic preview depends on #700's `wrangler dev --local` runtime. Until that lands, static
routes are preview-testable but dynamic endpoints are deploy/fixture-testable only. This design
does not add a competing `SiteRuntime` process or sync API.

WebFinger is necessarily dynamic or a conforming redirect to a hosted service. Its handler:

- requires HTTPS and exactly one `resource` query parameter;
- accepts repeated `rel` parameters and ignores unknown query parameters;
- returns 400 for a malformed request and 404 for an unknown resource;
- emits `application/jrd+json` and `Access-Control-Allow-Origin` on success and error responses
  (`*` is the normal public policy); and
- emits only HTTPS redirect targets when delegating to a hosted service; clients and Anglesite's
  verifier validate certificates and hostnames at every hop and enforce a bounded redirect count.

A single static JRD response must never be labeled RFC 7033-compliant.

### Origins and aliases

Well-known authority belongs to the origin used to retrieve it. `SITE_URL` is Anglesite's primary
production origin for generation and validation.

- Never write the `example.com` fallback into a managed document.
- If an optional canonical field needs a valid HTTPS `SITE_URL` and none exists, omit that field
  and report a configuration warning.
- Loopback HTTP preview can test routing but cannot prove HTTPS production conformance.
- Apex, `www`, subdomains, alternate ports, `pages.dev`, and `workers.dev` are independent origins.
- Identity handlers answer only for explicitly configured identities/hosts.

## Protocol support policy

| Endpoint or family | Anglesite policy |
|---|---|
| `security.txt` | first-class generated static baseline; repair first |
| `webfinger` | dynamic/hosted-redirect only; implement with #366 when its backend gate clears |
| `acme-challenge/*` | reserve only when the active runtime reports managed-TLS ownership; otherwise preserve protocol-compliant external/user management |
| `oauth-authorization-server`, `host-meta*`, `nodeinfo` | feature-owned only when an implemented authentication/social protocol requires them; no baseline output |
| app associations and decentralized identity files | preserve as user static today; a future integration needs an authority-binding, protocol-specific validator |
| `gpc.json`, `tdmrep.json` | opt-in only when the site actually implements the policy it publicly declares |
| `change-password` | temporary redirect only for a site with real accounts and a password-management destination |
| unknown registered or vendor-defined file | preserve and deploy after generic path/size/secret checks; label externally managed and make no conformance claim |

The app should expose only endpoints it can configure correctly for a real Anglesite feature. It
must not mirror the IANA registry as a wall of toggles.

## First implementation: repair `security.txt`

This is the smallest useful implementation follow-up from #690's audit.

1. Add a git-visible `SECURITY_TXT_MODE=generated|manual|disabled` setting. Swift and TypeScript
   must interpret it identically; generator enablement is no longer inferred from Contact alone.
2. Add an RFC 9116 comment marker identifying newly generated output.
3. In `generated` mode, refuse to overwrite an unmarked file.
4. In `manual` mode, preserve the static file and never generate or delete it. In `disabled` mode,
   a remaining static file is reported as a configuration contradiction and is not deleted.
5. When generated configuration becomes invalid or the mode changes, delete only marker-owned
   output.
6. Accept a valid URI; normalize a bare email to `mailto:` in the UI and require HTTPS for web
   contacts.
7. Generate exactly one `Expires`. Anglesite chooses 180 days as product policy, satisfying RFC
   9116's recommendation that it be less than a year without calling that recommendation a MUST.
8. Emit Canonical only for a valid HTTPS `SITE_URL`; never emit the example.com fallback.
9. Generate the exact `text/plain; charset=utf-8` static header and revalidation policy.
10. Parse the built file for Contact, exactly one Expires, optional fields, Canonical, UTF-8, and a
   final newline.
11. Make pre-deploy checks state-aware: disabled-and-absent is silent; generated/manual and valid
   passes; mode/file contradictions and configured but missing/malformed/stale content report an
   actionable finding.

`Policy` and `Preferred-Languages` may be added in the same implementation for completeness, but
are optional enhancement work and must not block the lifecycle fix.

### Existing sites and ownership adoption

Current generated files have neither a marker nor an ownership mode, so every unmarked
`security.txt` cannot simply be called user-authored. On migration:

1. If the file exactly matches the legacy Anglesite shape **and** its values match current site
   settings, classify it as a legacy candidate.
2. A noninteractive build preserves it and reports that ownership must be resolved. The app can
   offer **Adopt as generated** or **Preserve as hand-authored**; preservation is the default.
   Never infer ownership from shape alone.
3. Adoption persists `SECURITY_TXT_MODE=generated` and rewrites with the marker. Preservation
   persists `SECURITY_TXT_MODE=manual` and makes the file normally git-trackable by adding a later
   `.gitignore` negation for that exact path; the app explains any required initial add.
4. Missing file plus a configured Contact migrates to `generated`; missing file plus no Contact
   migrates to `disabled`. Files that do not match the legacy fingerprint default to `manual` and
   are never changed.

Existing Dependency Sync updates `package.json` dependencies only; it has no safe mechanism for
upgrading template scripts. With the current clone-and-run runtime, app-bundled code cannot repair
a site's checked-in `edge-artifacts.ts`. Existing-site rollout therefore requires the versioned,
conflict-safe per-file migration tracked by
[#745](https://github.com/Anglesite/Anglesite-app/issues/745). #690 does not silently broaden
Dependency Sync or claim that an app-bundled generator already works.

## Prerequisites and sequencing

The audit found two independent bugs and one missing runtime capability. They are separate
prerequisites rather than hidden inventory scope:

- [#742](https://github.com/Anglesite/Anglesite-app/issues/742) defines one versioned pre-deploy
  JSON envelope and shared Swift decoding before new well-known findings;
- [#741](https://github.com/Anglesite/Anglesite-app/issues/741) fixes aggregate Settings
  dirty/save/revert accounting before any future well-known Settings pane; and
- [#748](https://github.com/Anglesite/Anglesite-app/issues/748) adds provider-owned-path reporting
  plus substrate-neutral ephemeral claim-manifest build input/output. That capability does not
  exist today and must land before full dynamic/provider collision enforcement.

Recommended follow-ups:

1. **[#743 — `security.txt` repair](https://github.com/Anglesite/Anglesite-app/issues/743):**
   lifecycle, ownership adoption, headers, parser, and build tests.
2. **[#744 — inventory/collisions](https://github.com/Anglesite/Anglesite-app/issues/744):**
   portable descriptor, filesystem inventory, path safety, and pre/post-build collision checks;
   consume #748 rather than implementing runtime transport inside the inventory slice.
3. **[#745 — existing-site migration](https://github.com/Anglesite/Anglesite-app/issues/745):**
   versioned per-file upgrades, conflict handling, and explicit legacy ownership adoption.
4. **[#746 — dynamic route metadata](https://github.com/Anglesite/Anglesite-app/issues/746):**
   extend the #700 Worker catalog and Wrangler composition after #708/#709; WebFinger itself stays
   in #366.
5. **Product UI:** design only after inventory proves a concrete need; start read-only and avoid a
   generic file generator.

The headless critical path is #742 → #743 → #744 → #745, with #748 independently blocking #744.
#746 waits for #744/#708/#709 and then unblocks #366. #741 is independent of the headless path and
blocks only a future Settings surface.

No follow-up requires a frontier LLM or a new markdown skill. The work is deterministic
Swift/TypeScript.

## Testing

### Inventory and build

- absent, user-static, generated, dynamic, and runtime-owned inventory rows;
- exact/exact, exact/prefix, prefix/prefix, and static/dynamic/runtime collision cases;
- traversal, encoded separator, symlink, case, size, and root-containment rejection;
- unknown-file preservation and no conformance claim;
- generated marker ownership, legacy adoption/preservation, and stale-output deletion;
- Astro build smoke proving hidden files reach `dist/.well-known/...` byte-for-byte; and
- exact `_headers` generation that survives a CSP rebuild.

Template Node tests originally had no direct CI lane. #744 added both halves: `npm run
test:scripts` runs `Resources/Template/scripts/*.test.ts` in the existing `template-worker` job,
and `WellKnownInventoryTests` carries hermetic Swift asset tests that read the real template source
to catch the cross-language marker and build-seam contracts drifting apart.

### HTTP behavior

- correct media type, method, cache, CORS, status, redirect, and origin behavior per validator;
- unknown, bare-directory, trailing-slash, case, and encoded variants return true 404;
- selective `run_worker_first` generation only for active dynamic routes;
- 405/Allow, HEAD, query preservation, and static fallback for Worker routing; and
- RFC 7033 WebFinger cases when #366 lands, including unknown query parameters, error CORS, and
  HTTPS-only redirect validation.

## Target architecture invariants

- Anglesite can enumerate every effective well-known claim and identify its owner.
- User-static files are preserved, git-visible, and survive template/app upgrades.
- Generated files cannot overwrite user files or remain stale after disablement.
- Managed claims use protocol-specific validators; there is no namespace-wide HTTP policy.
- Static, generated, dynamic, and active-runtime collisions block deploy with both owners named.
- Unknown paths and malformed variants return true 404; `/.well-known/` has no index.
- `security.txt` is valid when configured, absent without a false warning when disabled, and never
  contains the example.com placeholder.
- ACME is reserved only when the selected runtime actually owns it.
- Dynamic endpoints integrate with #700's catalog/activation/runtime design rather than creating
  parallel state.
- No `.well-known/indieauth` or `.well-known/websub` route is introduced.

## #690 completion criteria

- The convention review cites RFC 8615, the live IANA registry, and each protocol specification
  used for a product decision.
- The current Anglesite audit records the `security.txt`, routing, runtime-state, header, and scan
  contract findings without treating unrelated fixes as part of #690.
- Ownership classes, collision policy, ACME's conditional ownership, and the static/dynamic
  boundary are settled.
- The old IndieAuth and WebSub route guidance is explicitly rejected.
- Implementation work is split into the follow-ups above; accepting this design does not imply
  that the target architecture is already shipped.

## Sources

- [RFC 8615 — Well-Known URIs](https://www.rfc-editor.org/rfc/rfc8615.html)
- [IANA Well-Known URI registry](https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml)
- [RFC 9116 — `security.txt`](https://www.rfc-editor.org/rfc/rfc9116.html)
- [RFC 7033 — WebFinger](https://www.rfc-editor.org/rfc/rfc7033.html)
- [RFC 6415 — Web Host Metadata](https://www.rfc-editor.org/rfc/rfc6415.html)
- [RFC 8414 — OAuth Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414.html)
- [IndieAuth specification](https://indieauth.spec.indieweb.org/)
- [W3C WebSub Recommendation](https://www.w3.org/TR/websub/)
- [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/)
- [Mastodon WebFinger specification](https://docs.joinmastodon.org/spec/webfinger/)
- [RFC 8555 — ACME](https://www.rfc-editor.org/rfc/rfc8555.html)
- [W3C Change Password URL](https://w3c.github.io/webappsec-change-password-url/)
- [W3C Global Privacy Control](https://www.w3.org/TR/gpc/)
- [W3C TDM Reservation Protocol](https://www.w3.org/2022/tdmrep/)
- [Cloudflare static assets: Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Astro `public/` directory](https://docs.astro.build/en/basics/project-structure/#public)
