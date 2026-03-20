---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Gate deployments behind mandatory security scans

> **This is a default decision — and a strong one.** The scan allowlist can be updated to permit specific scripts or intentional public contact info, but the scans themselves should not be disabled. If you need to adjust what the scans check for, tell your Webmaster.

## Context and Problem Statement

The Webmaster agent has direct access to deploy a website to production via Wrangler CLI. A single mistake — an email address left in HTML, an API key in source, a tracking script added during development — could expose the owner's private data or compromise their site's security. The deployment pipeline needs a hard gate that prevents these mistakes from reaching production, regardless of whether the agent or the owner requests the deploy.

## Decision Drivers

* Customer PII (emails, phone numbers) must never appear in production HTML
* API tokens and secrets must never ship in built output or source files
* No unauthorized third-party scripts in production
* The CMS admin interface must never be accessible in production
* Scans must be automated — cannot rely on manual review
* Failed scans must block deployment with no override mechanism

## Considered Options

* Mandatory pre-deploy scan script (hard gate)
* Optional linting with warnings
* CI/CD pipeline checks (GitHub Actions)
* Manual review before deploy

## Decision Outcome

Chosen option: "Mandatory pre-deploy scan script (hard gate)", because it runs four automated checks before every deployment and blocks the deploy if any check fails. There is no override, no `--force` flag, and no exception — the issue must be fixed before the site goes live.

### Consequences

* Good, because PII leaks are caught before they reach the public internet
* Good, because exposed tokens are detected in source, build output, and public assets
* Good, because unauthorized third-party scripts cannot slip into production
* Good, because Keystatic admin routes are guaranteed to stay out of production builds
* Good, because the scan is automated and runs on every deploy — no human judgment required
* Good, because the no-override policy means security is not a suggestion
* Bad, because legitimate email addresses or phone numbers displayed intentionally (e.g., a public contact page) will trigger the PII scan and require the owner to confirm they are intentional
* Bad, because adding a new legitimate third-party script (e.g., Cloudflare Turnstile) requires updating the scan's allowlist

### Confirmation

The `scripts/pre-deploy-check.sh` script runs before `npx wrangler pages deploy`. The `/anglesite:deploy` skill invokes these checks as a mandatory step. A PreToolUse hook in `hooks/hooks.json` provides an additional enforcement layer.

## Pros and Cons of the Options

### Mandatory pre-deploy scan script (hard gate)

Four checks, all required:

1. **PII scan** — greps `dist/` for email patterns (`@`) and phone patterns
2. **Token scan** — greps `dist/`, `src/`, `public/` for API key patterns (`pat[A-Za-z0-9]{14,}`, `sk-[A-Za-z0-9]{20,}`)
3. **Third-party script check** — greps `dist/` for `<script src=` tags not from `cloudflareinsights` or `_astro`
4. **Keystatic admin check** — finds any Keystatic routes in `dist/`

* Good, because automated, consistent, and non-bypassable
* Good, because catches issues at the last possible moment before production
* Good, because scan patterns are specific and produce few false positives
* Neutral, because intentional public contact info triggers PII scan (requires confirmation)
* Bad, because scan patterns must be maintained as new secret formats emerge

### Optional linting with warnings

* Good, because less friction in the deploy process
* Bad, because warnings are routinely ignored
* Bad, because a single skipped warning can expose PII or tokens
* Bad, because puts the burden of judgment on the agent, which may prioritize the owner's request to "just deploy it"

### CI/CD pipeline checks (GitHub Actions)

* Good, because industry-standard approach for automated checks
* Good, because checks run in a clean environment
* Bad, because requires a GitHub repository — Anglesite deploys via Wrangler CLI without Git integration
* Bad, because adds complexity and a GitHub dependency for non-technical owners
* Bad, because the owner cannot easily understand or troubleshoot CI failures

### Manual review before deploy

* Good, because a human can catch nuanced issues
* Bad, because unreliable — humans miss things, especially under time pressure
* Bad, because the Webmaster agent would need to present a diff for review, which is not meaningful to a non-technical owner
* Bad, because does not scale — every deploy requires active review

## More Information

The scan allowlist for third-party scripts currently permits only `cloudflareinsights` (Cloudflare Web Analytics) and `_astro` (Astro's built asset prefix). Adding a new legitimate script (e.g., Cloudflare Turnstile for CAPTCHA) requires updating the scan pattern and documenting the addition in `docs/security.md`.
