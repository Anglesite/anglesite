# Email Configuration Design

**Issue:** [Anglesite/anglesite#101](https://github.com/Anglesite/anglesite/issues/101)
**Date:** 2026-04-14
**Status:** Approved

## Problem

Users who set up a custom domain via `/anglesite:domain` have no guided path to a real business mailbox. The domain skill handles generic email DNS setup but doesn't recommend a provider, pre-fill records, or tailor guidance to the user's ecosystem. This causes decision fatigue and stalls domain setup completion.

## Decision

Apple-first email configuration. A new model-only `email` skill handles provider recommendation, DNS pre-fill, and setup walkthroughs. The domain skill delegates to it. Non-Apple providers are covered in a reference doc.

### Why Apple-first

- Anglesite's modal user is an iPhone-first small business owner
- iCloud+ (personal) and Apple Business (registered businesses) share DNS infrastructure — one set of records to maintain
- Apple Business launched April 14, 2026: free tier, up to 500 users, IMAP/CalDAV compatible, cross-platform
- More Apple-specific features are planned going forward

## Architecture

### New files

| File | Purpose |
|------|---------|
| `skills/email/SKILL.md` | Model-only skill: recommendation flow, Apple path, DNS setup |
| `docs/email-setup.md` | Reference doc: non-Apple provider DNS records and setup links |

### Modified files

| File | Change |
|------|--------|
| `skills/domain/SKILL.md` | Replace email section (lines 69-98) with handoff to email skill |
| `CLAUDE.md` | Add email to model-only skills table, update skill count |

### Config keys

Written to `.site-config`:

| Key | Values | Purpose |
|-----|--------|---------|
| `EMAIL_PROVIDER` | `apple`, `other` | Provider choice, persisted to skip recommendation on return |
| `EMAIL_TIER` | `icloud-plus`, `apple-business` | Apple tier (only when provider is `apple`) |
| `SITE_EMAIL` | `name@domain.com` | Already exists, written after setup completes |

## Email skill flow

### First-time setup (no `EMAIL_PROVIDER` in `.site-config`)

**Step 1 — Education.** Surface `EMAIL_NOT_AUTOMATIC` education prompt if not already shown (check `EDUCATION_EMAIL_NOT_AUTOMATIC=shown` flag).

**Step 2 — Provider recommendation.** One routing question:

> "Do you use Apple devices (iPhone, Mac) for your business?"
> - Yes
> - No / mixed
> - I already have a provider I want to use

| Answer | Path |
|--------|------|
| Yes | Apple path (see below) |
| No / mixed | Read `${CLAUDE_PLUGIN_ROOT}/docs/email-setup.md`, recommend Fastmail as simplest cross-platform option, list others |
| Already have a provider | Ask which provider, look up DNS records from reference doc or provider's published requirements, add via Cloudflare API |

**Step 3 — Persist.** Write `EMAIL_PROVIDER` to `.site-config`.

### Returning users (`EMAIL_PROVIDER` already set)

Skip recommendation. Offer contextual actions: "Your email is set up with [provider]. Need to add another mailbox, update records, or switch providers?"

### Apple path — tier routing

One question:

> "Is this for you personally, or for a registered business?"
> - Personal
> - Registered business

| Answer | Tier | Product |
|--------|------|---------|
| Personal | `icloud-plus` | iCloud+ custom domain (requires existing iCloud+ subscription) |
| Registered business | `apple-business` | Apple Business (free, Managed Apple Accounts, directory/calendar, up to 500 users) |

### Apple path — DNS setup

**Pre-filled records (both tiers, added immediately via Cloudflare API):**

| Type | Name | Value | Priority | Proxied |
|------|------|-------|----------|---------|
| MX | `@` | `mx01.mail.icloud.com` | 10 | false |
| MX | `@` | `mx02.mail.icloud.com` | 10 | false |
| TXT (SPF) | `@` | `v=spf1 include:icloud.com ~all` | — | false |

**User-input records (copied from Apple's interface):**

| Type | Name | Value | Source |
|------|------|-------|--------|
| CNAME (DKIM) | provided by Apple | provided by Apple | iCloud+ settings or business.apple.com |
| TXT (verification) | `@` | `apple-domain-verification=<unique>` | iCloud+ settings or business.apple.com |

**Setup sequence:**

1. Check for existing SPF TXT record on the domain. If one exists (e.g., from MailChannels for the contact form), merge `include:icloud.com` into the existing record rather than creating a duplicate. Multiple SPF records break email delivery.
2. Add MX and SPF records via Cloudflare API — no user input needed.
3. Tell the user: "I've added the mail routing and spam prevention records. Now I need two values from Apple."
4. Walk through where to find them:
   - **iCloud+ tier:** iCloud.com > Custom Email Domain > your domain > DNS settings
   - **Apple Business tier:** business.apple.com > Domains > your domain > DNS settings
5. User pastes the DKIM CNAME name + value, and the verification TXT value.
6. Add those records via Cloudflare API.
7. Confirm all records. Suggest sending a test email in 15 minutes.
8. Persist `EMAIL_TIER` and `SITE_EMAIL` to `.site-config`. Update `docs/cloudflare.md`.

## Reference doc: `docs/email-setup.md`

Covers non-Apple providers. For each: what it is, who it's for, cost, DNS records (MX, SPF, DKIM, DMARC), and a link to the provider's setup wizard. Providers:

- **Fastmail** — recommended cross-platform alternative, privacy-focused, paid
- **Google Workspace** — for businesses already in the Google ecosystem
- **Proton Mail** — privacy-first, encrypted, free and paid tiers
- **Zoho Mail** — free tier for up to 5 users

The email skill reads this doc when the user picks "No / mixed" or names a specific provider, then uses the DNS records listed to add them via the Cloudflare API.

## Domain skill changes

Replace the current email section (lines 69-98 of `skills/domain/SKILL.md`) with a handoff to the email skill. The email skill inherits the Cloudflare API context (zone ID, token) already established by the domain skill.

## Out of scope

- Managing email accounts from within Anglesite
- Email sending (transactional, newsletters — covered by contact and newsletter skills)
- Deep integration with Apple Business APIs (account provisioning, directory management)
- Google Workspace or Microsoft 365 in the guided flow (docs only)

## Open questions (resolved)

- **Apple Business DNS records match iCloud+?** Yes — same MX servers, same SPF, same DKIM pattern. Confirmed via Apple's published documentation.
- **Apple ID per employee?** Apple Business uses Managed Apple Accounts. SSO supported via Google Workspace and Microsoft Entra ID federation.
- **Persist provider recommendation?** Yes — `EMAIL_PROVIDER` and `EMAIL_TIER` in `.site-config`.
