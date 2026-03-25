# Contact form setup

Set up a contact form that forwards messages to the site owner's email using Cloudflare Workers and Turnstile.

## Prerequisites

- Site deployed to Cloudflare Pages (`/anglesite:deploy` completed)
- Custom domain configured (`SITE_DOMAIN` in `.site-config`)

## What gets created

- `/contact` page — form with name, email, and message fields
- `/contact/thanks` — confirmation page shown after submission
- Cloudflare Worker — receives submissions, validates, and forwards via email
- Turnstile widget — spam protection (no CAPTCHAs)

## Configuration

These values are saved to `.site-config` during setup:

| Key | Purpose |
|---|---|
| `CONTACT_EMAIL` | Where form submissions are sent |
| `TURNSTILE_SITE_KEY` | Turnstile widget public key |
| `CONTACT_WORKER_URL` | Deployed Worker endpoint URL |

Secrets stored in Cloudflare (not in code):

| Secret | Purpose |
|---|---|
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile verification |
| `CONTACT_EMAIL` | Destination email (Worker env) |
| `SITE_DOMAIN` | Used as From address domain |

## How it works

1. Visitor fills out the form on `/contact`
2. Turnstile verifies the visitor is human (no interaction needed most of the time)
3. Form submits to the Cloudflare Worker
4. Worker validates input, verifies Turnstile token, checks rate limit
5. Worker sends email via MailChannels (free for Cloudflare Workers)
6. Visitor is redirected to `/contact/thanks`

No data is stored — messages are forwarded and discarded.

## Customization

- Edit `src/pages/contact.astro` to change the form fields or layout
- Edit `src/pages/contact/thanks.astro` to customize the confirmation message
- The Worker source is in `worker/contact-worker.js` if you need to modify the backend logic
