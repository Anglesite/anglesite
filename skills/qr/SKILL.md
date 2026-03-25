---
name: qr
description: "Generate QR codes with UTM tracking, shortlink redirects, and campaign-tagged URLs"
user-invokable: false
allowed-tools: Bash(npm run ai-qr), Bash(cat *), Write, Read, Glob
---

Generate branded QR codes for print materials and set up UTM-tracked shortlinks. Also generates campaign-tagged URLs for ad agencies or social media. Called when the owner asks about QR codes, print materials, or marketing links — not invoked directly.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — QR codes generated locally via `qrcode` npm package, no external APIs

## UTM best practices (enforced automatically)

All UTM values are automatically sanitized:
- **Lowercase only** — "Facebook" becomes "facebook" (prevents fragmented analytics)
- **Dashes for spaces** — "spring sale" becomes "spring-sale"
- **No .com suffixes** — "facebook.com" becomes "facebook"
- **No special characters** — only alphanumeric, dashes, underscores

### Parameter rules

| Parameter | What it is | What it is NOT | Examples |
|---|---|---|---|
| `utm_source` | The platform or origin | Not the channel type | `facebook`, `newsletter`, `qr`, `partner-site` |
| `utm_medium` | The channel type | Not the platform name | `print`, `email`, `paid-social`, `cpc`, `referral` |
| `utm_campaign` | The specific campaign | Not generic | `spring-flyer-2026`, `march-promo`, `table-tent` |
| `utm_content` | A/B test variant (optional) | | `headline-a`, `sidebar-ad`, `header-cta` |
| `utm_term` | Keyword or copy variant (optional) | | `pizza-near-me`, `free-trial` |

Valid medium values: `print`, `email`, `paid-social`, `organic-social`, `cpc`, `display`, `referral`, `affiliate`, `video`, `audio`, `sms`, `push`, `qr`

**Common mistakes the system prevents:**
- Using a platform name as the medium (e.g., medium="mailchimp" → should be medium="email", source="mailchimp")
- Same value for source and medium (redundant)
- Uppercase or inconsistent casing

## Step 1 — QR codes for print

When the owner asks for a QR code, determine what they need:

- **Homepage QR** — for business cards, window signs, general use
- **Page QR** — for menus, events, specific services
- **Multiple QRs** — for a print sheet with several codes

For each QR code, ask for a label (e.g., "table-tent", "business-card", "spring-flyer"). This becomes the `utm_campaign` value for tracking.

Generate with:

```sh
npm run ai-qr
```

For custom pages, the skill should read `.site-config` for `SITE_DOMAIN` and generate URLs with `buildQrUrl()`.

QR codes are saved as SVGs to `public/images/qr/`, branded with the site's primary color.

Tell the owner: "Your QR code is saved at `public/images/qr/[name].svg`. It's an SVG so it prints perfectly at any size — business card to poster."

## Step 2 — Shortlink redirects

For podcast-style URLs ("visit example.com/podcast" or "go to example.com/menu"):

1. Ask what the shortlink slug should be (e.g., `/podcast`, `/menu`, `/deal`)
2. Ask what page it should go to
3. Generate a `_redirects` line with UTM tracking baked in

Append to `public/_redirects`:

```
/podcast /?utm_source=podcast&utm_medium=audio&utm_campaign=episode-42 301
/menu /services?utm_source=qr&utm_medium=print&utm_campaign=menu-card 301
```

Tell the owner: "Anyone who visits example.com/podcast will be redirected to your homepage, and you'll see them in your analytics as 'podcast' traffic."

## Step 3 — Campaign URLs for ad agencies

When the owner (or their agency) needs UTM-tagged URLs for ads or social campaigns:

1. Ask for: platform (source), channel (medium), campaign name
2. Validate and auto-correct the parameters
3. Generate the tagged URL

Example interaction:
- Owner: "My ad agency needs a tracked link for our Facebook ad"
- Generate: `https://example.com?utm_source=facebook&utm_medium=paid-social&utm_campaign=march-promo`

If the values have issues (e.g., medium="facebook"), explain: "I adjusted 'facebook' to the source and set medium to 'paid-social' — this follows best practices so your analytics data stays clean."

## Step 4 — Viewing campaign results

Tell the owner: "You can see how each QR code, shortlink, and ad campaign is performing by running `/anglesite:stats`. It shows a breakdown of visits from each campaign."

The stats skill queries UTM parameters from Cloudflare Analytics and displays them using `formatCampaigns()`.

## Keep docs in sync

After generating QR codes or shortlinks, update:
- `docs/architecture.md` — note the QR codes in `public/images/qr/`
- `public/_redirects` — any new shortlink entries
