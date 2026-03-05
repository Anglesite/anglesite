# Architectural Decision Records

These are the default technical choices the Webmaster agent follows when building your website. They're starting points, not rules — every decision here can be revisited if it doesn't serve your goals.

**You own these decisions.** If you want to switch from system fonts to a custom typeface, add Google Analytics, use a different hosting provider, or change anything else — tell your Webmaster and update the relevant ADR. Superseded decisions stay in the record (marked `superseded by ADR-NNNN`) so there's a clear trail of what changed and why.

To change a decision: tell your Webmaster what you want to do differently. They'll update the ADR, adjust the site, and keep everything in sync.

ADRs follow the [MADR](https://adr.github.io/madr/) format.

## Index

- [ADR-0001](0001-astro-static-site-generator.md) — Use Astro as the static site generator
- [ADR-0002](0002-keystatic-local-cms.md) — Use Keystatic for local content management
- [ADR-0003](0003-cloudflare-pages-hosting.md) — Use Cloudflare Pages for hosting and deployment
- [ADR-0004](0004-vanilla-css-custom-properties.md) — Use vanilla CSS with custom properties for theming
- [ADR-0005](0005-system-fonts.md) — Use system font stacks instead of external font CDNs
- [ADR-0006](0006-indieweb-posse.md) — Follow IndieWeb principles with POSSE workflow
- [ADR-0007](0007-mandatory-pre-deploy-scans.md) — Gate deployments behind mandatory security scans
- [ADR-0008](0008-no-third-party-javascript.md) — No third-party JavaScript in production
- [ADR-0009](0009-industry-tools-over-custom-code.md) — Recommend industry-specific SaaS tools over custom code
- [ADR-0010](0010-local-https-development.md) — Use local HTTPS that mirrors production
- [ADR-0011](0011-owner-controls-everything.md) — The website owner controls all code, content, domain, and hosting
- [ADR-0012](0012-verify-before-presenting.md) — Verify changes work before presenting them to the owner
- [ADR-0013](0013-github-backup.md) — Use GitHub for offsite backup and issue tracking
