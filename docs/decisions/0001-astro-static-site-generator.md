---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use Astro as the static site generator

> **This is a default decision.** It can be revisited if it doesn't meet your goals. To change it, tell your Webmaster — they'll update this record, migrate the site, and mark this ADR as superseded.

## Context and Problem Statement

The Webmaster agent needs a framework to build websites for individuals, businesses, artists, nonprofits, and organizations. These sites are primarily content-driven (text, images, blog posts) and need to load fast on any device and connection. The framework must produce output that a non-technical owner can understand and that the agent can reliably generate, maintain, and debug.

## Decision Drivers

* Zero or near-zero client-side JavaScript for content pages
* First-class static site generation with pre-rendered HTML
* Built-in content collections with schema validation
* Image optimization (format conversion, resizing, EXIF stripping)
* Ecosystem of integrations (CMS, RSS, sitemaps) without custom code
* TypeScript support for build-time safety
* No vendor lock-in in the output (standard HTML/CSS/JS)

## Considered Options

* Astro
* Next.js
* Nuxt
* Eleventy (11ty)
* Hugo

## Decision Outcome

Chosen option: "Astro", because it is the only framework that ships zero client JavaScript by default while still providing a component model, content collections with Zod schemas, built-in image optimization, and a rich integration ecosystem.

### Consequences

* Good, because pages load instantly — no JavaScript bundle to parse on content pages
* Good, because content collections enforce schema at build time, catching errors before deploy
* Good, because Astro's image pipeline auto-generates WebP and strips EXIF metadata, reducing privacy risk and improving performance
* Good, because file-based routing maps directly to URL structure, making the site predictable for the agent and owner
* Good, because Markdoc integration allows rich content without the complexity of MDX components
* Good, because the output is plain HTML/CSS that any developer or host can work with
* Bad, because Astro's ecosystem is younger than Next.js or Hugo, so some edge-case plugins may not exist
* Bad, because interactive features (forms, toggles) require explicit opt-in to client-side frameworks via Astro Islands

### Confirmation

Every build (`npm run build`) must succeed and produce a `dist/` directory of static HTML files with zero `<script>` tags beyond Cloudflare Analytics. The `/anglesite:check` skill verifies this.

## Pros and Cons of the Options

### Astro

* Good, because zero client JS by default — best Lighthouse scores out of the box
* Good, because content collections with Zod validation catch schema errors at build time
* Good, because built-in image optimization handles WebP conversion and EXIF stripping
* Good, because file-based routing is intuitive and predictable
* Good, because Islands architecture allows selective hydration if interactivity is ever needed
* Neutral, because requires learning Astro's `.astro` component syntax
* Bad, because smaller community than Next.js means fewer third-party templates

### Next.js

* Good, because largest React ecosystem and community
* Good, because supports static export, SSR, and ISR
* Bad, because ships React runtime to the client even for static pages
* Bad, because App Router complexity is overkill for content sites
* Bad, because static export mode loses features (image optimization, middleware)

### Nuxt

* Good, because Vue ecosystem is approachable
* Good, because supports static generation
* Bad, because ships Vue runtime to the client
* Bad, because smaller ecosystem than Next.js with similar complexity

### Eleventy (11ty)

* Good, because zero client JS, similar to Astro
* Good, because extremely flexible templating
* Bad, because no built-in image optimization pipeline
* Bad, because no built-in content schema validation
* Bad, because configuration-heavy — more room for agent error

### Hugo

* Good, because fastest build times (Go binary)
* Good, because zero client JS
* Bad, because Go template syntax is harder for the agent to generate correctly
* Bad, because no npm ecosystem integration — can't use Keystatic or other JS-based tools
* Bad, because image processing is less capable than Astro's pipeline
