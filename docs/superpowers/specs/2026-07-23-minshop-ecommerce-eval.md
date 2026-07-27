# minshop as a self-hosted ecommerce option — evaluation

**Issue:** none yet — exploratory evaluation; a tracked issue should be opened before any implementation work
**Related:** Personal Publishing OS pivot ([#334](https://github.com/Anglesite/Anglesite-app/issues/334)), Add-Store wizard router (`docs/superpowers/specs/2026-07-05-add-store-wizard-router-design.md`), Worker catalog (`docs/superpowers/plans/2026-07-13-worker-catalog.md`)
**Date:** 2026-07-23
**Status:** Evaluation complete — recommendation: watch and validate, do not integrate yet

## 1. Question

Could [minshop](https://github.com/ddyy/minshop) (MIT) give Anglesite a **self-hosted** ecommerce option — a real multi-product store running in the site owner's own Cloudflare account — alongside the five hosted third-party integrations we ship today (Snipcart, Shopify Buy Button, Stripe/Polar buy button, Lemon Squeezy, Paddle)?

## 2. What minshop is (verified 2026-07-23, source-level review)

An Astro 7 SSR storefront for Cloudflare Workers + D1 + R2, ~15k lines, feature-sliced (`src/features/{auth,cart,catalog,orders,payments,products,search,settings,shipping,storage,…}`):

- **Storefront + admin** — server-rendered catalog, nested categories, cookie-based cart (near-zero client JS); full admin for products, orders, customers, fulfillment, CSV export, runtime settings.
- **Payments behind a `PaymentProvider` seam** — Stripe Checkout, self-hosted Bitcoin Lightning (phoenixd/LNbits behind an inner `LightningBackend` seam), hosted OpenNode, and a demo rail. Card entry stays on Stripe's hosted checkout, so PCI exposure is minimal. Lightning settlement treats webhooks as untrusted nudges and re-polls the node (forged webhooks can't fake a sale).
- **Search behind a `SearchProvider` seam** — FTS5 keyword (default, $0) or Workers AI + Vectorize semantic search with graceful fallback.
- **Agent API** — public JSON endpoints (`GET /api/products`, `GET/POST /api/checkout`, `llms.txt`) so an AI agent can browse and buy without scraping; Lightning checkout returns a directly payable BOLT11 invoice (agent pays with no human in the loop).
- **MCP server** — a sibling Worker (`mcp/`) binding the same D1, exposing store operations (`list_orders`, `order_stats`, `fulfill_order`, `create_product`, …) over streamable HTTP with bearer auth — the same transport shape `MCPClient` already speaks.
- **Ops model** — one-click Deploy-to-Cloudflare or `scripts/provision-cf.sh <slug>` (own D1 + R2 + Worker per instance); 21 additive D1 migrations; only two Worker secrets (`SECRETS_KEK`, `AUTH_SECRET`) — all provider keys are entered in Admin → Settings and stored AES-256-GCM-encrypted in D1, which is what makes an instance clonable and dashboard-configurable. Fits Cloudflare's free tier for a small store.
- **Quality signals** — runtime deps are just `astro`, `stripe`, `uqr`; unit tests on the pure logic plus clean-room D1 integration tests covering checkout-reservation concurrency/release/settlement; an inventory-reservation lifecycle with exactly-once release guards; whitelisted `orderByClause` builders as the SQL-injection boundary; an `AGENTS.md` written specifically for AI tooling customizing a cloned shop; theming via a Tailwind v4 `@theme` token block (`src/styles/theme.css`).
- **Live demo verified** — `demo.minshop.dev/api/products?q=hat` returns the documented self-describing JSON; `/api/checkout` reports available rails.

**Maturity (the problem):** first commit **2026-07-20** — the repo was 3 days old at evaluation time. Single author (Daniel Yang), 19 commits, 7 stars, no tags or releases, no production track record. The code reads well, but payments is the least forgiving domain in which to be this early.

## 3. Fit against Anglesite's two integration systems

Neither existing system fits minshop as-is:

| System | Shape | Why minshop doesn't fit |
|---|---|---|
| `IntegrationDescriptor` (`IntegrationCatalog.swift`) — where all five current ecommerce options live | Client-side script/config injection into the site's own Astro project (`copyFile`, `injectAtAnchor`, `writeConfig`, `addCSPDomains`); zero provisioning | minshop is a whole second Astro application with its own database, not an embed |
| `WorkerDescriptor` (`WorkerCatalog.swift`, `@dwk/workers` catalog) | Route-level composition into the site's **single** Worker via `WorkerComposition`; `needsD1`/`needsKV`/`needsR2`; route claims | minshop owns its Worker entry (the Astro Cloudflare adapter supplies it — setting `main` breaks its build), so it can't be merged into the site Worker without forking |

The structural mismatch: Anglesite's worker catalog assumes *many features, one Worker, one origin*; minshop assumes *one store = one Worker + one D1 + one R2*. Bridging them means a new deployment concept — a **companion worker**: a standalone app deployed to its own hostname (`shop.<domain>`) or routed path, with a provision/migrate/destroy lifecycle rather than route claims.

Anglesite already has every provisioning primitive a companion needs: `WorkerComposition` emits D1/KV/R2/Queues bindings with provisioning-filled IDs, and `SiteConfigStore` already persists per-site Cloudflare resource IDs (the `inboxCaptureKVNamespaceID` pattern). A minshop companion needs exactly one D1, one R2, two generated secrets, and `wrangler d1 migrations apply` on deploy — all scriptable, with minshop's own `provision-cf.sh` as a working reference.

## 4. What it would add that the current lineup can't

Every existing option is a hosted third party (Snipcart 2% + $10/mo, Shopify $39/mo, Lemon Squeezy/Paddle MoR fees, buy buttons single-product-only). minshop fills the gaps that align with the Personal Publishing OS ethos:

- Catalog and orders in **the owner's** Cloudflare account — exportable, ~$0/mo at small scale.
- A real multi-product store with admin and fulfillment.
- Agent-ready commerce (machine-readable catalog + programmatic checkout) — an emerging category.
- Lightning payments; MCP operability that could someday surface "manage my store" in Anglesite chat/App Intents without new plumbing concepts.

The `AddStoreRouter`'s deterministic routing (physical/few → Snipcart, physical/catalog → Shopify, software → Paddle) has an obvious empty branch this would fill: *self-hosted / own-your-data*.

## 5. Recommendation

1. **Do not integrate now.** Too young to put under users handling real money; nothing to pin against.
2. **Validate cheaply:** deploy one real instance manually next to an existing Anglesite site and run it for a few weeks — answers webhook reliability, admin ergonomics, and free-tier fit with zero app-side commitment.
3. **If it earns trust,** integration lands as the companion-worker concept: provision D1 + R2 + two secrets; deploy from a **pinned fork under the Anglesite org** (single-author upstream — control the supply chain); fill `theme.css` tokens from the site's design-interview output; register the MCP endpoint. Design-doc-sized effort, not a wizard entry.
4. **Regardless:** borrow the agent-API shape (`/api/products`, `/api/checkout`, `llms.txt`) as a pattern for Anglesite's own template — machine-readable commerce endpoints are coming to every storefront.

## 6. Risks and open questions

- **Bus factor / longevity** — single author, no release process. Mitigation: pinned org fork; the MIT license and small dependency surface make a maintained fork tenable.
- **Second Astro project per site** — a companion store sits outside the site's `Source/` repo. Where does its (forked, pinned) source live relative to the `.anglesite` package, and does the git-is-source-of-truth rule extend to it? Open question for the design doc.
- **Node 22 requirement** — matches the container image's toolchain expectations, but the companion would build/deploy via its own pipeline, not the site's.
- **Domain wiring** — `shop.<domain>` needs a DNS record + route; the existing Cloudflare onboarding flow covers the account/API-token side but not multi-hostname routing.
- **Re-evaluation trigger** — revisit if the project reaches meaningful adoption (releases, external contributors, stores in production) or goes quiet for months.
