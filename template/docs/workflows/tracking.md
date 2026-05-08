# Ad / analytics tracking pixels (Partytown)

Wrap Meta Pixel, Google Ads conversion tags, GA4, LinkedIn Insight, TikTok Pixel, Pinterest Tag, and X Pixel in [Partytown](https://partytown.builder.io/) so they run inside a web worker instead of blocking the main thread. Use this only for ad-attribution and conversion tracking — for plain traffic analytics, the site already ships Cloudflare Web Analytics (cookieless, on the main thread).

## When to run this

Run `/anglesite:tracking` when:

- The owner is running Facebook / Instagram, Google, LinkedIn, TikTok, Pinterest, or X ads and needs to attribute conversions.
- A marketer or agency has handed over a tracking ID (`G-…`, `AW-…`, a Meta Pixel ID, etc.).
- The site needs a retargeting pixel for ads that follow visitors who didn't convert.

Do **not** run it for:

- Plain traffic analytics — use `/anglesite:stats` instead. Cloudflare Web Analytics is faster, cookieless, and already wired up.
- Form-submit and signup conversions inside Anglesite — those are already counted in the `anglesite_events` dataset surfaced by `/anglesite:stats`.
- Heatmaps and session recording (Hotjar, Microsoft Clarity) — they need DOM access and can't safely run in Partytown.

## How it works

- **Partytown integration.** `@astrojs/partytown` ships a small loader that spawns a web worker on first paint. Each pixel is rendered as `<script type="text/partytown">…</script>`; the worker fetches and executes the script off the main thread.
- **Per-platform IDs.** Each platform has its own `TRACKING_*` key in `.site-config`. Setting any one of them turns the pixel on; removing the key turns it off.
- **CSP and pre-deploy scan.** `template/scripts/csp.ts` reads each `TRACKING_*` key and adds the matching loader domain (`connect.facebook.net`, `www.googletagmanager.com`, `snap.licdn.com`, `analytics.tiktok.com`, `s.pinimg.com`, `static.ads-twitter.com`) to both the CSP header and the pre-deploy script allowlist. Owners who run only Meta + GA4 don't widen their CSP to LinkedIn or TikTok.
- **Consent gating.** When `CONSENT_VERSION` is set in `.site-config`, every pixel is gated behind `data-consent="ads"` (or `"analytics"` for GA4) and the consent runtime promotes the script to `text/partytown` once the visitor accepts the matching category.

## Cost — the only real downside

Partytown adds a small loader that runs on first paint. With one pixel installed, the page is *heavier* than running the pixel inline. The break-even is roughly two pixels; at three (a common B2B mix of Meta + GA4 + LinkedIn) Partytown is a clear win on Largest Contentful Paint.

Don't install pixels speculatively — fewer pixels means a faster site.

## What it can't do

- **iOS Safari intelligent tracking prevention still applies.** Partytown moves scripts off the main thread; it does not change cookie scope or fingerprinting countermeasures. Conversion attribution on iPhone Safari will be lower than the ad platform's dashboard suggests.
- **Server-side conversions are out of scope.** Conversions API, Google Enhanced Conversions, and similar server-to-server flows need a Worker that signs payloads with a long-lived secret. Route those through `/anglesite:forms` or treat them as a follow-up.

## Configuration

| Key | Platform |
|---|---|
| `TRACKING_META_PIXEL_ID` | Meta Pixel (Facebook / Instagram Ads) |
| `TRACKING_GA4_ID` | Google Analytics 4 |
| `TRACKING_GOOGLE_ADS_ID` | Google Ads conversion tag |
| `TRACKING_LINKEDIN_PARTNER_ID` | LinkedIn Insight Tag |
| `TRACKING_TIKTOK_PIXEL_ID` | TikTok Pixel |
| `TRACKING_PINTEREST_TAG_ID` | Pinterest Tag |
| `TRACKING_X_PIXEL_ID` | X / Twitter Pixel |

Multiple keys are normal — owners often run two or three pixels concurrently. GA4 and Google Ads share `gtag.js`; the loader is emitted once even when both keys are set.

## Verifying the install

Each ad platform has its own validator:

| Platform | Where to check |
|---|---|
| Meta | Events Manager → Test Events |
| Google Ads / GA4 | [Google Tag Assistant](https://tagassistant.google.com/) or GA4 Realtime |
| LinkedIn | Campaign Manager → Account assets → Insight tag |
| TikTok | TikTok Ads Manager → Events → Web |
| Pinterest | Pinterest Business → Ads → Conversions → Pixel health |
| X | X Ads → Tools → Conversion tracking |

Conversion data shows up in each platform's dashboard within 30–60 minutes of the next deploy.
