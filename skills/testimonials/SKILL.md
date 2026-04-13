---
name: testimonials
description: "Set up customer review collection, moderation, and display with star ratings"
user-invokable: false
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Write, Read, Glob
---

Set up customer testimonial collection and display. Called when the owner asks about reviews, testimonials, or social proof — not invoked directly.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Turnstile for spam protection on the review form (same Cloudflare vendor exception)
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — reviews are moderated by the owner, not auto-published

## What gets set up

1. **Review submission page** (`/review`) — name, star rating (1-5), review text, Turnstile spam protection
2. **Review Worker** — validates, verifies Turnstile, emails submission to owner for moderation
3. **Testimonials page** (`/testimonials`) — displays approved reviews with CSS-only star ratings
4. **AggregateRating JSON-LD** — for Google rich results (star ratings in search results)

## Step 1 — Deploy the review Worker

Same pattern as the contact form Worker. Store secrets:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY --name review-form
```

```sh
npx wrangler secret put CONTACT_EMAIL --name review-form
```

```sh
npx wrangler secret put SITE_DOMAIN --name review-form
```

Create `worker/review-wrangler.toml` if needed:

```toml
name = "review-form"
main = "review-worker.js"
compatibility_date = "2024-01-01"
```

Deploy:

```sh
npx wrangler deploy --config worker/review-wrangler.toml
```

Save the Worker URL to `.site-config` as `REVIEW_WORKER_URL`.

## Step 2 — Update CSP

Update `public/_headers` `form-action` to include the review Worker URL.

## Step 3 — Verify the pages

Build the site:

```sh
npm run build
```

Tell the owner: "Your review system is ready! Here's how it works:"

- Customers visit `/review` and submit their rating and review
- You get an email with the submission
- To approve a review, add it as a testimonial in Keystatic (or ask me to add it)
- Approved reviews appear on `/testimonials` with star ratings
- Google can show your star rating in search results

## Step 4 — Approving reviews

When the owner receives a review email, they can:
1. Open Keystatic and add a new testimonial entry
2. Or tell the agent: "Add this review: [paste email content]"

The agent creates a new file in `src/content/testimonials/` with the review data.

## Prompting the owner

During `/anglesite:check`, if there are few or no testimonials, suggest: "Would you like to set up a review page so customers can share their experience? It helps with Google search results too."

## Keep docs in sync

After setup, update:
- `docs/architecture.md` — note the /review and /testimonials pages
- `.site-config` — `REVIEW_WORKER_URL` value
