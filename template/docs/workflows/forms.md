# Custom forms

Build any number of forms (RSVP, lead capture, survey, callback request, waitlist) backed by a single Cloudflare Worker. Companion to [contact](contact.md) — use `/anglesite:contact` for the single owner contact form, `/anglesite:forms` for everything else.

## Prerequisites

- Site deployed to Cloudflare Workers (`/anglesite:deploy` completed)
- Custom domain configured (`SITE_DOMAIN` in `.site-config`)
- Turnstile site key (created automatically if you've already used `/anglesite:contact`)

## What gets created

- `src/content/forms/<slug>.mdoc` — form definition (edit in Keystatic)
- `/forms/<slug>` — public form page (auto-rendered by `[slug].astro`)
- `/forms/<slug>/thanks` — confirmation page (used when no `redirectUrl` is set)
- `worker/forms-worker.js` + `worker/forms-wrangler.toml` — Cloudflare Worker
- `worker/forms.json` — generated form catalog (built before each deploy)

## Configuration

| `.site-config` key | Purpose |
|---|---|
| `FORMS_WORKER_URL` | Deployed forms-handler Worker endpoint |
| `TURNSTILE_SITE_KEY` | Turnstile widget public key (shared with contact form) |

Worker secrets (set via `npx wrangler secret put`):

| Secret | Purpose |
|---|---|
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile verification |
| `SITE_DOMAIN` | From-address domain for outbound mail |

## Built-in templates

| Template | Slug | Use for |
|---|---|---|
| RSVP | `rsvp` | Event sign-ups |
| Lead capture | `lead` | Quote requests, prospect intake (UTM passthrough included) |
| Survey | `survey` | Mixed-format opinion gathering (radio / checkbox / 1–5 scale) |
| Callback request | `callback` | "Call me back" forms with preferred-time picker |

The templates ship as JSON in the Anglesite plugin (`skills/forms/templates/`); the skill copies the matching one into `src/content/forms/` as a Markdoc file the owner can then edit in Keystatic.

## Field types

`text`, `email`, `tel`, `textarea`, `number`, `select`, `radio`, `checkbox`, `scale` (1–5 radios), `date`, `hidden` (UTM passthrough). Each field defines its own validation rules (`required`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `options`). Server-side validation in the Worker mirrors the client-side rules — the Worker will reject any submission that fails validation, regardless of what the browser allowed.

## How it works

1. Visitor opens `/forms/<slug>`. The page renders fields from the matching record in `src/content/forms/`.
2. For lead-capture forms with hidden UTM fields, a small inline script copies `URLSearchParams` into the matching hidden inputs.
3. Visitor completes Turnstile (managed mode usually solves silently).
4. Submission POSTs to `FORMS_WORKER_URL/<slug>`.
5. Worker re-runs validation, verifies Turnstile, applies the per-form per-IP rate limit (default 60s), and forwards via MailChannels to the form's `destinationEmail`.
6. Visitor lands on `redirectUrl` if set, otherwise `/forms/<slug>/thanks` showing `successMessage`.

No data is stored unless and until the inbox feature ships (#194).

## Updating an existing form

Edit the form definition in Keystatic (or directly in `src/content/forms/<slug>.mdoc`), then run:

```sh
npm run ai-forms-build
npx wrangler deploy --config worker/forms-wrangler.toml
```

The build step regenerates `worker/forms.json` from the latest content; the deploy ships it with the Worker so server-side validation always matches.

## Customizing the design

The dynamic page lives at `src/pages/forms/[slug].astro`. Tweak markup or styles in `src/styles/` to match the site's look. Field-level styling hooks: `.form-field`, `.scale-options`, `.radio-option`, `.checkbox-option`.
