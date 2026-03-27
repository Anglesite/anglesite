# Domain Selection Guide

When the owner asks about choosing a domain name — what to pick, which TLD, whether .com matters, what to do on social media — use this guidance. Domain choice is the first and longest-lasting decision a new site owner makes. It deserves real thought.

This guide is opinionated toward user ownership and the open web, consistent with Anglesite's mission.

## Buying a domain

**Cloudflare is the default registrar.** Anglesite sites are hosted on Cloudflare Pages, so buying through Cloudflare keeps everything in one place: hosting, DNS, and domain registration. Cloudflare sells domains at cost — no markup, no surprise renewal increases.

However, not all TLDs are available through Cloudflare. When the owner's best TLD choice isn't available on Cloudflare (e.g., .coop, .eco), help them buy from a registrar that carries it, then either transfer the domain to Cloudflare or point its nameservers there. The domain skill (`/anglesite:domain`) handles DNS either way.

**Before searching for a domain**, read the owner's `BUSINESS_TYPE` from `.site-config` and check the recommendations below. The right TLD depends on who they are and what they're building.

## The .com question

The traditional advice to "always get a .com" is **partially true but mostly outdated**.

**What's real about .com's advantage:**
- Users are 3.8x more likely to assume a URL ends in .com — genuine muscle-memory risk for consumer-facing businesses
- .com domains earn more backlinks due to perceived trust — an indirect but real SEO effect
- Google treats all generic TLDs equally as a direct ranking factor, but .com's trust advantage affects click-through rates, which feed back into rankings indirectly

**What's mostly myth:**
- "They'll mistype your URL" — over 90% of web traffic arrives via search engines, bookmarks, or links, not typed addresses. Autocomplete handles the rest.
- .com's memorability advantage is largely neutralized by omniboxes and search-everything behavior

**The real danger zone** isn't .com vs. alternatives — it's spam-polluted TLDs like .xyz, .biz, and .info, which face firewall blocking and email deliverability problems regardless of how good the site is.

**Practical guidance:** For a general consumer-facing business, .com is the safe default. For niche, community, or mission-aligned businesses, a purposeful alternative TLD can be neutral or better. Never choose the cheapest available TLD just because the .com is taken.

## Mission-aligned TLDs

These TLDs have genuine governance and community accountability — they're not speculator plays. Recommend them when the owner's identity aligns.

### .coop

The gold standard for mission-aligned TLDs. Restricted to verified cooperatives and cooperative support organizations. Governed by the National Cooperative Business Association and the International Cooperative Alliance. Requires affirmation of cooperative membership to register.

**Not available on Cloudflare.** Register through a .coop-accredited registrar (e.g., Name.com, Gandi, or directly via identity.coop), then point nameservers to Cloudflare or transfer DNS management.

**Recommend when:** The owner is a cooperative, credit union, food co-op, worker-owned business, or cooperative support organization. If they're a co-op and don't have a .coop domain, this is the right conversation to have.

### .eco

Governed by a coalition of 50+ leading environmental nonprofits. Requires registrants to sign a sustainability pledge and create a public .eco profile. Carbon-neutral registry. Cost: $60-125/year.

**Recommend when:** The owner is an environmental organization, sustainability-focused business, climate consultancy, or any entity for whom environmental credibility is a core brand value.

### .org

Still the most widely recognized and trusted TLD for nonprofits, community organizations, and mission-driven groups. Available on Cloudflare.

**Recommend when:** The owner is a nonprofit, community organization, house of worship, food bank, youth organization, or similar mission-driven entity.

### .app / .dev

Google-managed, with HTTPS required by default via HSTS preloading. A concrete technical credibility signal. Available on Cloudflare.

**Recommend when:** The owner is building a software product, developer tool, or technical service.

### .io

Technically a ccTLD (British Indian Ocean Territory) but functions as a de facto gTLD for the tech industry. Organically adopted by developer communities. Available on Cloudflare.

**Recommend when:** The owner is a developer tool, API, or startup targeting technical audiences.

## Country-code TLDs (ccTLDs)

Country-code TLDs signal geographic focus. When the business serves a specific country or region, a ccTLD can outperform .com for local trust and search visibility.

**How Google treats ccTLDs:** Google uses ccTLDs as a strong geo-targeting signal. A `.co.uk` site gets a ranking boost for UK searches without any Search Console geo-targeting configuration. This is a real, measurable advantage for businesses that serve a single country.

### .us

Restricted to US citizens, residents, and organizations. Underused compared to .com but carries clear geographic intent. Available on Cloudflare.

**Recommend when:** The business is US-focused and the ideal .com is taken or expensive. Particularly strong for local government, civic organizations, and businesses where "American" is part of the value proposition. Less useful for businesses that may expand internationally.

**Caveat:** .us domains have no WHOIS privacy — ICANN policy requires accurate public contact info. Warn the owner about this before registering.

### .co.uk

