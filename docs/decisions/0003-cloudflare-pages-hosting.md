---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use Cloudflare Pages for hosting and deployment

> **This is a default decision.** It can be revisited if it doesn't meet your goals. To change it, tell your Webmaster — they'll update this record, migrate your site to the new host, and mark this ADR as superseded.

## Context and Problem Statement

The website needs a hosting platform that is free (or near-free) for content-driven sites, provides global CDN distribution, automatic HTTPS, and can be deployed via CLI without requiring the owner to connect a GitHub repository. The platform should also offer DNS, domain registration, email routing, and analytics so the owner can manage everything in one place.

## Decision Drivers

* Free hosting with no traffic limits for static sites
* Global CDN with automatic HTTPS
* CLI deployment via Wrangler — no Git integration required
* Built-in domain registration at cost (no markup)
* Privacy-first analytics (no cookies, no personal data collection)
* Email routing for custom domain email forwarding
* Workers for serverless functions (contact forms, redirects)
* Non-technical owner can manage account with minimal guidance

## Considered Options

* Cloudflare Pages
* Vercel
* Netlify
* GitHub Pages
* Self-hosted (VPS)

## Decision Outcome

Chosen option: "Cloudflare Pages", because it provides free static hosting with a global CDN, CLI deployment via Wrangler without Git integration, at-cost domain registration, privacy-first analytics, email routing, and Workers — all under one account the owner controls.

### Consequences

* Good, because hosting is genuinely free with no bandwidth caps for static sites
* Good, because `npx wrangler pages deploy dist/` deploys without connecting a GitHub repo — critical for non-technical owners
* Good, because domain registration through Cloudflare is at ICANN cost with no markup
* Good, because Web Analytics is auto-injected, privacy-first (no cookies), and requires zero setup
* Good, because Email Routing provides free email forwarding without an external email service
* Good, because Workers enable contact form handling without a third-party form service
* Good, because the Cloudflare API allows the agent to manage DNS records programmatically
* Bad, because Cloudflare's dashboard can be overwhelming for a non-technical owner (mitigated by the agent handling all operations)
* Bad, because preview deployments are branch-based, which is less intuitive than Vercel's per-commit previews

### Confirmation

First deploy creates a Pages project via `npx wrangler pages project create`. Subsequent deploys use `npx wrangler pages deploy dist/`. The deploy skill verifies the site is accessible at the production URL after each deployment.

## Pros and Cons of the Options

### Cloudflare Pages

* Good, because free hosting with global CDN and automatic HTTPS
* Good, because Wrangler CLI deploy without Git integration
* Good, because at-cost domain registration (no markup)
* Good, because privacy-first Web Analytics (auto-injected, no cookies)
* Good, because Email Routing for free email forwarding
* Good, because Workers for serverless functions
* Good, because comprehensive API for DNS management
* Bad, because dashboard complexity for non-technical users
* Bad, because ecosystem lock-in risk if using many Cloudflare services

### Vercel

* Good, because excellent developer experience and per-commit previews
* Good, because tight Next.js integration
* Bad, because free tier has bandwidth limits (100GB/month)
* Bad, because encourages Git-based deployment (requires GitHub connection)
* Bad, because no built-in domain registration, email routing, or DNS management
* Bad, because analytics requires a paid plan

### Netlify

* Good, because friendly UI and easy Git-based deploys
* Good, because built-in form handling
* Bad, because free tier has bandwidth limits (100GB/month)
* Bad, because CLI deploy exists but Git integration is the primary workflow
* Bad, because no domain registration or email routing
* Bad, because analytics is a paid add-on

### GitHub Pages

* Good, because free and well-known
* Bad, because requires a GitHub repository (owner must have GitHub account)
* Bad, because no custom domain HTTPS without manual DNS configuration
* Bad, because no serverless functions, analytics, email routing, or DNS management
* Bad, because deployment tied to Git pushes — no CLI deploy

### Self-hosted (VPS)

* Good, because maximum control over hosting environment
* Bad, because requires server administration knowledge
* Bad, because ongoing cost ($5-20/month minimum)
* Bad, because no automatic HTTPS without Let's Encrypt setup
* Bad, because no CDN without additional service (Cloudflare proxy, etc.)
* Bad, because unreasonable operational burden for a content-driven site
