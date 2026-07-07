---
name: forms
description: "Build custom forms (RSVP, lead capture, survey, callback) with Keystatic-defined fields, Turnstile, and per-form rate limiting"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22). Deploy/provisioning steps require a Cloudflare account and Wrangler."
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(npx astro check), Bash(grep *), Write, Read, Glob
metadata:
  author: "David W. Keith"
  version: "1.4.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Build a custom form whose schema is owned by the site owner in Keystatic. Submissions hit a Cloudflare Worker that verifies Turnstile, applies a per-form rate limit, runs server-side validation matched to client-side rules, and forwards the message to the owner's email. Companion to `/anglesite:contact` — use this for any form beyond the single owner contact form (RSVPs, lead captures, quote requests, surveys, callback requests, waitlists).

## Architecture decisions

- [ADR-0003 Cloudflare Workers](references/docs/decisions/0003-cloudflare-workers-hosting.md) — Cloudflare hosting and Workers
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — Turnstile is the only accepted third-party script
- [ADR-0011 Owner ownership](references/docs/decisions/0011-owner-controls-everything.md) — the Worker runs on the owner's Cloudflare account

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt — say what you're about to do and why in plain language. If `false`, proceed without pre-announcing.

## When to use this skill versus `/anglesite:contact`

| Use case | Skill |
|---|---|
| Single contact form for the site owner | `/anglesite:contact` |
| Event RSVP, lead capture, quote request, callback request, survey, waitlist, anything multi-form | `/anglesite:forms` |

`/anglesite:contact` is purpose-built and lives at `/contact`. `/anglesite:forms` lets the owner define any number of forms in Keystatic, each rendered at `/forms/<slug>`.

## Step 0 — Check prerequisites

Read `.site-config`:

- `CF_PROJECT_NAME` must be set (deployed at least once)
- `SITE_DOMAIN` must be set (custom domain configured)

If either is missing, tell the owner: "The forms skill needs your site to be deployed first. Run `/anglesite:deploy` to set up Cloudflare, then come back."

If `FORMS_WORKER_URL` is already set, the forms backend is already deployed — skip to Step 5 to add a new form.

## Step 1 — Pick a template (or start blank)

Ask the owner what kind of form they want. Offer the four built-in templates:

| Template | Slug | Fields |
|---|---|---|
| **RSVP** | `rsvp` | Name, email, attending (yes/no/maybe), guest count, dietary notes |
| **Lead capture** | `lead` | Name, email, phone, company, message, hidden UTM passthrough |
| **Survey** | `survey` | Configurable mix of radio / checkbox / 1–5 scale questions |
| **Callback request** | `callback` | Name, phone, best time to call, topic |
| Custom | — | Build from scratch in Keystatic |

The templates live at `references/skills/forms/templates/<slug>.json`. Each is a JSON schema describing the form definition you'll write into the Keystatic `forms` collection.

Frame the choice plainly: "Which one fits? RSVP for an event, lead capture if you're collecting prospects, survey for opinions, callback if customers want you to call them back. Or we can build something custom."

## Step 2 — Get the destination email

Ask: "Where should submissions for this form go?"

Default suggestion: the value of `CONTACT_EMAIL` in `.site-config` if set. Allow a different address per form (e.g., events@ for RSVPs, sales@ for leads).

Save the destination per form in the Keystatic record (Step 5), not in `.site-config`. Add the address to `PII_EMAIL_ALLOW` in `.site-config` if not already present so the pre-deploy PII scan does not flag it.

## Step 3 — Set up Cloudflare Turnstile (if needed)

If `TURNSTILE_SITE_KEY` is already in `.site-config`, reuse it — the same widget works across every form.

Otherwise, walk the owner through creating a Turnstile widget (the same flow as `/anglesite:contact`):

1. Open `https://dash.cloudflare.com/?to=/:account/turnstile`
2. Click "Add site"
3. Site name: `SITE_NAME` from `.site-config`
4. Domain: `SITE_DOMAIN`
5. Widget type: **Managed**
6. Click "Create"

Save the site key as `TURNSTILE_SITE_KEY=0x...` in `.site-config`. Capture the secret key for Step 4 — it stays in Cloudflare, never in code.

## Step 4 — Deploy the forms Worker

Tell the owner: "I'm deploying the server that will receive form submissions, verify Turnstile, rate-limit by IP, and forward each one to the right email."

