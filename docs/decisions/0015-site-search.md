---
status: proposed
date: 2026-03-28
decision-makers: [Anglesite maintainers]
---

# Add on-site search for content discovery

> **This is a proposed decision.** It evaluates options for adding search functionality to Anglesite sites so visitors can find content without relying solely on navigation or external search engines.

## Context and Problem Statement

As Anglesite sites grow beyond a handful of pages — especially sites with blogs, service catalogs, FAQs, or resource libraries — visitors need a way to find specific content quickly. Currently, sites rely entirely on navigation menus and external search engines. An on-site search feature would improve content discovery, particularly for sites with 10+ pages.

### Constraints

Any search solution must respect existing architectural decisions:

- **ADR-0001** — Static site (Astro, no server runtime)
- **ADR-0003** — Deployed to Cloudflare Pages
- **ADR-0008** — No third-party JavaScript (self-hosted/first-party JS only)
- **ADR-0009** — Prefer existing tools over custom code
- **ADR-0011** — Owner controls everything (no external service lock-in)

The target audience is non-technical small business owners. Setup must be fully automated by a skill.

## Options Evaluated

### A. JavaScript / Client-Side Search

These solutions build a search index at build time and run queries entirely in the browser — no server or API required.

#### 1. Pagefind (CloudCannon) — Recommended

| Attribute | Detail |
|---|---|
| **How it works** | Post-build CLI indexes static HTML output, generates compressed index chunks. Browser loads only the chunks needed for each query. |
| **Astro support** | First-class. Official `astro-pagefind` community integration. Also works as a post-build CLI step (`npx pagefind --site dist`). |
| **Bundle size** | ~6 KB base JS. Index chunks lazy-loaded per query (~2-5 KB per chunk for small sites). |
| **Search quality** | Full-text search with word stemming, substring matching, filtering, and content weighting. Supports `data-pagefind-*` attributes for fine-grained control. |
| **Pricing** | Fully free and open source (MIT license). |
| **Self-hosted** | Yes — everything lives in the site's build output. No external service. |
| **Maintenance** | Actively maintained by CloudCannon. Regular releases since 2022. |
| **Setup complexity** | Very low. Add integration, rebuild, done. No API keys, no accounts, no configuration required. |

**Pros:**
- Zero external dependencies — index is part of the build output
- Designed specifically for static sites
- Tiny footprint (~6 KB JS + lazy-loaded chunks)
- Works offline once page is loaded
- Excellent Astro integration
- Content weighting lets us prioritize page titles over body text
- Supports filtering (by tag, category, content type)
- Accessible default UI with keyboard navigation
- MIT licensed

**Cons:**
- JavaScript must be loaded for search (violates zero-JS-by-default philosophy, but only on the search page)
- No fuzzy matching (typo tolerance is limited)
- Index regenerated on every build (trivial for small sites, seconds for 50 pages)

#### 2. Fuse.js

| Attribute | Detail |
|---|---|
| **How it works** | Client-side fuzzy search library. Requires a JSON index built at build time. Loads full index into memory. |
| **Bundle size** | ~25 KB minified + gzipped. Full JSON index also loaded upfront. |
| **Search quality** | Excellent fuzzy matching and typo tolerance. No stemming or full-text features. |
| **Pricing** | Free and open source (Apache 2.0). |

**Pros:**
- Best-in-class fuzzy/typo-tolerant matching
- Simple API, easy to integrate
- Well-maintained, widely used

**Cons:**
- Loads entire index into memory on page load (problematic as sites grow)
- No built-in UI — must build custom search interface
- 25 KB library + full index = heavier than Pagefind for equivalent content
- No Astro integration — requires custom build step and component
- No content weighting or filtering without custom code

#### 3. Lunr.js

| Attribute | Detail |
|---|---|
| **How it works** | Client-side full-text search with TF-IDF ranking. Pre-built index loaded at page load. |
| **Bundle size** | ~8 KB minified + gzipped. Pre-built index can be large. |
| **Pricing** | Free and open source (MIT). |

**Pros:**
- Good full-text search with stemming and TF-IDF ranking
- Small library size
- Mature and battle-tested

**Cons:**
- Largely unmaintained (last significant update ~2020)
- Loads full serialized index upfront (no chunking)
- No built-in UI
- No Astro integration
- Index size grows linearly with content

#### 4. MiniSearch

