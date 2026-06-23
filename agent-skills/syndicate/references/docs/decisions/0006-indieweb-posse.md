---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Follow IndieWeb principles with POSSE workflow

> **This is a default decision.** It can be revisited if a different publishing workflow fits you better. To change it, tell your Webmaster — they'll update this record and adjust the site's syndication approach.

## Context and Problem Statement

Website owners publish content across many platforms — their website, Instagram, Facebook, Google Business Profile, Bluesky, and others. They need a strategy that treats their website as the authoritative source while still reaching audiences on social platforms. The approach must also make their content portable, discoverable, and resilient to any single platform's decline.

## Decision Drivers

* The owner's website is the canonical home for all content
* Content must be portable — not locked into any platform's format
* Social media presence is maintained without duplicating effort
* Structured markup enables content to be consumed by search engines, feed readers, and other services
* The approach must survive the shutdown of any single social platform
* Non-technical owners must be able to follow the workflow

## Considered Options

* IndieWeb with POSSE (Publish on Own Site, Syndicate Elsewhere)
* Social-first with website as secondary
* Cross-posting services (Buffer, Hootsuite)
* Website-only (no social presence)

## Decision Outcome

Chosen option: "IndieWeb with POSSE", because it establishes the owner's website as the authoritative source while still distributing content to social platforms. Microformats markup (h-card, h-entry, h-feed) makes content machine-readable, `rel="me"` links enable identity verification, and RSS provides universal syndication.

### Consequences

* Good, because the website is the single source of truth — content survives any platform shutdown
* Good, because microformats make content parseable by search engines, feed readers, and IndieWeb tools
* Good, because `rel="me"` links enable cross-platform identity verification (used by Mastodon, Bluesky, and others)
* Good, because RSS feed provides platform-independent content distribution
* Good, because syndication links (`u-syndication`) on posts create a verifiable trail from website to social copies
* Good, because the workflow is simple enough for non-technical owners: publish on site, share on social, paste the social URL back
* Bad, because POSSE requires a manual step (copying syndication URLs back to the post)
* Bad, because some owners may find it easier to post on social first and skip the website

### Confirmation

The `/anglesite:check` skill verifies microformats markup (h-card on the home page, h-entry on blog posts, h-feed on the blog listing), `rel="me"` links for configured social profiles, and RSS feed with `<link rel="alternate" type="application/rss+xml">` discovery.

## Pros and Cons of the Options

### IndieWeb with POSSE

* Good, because website is the canonical source — maximum ownership
* Good, because microformats are standard HTML attributes — no external service needed
* Good, because RSS is universally supported
* Good, because syndication links create verifiable provenance
* Good, because `rel="me"` enables decentralized identity verification
* Neutral, because requires the owner to paste syndication URLs back into posts
* Bad, because manual syndication step can be skipped or forgotten

### Social-first with website as secondary

* Good, because matches how most website owners currently operate
* Good, because lower friction — post where the audience already is
* Bad, because content is locked in platform-specific formats
* Bad, because platform algorithm changes can reduce visibility overnight
* Bad, because platform shutdown means content loss
* Bad, because the website becomes stale if social is the primary outlet

### Cross-posting services (Buffer, Hootsuite)

* Good, because automates distribution to multiple platforms
* Good, because scheduling and analytics in one place
* Bad, because adds a paid service dependency
* Bad, because posts may not originate from the website
* Bad, because formatting differences across platforms lead to awkward posts
* Bad, because another account to manage and pay for

### Website-only (no social presence)

* Good, because simplest workflow — publish once, done
* Good, because no social media accounts to maintain
* Bad, because ignores where most audiences discover websites and their owners
* Bad, because no audience building beyond organic search
* Bad, because unrealistic for most business types

## More Information

The blog post schema includes a `syndication` field (array of URLs) where the owner records where each post was shared. These render as `u-syndication` links in the h-entry markup. Keystatic's visual editor makes this a simple copy-paste operation for the owner.
