---
name: contact
description: "Set up a contact form with Cloudflare Workers and Turnstile"
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(npx astro check), Bash(grep *), Write, Read, Glob
disable-model-invocation: true
---

Set up a contact form that forwards messages to the owner's email. Uses a Cloudflare Worker backend with Turnstile spam protection. No data is stored — messages are forwarded and discarded.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — why Cloudflare (free CDN, Git integration, at-cost domains)
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why Turnstile is the only accepted third-party script (same vendor as hosting)
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the Worker runs on the owner's Cloudflare account

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Check prerequisites

Read `.site-config` and verify:
- `CF_PROJECT_NAME` is set (site has been deployed at least once)
- `SITE_DOMAIN` is set (custom domain configured)

If either is missing, tell the owner: "The contact form needs your site to be deployed first. Run `/anglesite:deploy` to set up Cloudflare, then come back here."

If `CONTACT_WORKER_URL` is already set in `.site-config`, the contact form is already configured. Ask the owner if they want to reconfigure it or if they need help with something else.

## Step 1 — Get the owner's contact email

Ask: "What email address should contact form messages go to?"

Save it to `.site-config` as `CONTACT_EMAIL=owner@example.com` using the Write tool (update the existing file).

Also add it to the PII allowlist so the pre-deploy scan doesn't flag it:
- If `PII_EMAIL_ALLOW` exists, append the email (comma-separated)
- If not, add `PII_EMAIL_ALLOW=owner@example.com`

## Step 2 — Set up Cloudflare Turnstile

Tell the owner: "To protect your contact form from spam, we'll use Cloudflare Turnstile — it's a free, privacy-friendly alternative to CAPTCHA. Let's set it up."

Guide them through the Cloudflare dashboard:

1. Open: `https://dash.cloudflare.com/?to=/:account/turnstile`
2. Click "Add site"
3. Site name: use the value from `SITE_NAME` in `.site-config`
4. Domain: use the value from `SITE_DOMAIN` in `.site-config`
5. Widget type: **Managed** (recommended — only shows a challenge when needed)
6. Click "Create"

The dashboard will show a **Site Key** and a **Secret Key**. Ask the owner to share both.

Save the site key to `.site-config` as `TURNSTILE_SITE_KEY=0x...` using the Write tool.

Tell the owner: "I'll need to save the secret key securely in Cloudflare — it won't be stored in your code."

## Step 3 — Deploy the Worker

Tell the owner: "I'm setting up the server that will receive contact form submissions and forward them to your email."

First, store the secrets:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY --name contact-form
```

Tell the owner to paste the secret key when prompted.

```sh
npx wrangler secret put CONTACT_EMAIL --name contact-form
```

Tell the owner to paste their contact email when prompted.

Set the site domain:

```sh
npx wrangler secret put SITE_DOMAIN --name contact-form
```

Tell the owner to paste their domain (e.g., `example.com`) when prompted.

Deploy the Worker:

```sh
npx wrangler deploy --config worker/wrangler.toml
```

After deployment, Wrangler prints the Worker URL (e.g., `https://contact-form.ACCOUNT.workers.dev`). Save it to `.site-config` as `CONTACT_WORKER_URL=https://...` using the Write tool.

## Step 4 — Update CSP for the Worker URL

The Content Security Policy in `public/_headers` needs to allow form submissions to the Worker URL.

Read `public/_headers`. Update the `form-action` directive from `'self'` to `'self' WORKER_URL` where `WORKER_URL` is the deployed Worker URL from Step 3.

## Step 5 — Verify

Build the site to confirm the contact page works:

```sh
npm run build
```

If the build succeeds, tell the owner: "Your contact form is ready! Here's what we set up:"

- A `/contact` page with a simple form (name, email, message)
- Turnstile spam protection (no annoying CAPTCHAs)
- Messages go directly to their email — nothing is stored
- A `/contact/thanks` page shows after submission

Tell the owner: "You can try it out on your preview site. Run `/anglesite:deploy` when you're ready to publish it."

Suggest adding a link to the contact page in their site navigation (header or footer).