| Attribute | Detail |
|---|---|
| **How it works** | Lightweight client-side full-text search. In-memory index. |
| **Bundle size** | ~7 KB minified + gzipped. |
| **Pricing** | Free and open source (MIT). |

**Pros:**
- Very small library
- Good search quality with fuzzy matching, prefix search, field boosting
- Actively maintained
- Fast indexing and search

**Cons:**
- In-memory index (no chunked loading)
- No built-in UI
- No Astro integration
- Less ecosystem/community than Pagefind or Fuse.js

#### 5. FlexSearch

| Attribute | Detail |
|---|---|
| **How it works** | High-performance client-side search with encoder-based tokenization. |
| **Bundle size** | ~6 KB (light build) to ~22 KB (full). |
| **Pricing** | Free and open source (Apache 2.0). |

**Pros:**
- Extremely fast search performance
- Multiple encoder options (balance speed vs. quality)
- Small core bundle

**Cons:**
- API has changed significantly between versions (stability concern)
- Documentation quality is inconsistent
- No built-in UI, no Astro integration
- In-memory index

#### 6. Orama (formerly Lyra)

| Attribute | Detail |
|---|---|
| **How it works** | Full-text search engine that runs in the browser or server. Supports vector search, facets, and typo tolerance. Also offers a hosted cloud service. |
| **Bundle size** | ~40-45 KB minified + gzipped (heavier due to feature richness). |
| **Pricing** | Open source (Apache 2.0) for self-hosted. Cloud tier has free plan (limited) and paid plans. |
| **Astro support** | Official `@orama/plugin-astro` integration available. |

**Pros:**
- Feature-rich (facets, filters, typo tolerance, vector search)
- Official Astro plugin
- Active development and growing community
- Supports geosearch (useful for local businesses)

**Cons:**
- Significantly heavier than Pagefind (~45 KB vs ~6 KB)
- Cloud features push toward vendor dependency
- Over-engineered for small business sites with 5-50 pages
- In-memory index (no chunked loading like Pagefind)

### B. API / Hosted Search

These solutions require an external service to handle search queries.

#### 7. Algolia

| Attribute | Detail |
|---|---|
| **How it works** | Hosted search API. Records pushed to Algolia's cloud, queries hit their API. |
| **Bundle size** | InstantSearch.js ~40 KB + API client ~10 KB. |
| **Pricing** | Free tier: 10,000 searches/month + 10,000 records. Paid plans from $1/1,000 searches. |

**Pros:**
- Best-in-class hosted search experience
- Typo tolerance, faceting, analytics, A/B testing
- Extensive documentation and SDKs

