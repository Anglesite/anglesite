---
status: accepted
date: 2026-06-21
decision-makers: [Anglesite maintainers]
---

# Authenticate the IndieAuth owner with passkeys (`@dwk/webauthn`)

## Context and Problem Statement

ADR-0020 chose to compose `@dwk/indieauth` into `site-entry.js` for self-owned
IndieAuth. That package deliberately leaves **authentication and consent** to the
deployer via a required `approveAuthorization` hook — it mints no token until the
deployer proves the owner's identity and obtains consent. Anglesite had no such
mechanism, so the endpoint could not even construct. We need a way for a
non-technical owner to prove they are the owner, with no third-party identity
provider (ADR-0011).

## Decision

Authenticate the owner with **passkeys** via `@dwk/webauthn`, plus printable
single-use backup codes, all served from the owner's own Worker:

- `approveAuthorization` returns the consent page (a `Response`) until the
  request carries a signed owner-session cookie **and** a consent token bound to
  that exact authorization request; then it returns the `AuthorizationApproval`.
- A passkey assertion (or a backup code) at `POST /auth/consent` establishes the
  session and mints the request-bound consent token, which blocks consent-screen-
  skip deep links.
- `@dwk/webauthn`'s `/register/*` enrols any passkey, so the **first** enrolment
  is gated on a one-time `INDIEWEB_REG_TOKEN`; later ones on an owner session.
- Recovery has three layers: ≥2 passkeys, 10 single-use backup codes (SHA-256
  hashes in `OWNER_AUTH_DB`), and redeploy-root reset (rotate the token).

### Bindings added

`WEBAUTHN` (the first Durable Object in the template, with a `migrations` block),
`OWNER_AUTH_DB` (D1, backup-code hashes), and the `INDIEAUTH_SESSION_KEY` /
`INDIEWEB_REG_TOKEN` secrets (the deploy scan rejects them if committed).

## Consequences

- Good: identity and credentials stay entirely on the owner's Cloudflare account;
  no password to store; phishing-resistant.
- Good: the consent-token binding makes the OAuth consent step CSRF-safe.
- Bad: introduces the template's first Durable Object and a multi-step owner
  setup (enrol passkeys, save backup codes).
- Neutral: built on `@dwk/webauthn`, the least-mature package in the cohort
  ("exploratory, lowest priority") — acceptable because the owner controls the
  whole stack and can reset auth.

## More Information

Design: `docs/superpowers/specs/2026-06-21-passkey-indieauth-design.md`.
Plan: `docs/superpowers/plans/2026-06-21-passkey-indieauth.md`. Tracking:
Anglesite issue #363 (problem 2, IndieAuth slice). Micropub realignment (#2c)
depends on this and is tracked separately.