Store secrets:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY --name forms-handler
```

Tell the owner to paste the secret key when prompted.

```sh
npx wrangler secret put SITE_DOMAIN --name forms-handler
```

Paste the site domain (e.g., `example.com`).

Deploy:

```sh
npx wrangler deploy --config worker/forms-wrangler.toml
```

Capture the printed Worker URL (e.g., `https://forms-handler.ACCOUNT.workers.dev`) and save it as `FORMS_WORKER_URL=https://...` in `.site-config`.

## Step 5 — Add the form definition to Keystatic

The `forms` collection (`src/content/forms/*`) defines each form. Either:

1. Copy the chosen template from `references/skills/forms/templates/<slug>.json` into a new `src/content/forms/<slug>.mdoc` file as Keystatic-compatible frontmatter — or —
2. Open Keystatic (`/keystatic` in dev) and have the owner fill in the **Forms** collection.

Each form record carries:

- `title` — visible heading on the form page
- `slug` — URL path (rendered at `/forms/<slug>`)
- `description` — short blurb shown above the form
- `destinationEmail` — where this form's submissions go
- `successMessage` — text shown after submission, or
- `redirectUrl` — page to send the visitor to (mutually exclusive with `successMessage`)
- `rateLimitSeconds` — per-IP cooldown for this form (default 60)
- `fields[]` — an ordered list of field definitions (see below)

### Field types

| Type | Maps to | Validation |
|---|---|---|
| `text` | `<input type="text">` | optional `minLength`, `maxLength`, `pattern` |
| `email` | `<input type="email">` | RFC-shaped check |
| `tel` | `<input type="tel">` | optional `pattern` |
| `textarea` | `<textarea>` | optional `maxLength` (default 5000) |
| `number` | `<input type="number">` | optional `min`, `max` |
| `select` | `<select>` | one of `options[]` |
| `radio` | `<input type="radio">` group | one of `options[]` |
| `checkbox` | `<input type="checkbox">` group | subset of `options[]` |
| `scale` | 1–5 radio scale | integer in `[min, max]` |
| `date` | `<input type="date">` | ISO date |
| `hidden` | `<input type="hidden">` | passthrough only — used for UTM tags |

Every field has: `name`, `label`, `type`, `required` (bool), `placeholder?`, `helpText?`, `options?`, plus the type-specific validation keys.

### Hidden UTM passthrough (lead capture)

The `lead` template includes hidden fields for `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`. The page-side script reads `URLSearchParams` on load and writes matching values into the hidden inputs before submit. The Worker accepts (but does not require) these fields and includes them in the forwarded email.

## Step 6 — Verify the form schema and build

Run `npm run build` to compile the site. The dynamic form page at `src/pages/forms/[slug].astro` will render every record in the `forms` collection.

If the build succeeds, tell the owner: "Your form is live at `/forms/<slug>` once you deploy. Submissions go to <destinationEmail>."

## Step 7 — Update CSP for the Worker URL

Read `public/_headers`. Ensure `form-action` includes `FORMS_WORKER_URL`. If `CONTACT_WORKER_URL` is already listed, append the forms URL space-separated:

```
form-action 'self' https://contact-form.ACCOUNT.workers.dev https://forms-handler.ACCOUNT.workers.dev;
```

## Step 8 — Suggest next steps

- Add a navigation link to the form page (e.g., "RSVP" in the header)
- For lead capture, mention QR codes via `/anglesite:qr` to drive traffic with UTM tags
- For surveys, the inbox at `/anglesite:stats` will surface response counts once #194 lands

## Server-side rules mirror client-side

The Worker re-runs every `required`, `minLength`, `maxLength`, `pattern`, `min`, `max`, and `options` check from the form definition. Never rely on client-side validation alone — a malicious actor will skip the `<form>` and POST directly. The Worker reads the form schema (shipped alongside the Worker) and rejects any submission that fails validation with HTTP 400 and a JSON `{ errors: [...] }` body.

## Submissions inbox

The forms-handler Worker also persists every verified submission to Cloudflare D1 (one row per submission in the `submissions` table) whenever the `INBOX_DB` binding is present. Set up the binding (and a Keystatic inbox view of the submissions) by running `/anglesite:inbox` after this skill completes. See [ADR-0019](references/docs/decisions/0019-d1-inbox.md) for the storage decision. The inbox is shared with `/anglesite:contact` — every form on the site feeds the same triage queue, distinguished by `formSlug`.