The default business TLD in the United Kingdom. British consumers trust .co.uk as much as or more than .com for domestic businesses. Managed by Nominet. Available on Cloudflare.

**Recommend when:** The business operates in the UK and primarily serves British customers. A `.co.uk` signals "we're a proper British business" in a way that .com doesn't.

### Other notable ccTLDs

| ccTLD   | Country          | Notes                                                                 |
|---------|------------------|-----------------------------------------------------------------------|
| .ca     | Canada           | Restricted to Canadian presence; strong local trust                   |
| .com.au | Australia        | Requires ABN; very high trust for Australian businesses               |
| .de     | Germany          | Largest ccTLD by registration volume; strong domestic preference      |
| .fr     | France           | Requires EU presence; French consumers expect it for local businesses |
| .eu     | European Union   | Available to EU residents and organizations; pan-European scope       |
| .nz     | New Zealand      | Open registration; commonly used for NZ businesses                    |
| .in     | India            | Open registration; growing domestic preference                        |

**General rule:** If the business serves one country and doesn't plan to go international, the local ccTLD is often the better choice over .com. If they serve multiple countries or plan to expand, .com gives more flexibility. When in doubt, register both and redirect.

## TLDs to avoid

Steer the owner away from these regardless of price:

| TLD | Problem |
|-----|---------|
| .xyz | Heavy spam association, email deliverability issues |
| .biz | Widely perceived as low-trust, firewall blocking |
| .info | Spam-polluted, poor deliverability |
| .top | Dominant in phishing campaigns |
| .click, .link | Near-zero legitimate use |

The cost savings are never worth the deliverability and trust problems.

## Quick reference by user type

| User type | Recommend | Notes |
|-----------|-----------|-------|
| Cooperative, credit union, food co-op | .coop (first), .com (defensive) | Not on Cloudflare — help with external registration |
| Environmental org, sustainability business | .eco (first), .org or .com (defensive) | Check Cloudflare availability |
| General nonprofit | .org | Available on Cloudflare |
| General small business | .com if available and reasonable; else .net | Available on Cloudflare |
| Developer tool, API, tech startup | .app, .dev, or .io | All on Cloudflare |
| Anyone with a mission | Avoid .xyz, .biz, .info | Deliverability and trust problems |

## Domain as identity

A domain isn't just where the website lives — on the modern open web, it's who the owner *is* across multiple platforms simultaneously. This is the most underappreciated dimension of domain choice.

### Bluesky / AT Protocol

Bluesky lets any domain serve as your handle. `@sunrise-farm.coop` is a first-class Bluesky identity, visually distinct from `@sunrise-farm.bsky.social` in every mention and search result. Defaulting to `.bsky.social` cedes identity to the platform — the same mistake as not owning your own domain for your website.

**Always offer Bluesky handle verification after domain setup.** It requires only a DNS TXT record and takes minutes. This is the single highest-leverage action for making a domain visible in the social graph. See the Bluesky verification section in `/anglesite:domain` for the technical steps.

### Email

The original and most durable identity primitive. `hello@sunrise-farm.coop` predates every social platform, survives platform collapses, and is universally understood. Owning your domain means owning your email identity. This alone justifies the domain cost for most small businesses.

### Mastodon / ActivityPub fediverse

Identity is `@user@instance.domain`. Organizations running their own Mastodon instance at their domain make it part of every mention in the fediverse.

### IndieAuth

The owner's domain serves as their authentication token across the open web — log into supporting services by proving you own a URL, rather than via OAuth to a corporate provider. Supported by Anglesite's microformats and `rel="me"` link output.

## The movement context

Every system that uses domain-as-identity is federated, decentralized, or indie-web-aligned: Bluesky, Mastodon, Matrix, Nostr, email, IndieAuth. The systems that don't — Instagram, X/Twitter, TikTok, LinkedIn — are exactly the ones where the platform owns your identity and can revoke it.

Choosing a meaningful TLD isn't just branding. It's choosing what the owner's identity looks like across every open protocol that respects user ownership. One domain, coherent identity, portable across the open web.

## Bluesky setup

Bluesky is a federated social network built on the AT Protocol. It's aligned with Anglesite's values: user ownership, portability, and the open web. When the owner mentions social media, or during domain setup, ask if they're on Bluesky or interested in joining.

**If they're not on Bluesky yet:** "Have you heard of Bluesky? It's a social network where you own your identity — your domain becomes your handle, so people see @yourdomain.com instead of a platform username. It's free and growing fast. Want to set one up?"

If interested, walk them through:
1. Sign up at `https://bsky.app`
2. Once they have an account, use `/anglesite:domain bluesky` to verify their domain as their handle

**If they're already on Bluesky:** Check if they're still using a `.bsky.social` handle. If so, offer to verify their domain: "I see you're on Bluesky — want me to set up your domain as your handle? Right now you're @user.bsky.social, but you could be @yourdomain.com instead."

Save `BLUESKY_HANDLE=@domain.com` to `.site-config` after verification succeeds.
