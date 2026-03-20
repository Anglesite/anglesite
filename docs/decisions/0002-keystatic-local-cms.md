---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use Keystatic for local content management

> **This is a default decision.** It can be revisited if it doesn't meet your goals. To change it, tell your Webmaster — they'll update this record, migrate your content, and mark this ADR as superseded.

## Context and Problem Statement

Website owners need to create and edit blog posts and page content without using a code editor or the command line. The CMS must store content in a format the owner actually owns (not locked in a remote database), integrate with Astro's content collections, and work without any external service dependency.

## Decision Drivers

* Content stored as local files (MDX/Markdoc) in git — owner owns the data
* Visual editing UI accessible to non-technical users
* No external API or database dependency
* Schema defined in code, validated at build time
* Dev-only — must not appear in production builds
* Compatible with Astro's content collection system

## Considered Options

* Keystatic (local mode)
* Decap CMS (formerly Netlify CMS)
* Sanity
* Strapi (self-hosted)
* Direct file editing via Claude Code

## Decision Outcome

Chosen option: "Keystatic (local mode)", because it stores content as local `.mdx` files in git, provides a visual editor at a dev-only route, and its schema integrates directly with Astro's content collections — all without any external service.

### Consequences

* Good, because content lives as `.mdx` files in the project — no export needed, no vendor lock-in
* Good, because the visual editor at `/keystatic` lets owners write posts without learning Markdown
* Good, because Keystatic only loads in dev mode — production builds are pure static HTML
* Good, because schema is defined in `keystatic.config.ts` alongside `src/content/config.ts`, keeping validation in sync
* Good, because git tracks all content history — full revision history without a CMS database
* Bad, because Keystatic requires React as a peer dependency (only loaded in dev mode, not shipped to production)
* Bad, because the owner must have the dev server running to use the visual editor

### Confirmation

Production builds (`npm run build` with `output: "static"`) must not include any Keystatic routes in the `dist/` directory. The pre-deploy scan checks for this and blocks deployment if Keystatic admin pages leak into the build.

## Pros and Cons of the Options

### Keystatic (local mode)

* Good, because content is plain `.mdx` files in git — maximum portability
* Good, because visual editor works at `/keystatic` during development
* Good, because no external service, API key, or account required
* Good, because schema defined in code alongside Astro content config
* Neutral, because requires React peer dependency (dev only)
* Bad, because owner must run dev server to use the editor

### Decap CMS (formerly Netlify CMS)

* Good, because mature project with large community
* Good, because stores content in git
* Bad, because requires a Git Gateway or Netlify Identity for authentication
* Bad, because editing UI is less polished than Keystatic
* Bad, because tight coupling to Netlify ecosystem despite being nominally independent

### Sanity

* Good, because excellent editing experience and real-time collaboration
* Good, because powerful query language (GROQ)
* Bad, because content stored in Sanity's cloud — not locally owned
* Bad, because requires a paid plan beyond the free tier for most business use
* Bad, because adds an external API dependency to every build

### Strapi (self-hosted)

* Good, because fully self-hosted, owner controls the data
* Good, because flexible content modeling
* Bad, because requires running a Node.js server and database — significant operational burden
* Bad, because far more complex than needed for a small content site
* Bad, because hosting cost for the CMS itself

### Direct file editing via Claude Code

* Good, because zero additional tooling
* Good, because the agent can create and edit Markdown files directly
* Bad, because the owner cannot edit content independently
* Bad, because no visual preview while editing
* Bad, because creates full dependency on the AI agent for every content change
