---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Recommend industry-specific SaaS tools over custom code

> **This is a default decision.** If you'd rather build a feature directly into your site (e.g., a custom booking system or product catalog), tell your Webmaster — they'll evaluate the trade-offs with you and update this record.

## Context and Problem Statement

Website owners often need capabilities beyond a static website — appointment booking, payment processing, email marketing, inventory management, online ordering, event registration, and more. The Webmaster agent must decide whether to build these features into the website or integrate with existing purpose-built services that the owner may already use.

## Decision Drivers

* Owners often already use industry tools (Square, Vagaro, Clio, Mindbody, etc.)
* Purpose-built SaaS tools handle compliance, security, and edge cases that custom code would need to reinvent
* Custom database features add ongoing maintenance, hosting costs, and security obligations
* The website's role is content and presence — not transaction processing
* Integration should be simple (links, embeds, structured data) rather than deep API coupling
* Tool recommendations should respect the SaaS selection criteria: reduce tools first, prefer open source, then affordable, then values-aligned, then ease of use

## Considered Options

* Recommend industry-specific SaaS tools and integrate via links and structured data
* Build custom features into the website (databases, booking systems, payment forms)
* Hybrid approach with lightweight custom code for simple needs

## Decision Outcome

Chosen option: "Recommend industry-specific SaaS tools", because purpose-built services handle compliance, security, payment processing, and operational complexity far better than custom website code. The website integrates with these tools through links, booking widgets, and structured data rather than reimplementing their functionality.

### Consequences

* Good, because owners use tools designed for their specific industry (a restaurant uses Square, not a custom ordering system)
* Good, because compliance and security are handled by specialists (PCI DSS for payments, HIPAA for healthcare, etc.)
* Good, because the website stays static — no server-side code, databases, or session management to maintain
* Good, because existing tools the owner already uses are integrated rather than replaced
* Good, because 67 industry-specific guides in `docs/smb/` provide curated tool recommendations for each business type
* Bad, because the owner may pay for multiple SaaS subscriptions
* Bad, because integration is shallow (links and embeds) rather than deeply customized

### Confirmation

During the `/anglesite:start` design interview, the agent asks what tools the owner already uses and records them in `.site-config` as `EXISTING_TOOLS`. The agent then reads the relevant `docs/smb/{type}.md` guide to recommend complementary tools and integration approaches.

## Pros and Cons of the Options

### Recommend industry-specific SaaS tools

* Good, because tools are purpose-built for each industry's needs
* Good, because compliance is handled by the service provider
* Good, because payment processing stays with PCI-compliant providers
* Good, because no custom backend code to maintain or secure
* Good, because the owner can switch tools without changing the website architecture
* Neutral, because some owners pay for multiple subscriptions (but they likely already do)
* Bad, because integration depth is limited to links, embeds, and structured data

### Build custom features into the website

* Good, because tightly integrated with the website design
* Good, because no external service dependencies
* Bad, because reinvents solved problems (booking, payments, inventory)
* Bad, because requires a server-side runtime, database, and ongoing maintenance
* Bad, because creates security obligations (storing customer data, handling payments)
* Bad, because the Webmaster agent would need to maintain and debug custom application code
* Bad, because violates the static-site architecture — moves from Cloudflare Pages to a full application host

### Hybrid approach with lightweight custom code

* Good, because covers simple needs (contact forms, basic data collection) without full SaaS
* Good, because Cloudflare Workers can handle serverless functions
* Neutral, because appropriate for contact forms but not for booking, payments, or inventory
* Bad, because the boundary between "lightweight" and "full application" is blurry
* Bad, because even simple custom code requires ongoing security review

## More Information

The SaaS selection criteria, applied in order:

1. **Tool reduction** — Can an existing tool handle this? Exhaust what the owner already has.
2. **Open source** — Prefer open-source solutions (Cal.com over Calendly).
3. **Free or affordable** — Free tiers matter for individuals and organizations with limited budgets.
4. **Values-aligned** — Federated services, nonprofits, co-ops, B-Corps over purely commercial.
5. **Ease of use** — A polished commercial tool that the owner actually uses beats unused open-source software.

Contact forms are the one feature built into the website itself, using a Cloudflare Worker backend for processing and either a honeypot field or Cloudflare Turnstile for spam protection.
