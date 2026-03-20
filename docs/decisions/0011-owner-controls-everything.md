---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# The website owner controls all code, content, domain, and hosting

> **This is a foundational decision.** The other defaults exist to serve this one — you should always be able to take your site and leave. All the other ADRs can change; this one is the reason they can.

## Context and Problem Statement

Website owners routinely lose control of their websites. A web designer holds the domain in their account. A website builder platform owns the content export format. A hosting provider makes migration painful. When the relationship with the service provider ends, the owner starts over. The Webmaster agent must build sites in a way that guarantees the owner — whether an individual, artist, nonprofit, business, or government office — can walk away at any time with everything.

## Decision Drivers

* The owner must be able to switch developers, agents, or platforms without losing anything
* Domain registration must be in the owner's name and account
* Content must be stored in standard, portable formats
* Code must be standard HTML/CSS/JS with no proprietary runtime
* Hosting account must belong to the owner
* No vendor lock-in at any layer of the stack
* The handoff to another developer must be straightforward

## Considered Options

* Owner controls everything (code, content, domain, hosting)
* Managed service model (agent controls infrastructure on owner's behalf)
* Platform-based approach (Squarespace, Wix, WordPress.com)

## Decision Outcome

Chosen option: "Owner controls everything", because the owner holds the Cloudflare account, the domain registration, the git repository with all source code and content, and can transfer any of these independently. The `docs/handoff.md` guide documents exactly how to transfer the site to another developer or platform.

### Consequences

* Good, because the owner can fire the Webmaster agent (or any developer) and keep everything
* Good, because the domain is registered in the owner's Cloudflare account — they hold the keys
* Good, because content is `.mdx` files in git — standard Markdown, readable by any tool
* Good, because the site is standard Astro/HTML/CSS — any web developer can maintain it
* Good, because Cloudflare Pages has no lock-in — the static `dist/` output can be hosted anywhere
* Good, because `docs/handoff.md` provides a complete transfer guide for the next developer
* Good, because git history preserves every change ever made to the site
* Bad, because the owner must maintain a Cloudflare account (mitigated by the agent handling operations)
* Bad, because maximum ownership means the owner is ultimately responsible for renewals and account security

### Confirmation

The `/anglesite:start` skill creates the Cloudflare account in the owner's name. Domain registration is done through the owner's Cloudflare account. All code and content live in a local git repository the owner controls. The `docs/handoff.md` file is scaffolded with every site and documents the full transfer process.

## Pros and Cons of the Options

### Owner controls everything

* Good, because zero lock-in — owner can leave at any time with all assets
* Good, because standard formats (HTML, CSS, Markdown, git) are universally portable
* Good, because domain in owner's account prevents disputes over ownership
* Good, because handoff documentation makes developer transitions smooth
* Good, because git history provides complete audit trail
* Neutral, because the owner must manage account credentials (passwords, 2FA)
* Bad, because more accounts to maintain (Cloudflare, domain registrar if separate)

### Managed service model

The agent or developer controls infrastructure, and the owner accesses it through them.

* Good, because simpler for the owner — one point of contact handles everything
* Good, because the agent can optimize infrastructure without owner involvement
* Bad, because the owner depends on the agent/developer for access to their own site
* Bad, because if the relationship ends, the owner may not have credentials or access
* Bad, because domain ownership disputes are common in this model
* Bad, because violates the principle that the owner should never be held hostage

### Platform-based approach (Squarespace, Wix, WordPress.com)

* Good, because all-in-one solution with no technical knowledge required
* Good, because built-in templates, hosting, and domain management
* Bad, because content is in proprietary formats — export is lossy or impossible
* Bad, because the platform controls the hosting, performance, and feature set
* Bad, because monthly fees are higher than the Anglesite approach (Cloudflare is free)
* Bad, because migration requires rebuilding the site from scratch
* Bad, because the platform can change terms, raise prices, or shut down

## More Information

Ownership spans four independent layers, each controlled by the owner:

| Layer | Owner controls | Can transfer to |
| --- | --- | --- |
| **Domain** | Cloudflare Registrar account | Any registrar (standard transfer process) |
| **Hosting** | Cloudflare Pages project | Any static host (Vercel, Netlify, any web server) |
| **Code** | Local git repository | Any developer (clone and continue) |
| **Content** | `.mdx` files in `src/content/` | Any Markdown-compatible system |

The `docs/handoff.md` guide walks through transferring each layer independently. The owner never needs to transfer all four at once — they might switch developers while keeping the same host, or switch hosts while keeping the same developer.