**Cons:**
- **Third-party JavaScript** — violates ADR-0008
- **External service dependency** — violates ADR-0011 (owner doesn't control the search infrastructure)
- Requires API key management
- Free tier limits may not be sufficient for popular sites
- Heavy client-side bundle (~50 KB)
- Overkill for 5-50 page sites

#### 8. Meilisearch (Cloud)

| Attribute | Detail |
|---|---|
| **How it works** | Open-source search engine. Self-hosted or Meilisearch Cloud. |
| **Pricing** | Self-hosted: free. Cloud: free tier (10,000 documents, 10,000 searches/month), paid from $30/month. |

**Pros:**
- Open source (MIT)
- Excellent search quality with typo tolerance
- Can self-host for full control

**Cons:**
- Self-hosting requires a server (not compatible with static Cloudflare Pages)
- Cloud version is a third-party dependency
- Requires API key management
- Excessive for small static sites

#### 9. Typesense (Cloud)

| Attribute | Detail |
|---|---|
| **How it works** | Open-source search engine. Self-hosted or Typesense Cloud. |
| **Pricing** | Self-hosted: free. Cloud: starts at ~$30/month. |

**Pros/Cons:** Similar to Meilisearch — excellent search quality, but requires infrastructure that doesn't align with static-site, zero-dependency architecture.

#### 10. Cloudflare Workers + D1

| Attribute | Detail |
|---|---|
| **How it works** | Custom search API built on Cloudflare Workers with D1 (SQLite) for the index. FTS5 SQLite extension for full-text search. |
| **Pricing** | Workers free tier: 100K requests/day. D1 free tier: 5M rows read/day, 5 GB storage. |

**Pros:**
- Same vendor as hosting (Cloudflare) — no new third-party dependency
- Owner controls the infrastructure
- Could leverage Cloudflare Vectorize for semantic search in future
- Low latency (edge-deployed)

**Cons:**
- **Custom code** — violates ADR-0009 (build vs. buy)
- Requires building and maintaining a search indexer, API, and client
- D1's FTS5 support is limited compared to dedicated search engines
- Significantly more complex to implement and debug
- Non-trivial ongoing maintenance burden

## Decision Outcome

**Recommended: Pagefind** (Option 1) as the primary and default search solution.

### Why Pagefind

1. **Alignment with architecture** — Build-time indexing produces static files deployed alongside the site. No external services, no API keys, no runtime servers. The owner controls everything (ADR-0011).

2. **Minimal JavaScript impact** — The ~6 KB loader + lazy-loaded index chunks is the lightest viable option. JS only loads on the search page, preserving the zero-JS default on all other pages. This is the same pattern used for Turnstile on the contact page (ADR-0008 already permits page-scoped first-party JS).

3. **Astro ecosystem fit** — The `astro-pagefind` integration is well-maintained and widely used. Pagefind is the de facto standard for Astro static search, recommended in Astro's official documentation.

4. **Zero configuration for owners** — A skill can add the integration, create a `/search` page, and rebuild. No accounts, no API keys, no ongoing cost. The owner just gets a working search page.

5. **Appropriate scale** — Pagefind handles 5-50 page sites in milliseconds. Index generation adds <1 second to build time. Index chunks are typically <10 KB total for small sites.

6. **Progressive enhancement** — The search page can include a `<noscript>` fallback suggesting the visitor use the site navigation or an external search engine.

### Implementation as a Skill

A new `search` skill would:

1. Install `astro-pagefind` as a dependency
2. Add the Pagefind integration to `astro.config.ts`
3. Create a `/search` page with Pagefind's default UI (styled to match site theme)
4. Add a search icon/link to the site header navigation
5. Configure `data-pagefind-body` on content areas (exclude nav, footer, etc.)
6. Update CSP to allow the inline Pagefind script if needed
7. Rebuild and verify search works

### Consequences

- Good, because visitors can find content without relying on Google indexing
- Good, because no external service dependency — search works even if third-party services go down
- Good, because zero cost — no paid search API
- Good, because search index is generated automatically on every build
- Good, because the owner never needs to manage search infrastructure
- Good, because Pagefind's default UI is accessible and keyboard-navigable
- Neutral, because search page loads ~6 KB of JavaScript (acceptable, scoped to one page)
- Bad, because no typo tolerance / fuzzy matching (visitors must spell terms correctly)
- Bad, because search is not available until the page's JS loads (no server-side fallback)

### Future Considerations

- **Orama** could be offered as an alternative if owners need fuzzy matching or faceted search, at the cost of a larger bundle (~45 KB). This would be a configuration option, not the default.
- **Cloudflare Workers + D1** could be explored later for sites that grow beyond static search needs (e.g., searching product catalogs with 500+ items), but this should only be built if Pagefind proves insufficient for real users.

## Comparison Summary

| Option | Size | Self-Hosted | Astro Integration | Free | Setup Complexity | Best For |
|---|---|---|---|---|---|---|
| **Pagefind** | ~6 KB | Yes | Official community | Yes | Very low | Static sites (our use case) |
| Fuse.js | ~25 KB | Yes | None | Yes | Medium | Apps needing fuzzy search |
| Lunr.js | ~8 KB | Yes | None | Yes | Medium | Legacy projects |
| MiniSearch | ~7 KB | Yes | None | Yes | Medium | Lightweight client apps |
| FlexSearch | ~6-22 KB | Yes | None | Yes | Medium | Performance-critical apps |
| Orama | ~45 KB | Yes/Cloud | Official plugin | Partial | Low-Medium | Feature-rich search needs |
| Algolia | ~50 KB | No | Community | Partial | High | Large commercial sites |
| Meilisearch | ~15 KB client | Self/Cloud | None | Partial | High | Server-rendered apps |
| Typesense | ~15 KB client | Self/Cloud | None | Partial | High | Server-rendered apps |
| CF Workers+D1 | Custom | Yes | None | Yes | Very high | Custom search APIs |

## More Information

- [Pagefind documentation](https://pagefind.app)
- [astro-pagefind integration](https://github.com/shishkin/astro-pagefind)
- [Astro search recipes](https://docs.astro.build/en/recipes/search/)
- [Orama Astro plugin](https://docs.orama.com/open-source/plugins/plugin-astro)
