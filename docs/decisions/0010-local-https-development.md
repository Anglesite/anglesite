---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use local HTTPS that mirrors production

> **This is a default decision.** If local HTTPS causes issues on your machine, tell your Webmaster — they can fall back to plain HTTP on localhost and update this record.

## Context and Problem Statement

The development environment must be reliable enough for the Webmaster agent to preview, test, and demonstrate the site to the owner before deployment. Differences between development and production — particularly around HTTPS, hostnames, and security headers — cause bugs that only appear after deploying. The dev setup must also be simple enough for the agent to install and maintain automatically.

## Decision Drivers

* Dev environment should match production as closely as possible (HTTPS, same-origin behavior, security headers)
* The owner sees a real preview at a memorable hostname (e.g., `pairadocs.farm.local`), not `localhost:4321`
* Service Workers and secure cookies require HTTPS even in development
* Content Security Policy and other security headers should be testable locally
* The setup must be fully automated — the owner should not configure certificates or hostnames manually

## Considered Options

* Local HTTPS with mkcert and custom hostname
* Plain HTTP on localhost
* Tunneling service (ngrok, Cloudflare Tunnel)

## Decision Outcome

Chosen option: "Local HTTPS with mkcert and custom hostname", because it provides a development environment that mirrors production exactly — same HTTPS, security headers testable locally, and a memorable hostname the owner can bookmark. The `npm run ai-setup` script automates the entire setup: installing mkcert, generating certificates, configuring hostname resolution, and setting up port forwarding.

### Consequences

* Good, because the owner sees their site at `https://pairadocs.farm.local` — recognizable and professional
* Good, because HTTPS behavior (mixed content warnings, secure cookies, CSP) is testable before deploy
* Good, because the setup is fully automated by `scripts/setup.ts`
* Good, because mkcert creates locally-trusted certificates — no browser security warnings
* Good, because the same security headers in `public/_headers` apply in both environments
* Bad, because the setup requires installing mkcert and trusting a local CA (one-time, automated)
* Bad, because hostname resolution requires `/etc/hosts` or equivalent configuration (automated by setup script)
* Bad, because port forwarding from 443 to Astro's dev port adds a layer of complexity

### Confirmation

The `npm run ai-check` script verifies that mkcert is installed, certificates exist in `.certs/`, the hostname resolves correctly, and the dev server is accessible over HTTPS. The `/anglesite:fix` skill can diagnose and repair common issues (expired certs, stale hostname entries, port conflicts).

## Pros and Cons of the Options

### Local HTTPS with mkcert and custom hostname

* Good, because mirrors production environment exactly
* Good, because memorable hostname for the owner
* Good, because locally-trusted certificates — no browser warnings
* Good, because security headers and CSP testable locally
* Good, because fully automated setup
* Neutral, because requires one-time trust of mkcert's local CA
* Bad, because adds setup complexity compared to plain localhost

### Plain HTTP on localhost

* Good, because zero setup required — works immediately
* Good, because every developer is familiar with `localhost:4321`
* Bad, because HTTP vs HTTPS causes behavior differences (mixed content, secure cookies, CSP)
* Bad, because `localhost` looks unprofessional when showing the owner
* Bad, because some features (Service Workers) require HTTPS even in development
* Bad, because security headers cannot be meaningfully tested

### Tunneling service (ngrok, Cloudflare Tunnel)

* Good, because provides a real HTTPS URL accessible from anywhere
* Good, because useful for sharing previews with the owner remotely
* Bad, because requires an external service account and potentially a paid plan
* Bad, because URL changes on every session (without a paid plan)
* Bad, because adds network latency to every dev request
* Bad, because the dev server is exposed to the internet — security risk
