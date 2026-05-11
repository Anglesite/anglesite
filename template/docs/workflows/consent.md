# Privacy / cookie consent

Add a category-based GDPR/CCPA consent banner to the site. Required before loading any analytics, third-party embed, or ad-tech in regulated regions (EU/UK, California).

## When to run this

Run `/anglesite:consent` when the site adds anything that drops a cookie or loads third-party JS:

- Analytics beyond Cloudflare Web Analytics — Plausible, GA4, Fathom
- Embeds — YouTube, Vimeo, Spotify, Twitter/X, Instagram, Maps with cookies
- Ad networks — AdSense, Mediavine, retargeting pixels
- Marketing pixels — Meta, LinkedIn, TikTok

A site that uses only Cloudflare Web Analytics (the default — cookieless) does **not** need this banner.

## How it works

- **Categories.** Necessary (always on) plus any of analytics, embeds, ads.
- **Gating.** Third-party scripts and iframes use a `data-consent="<category>"` attribute. They don't run until the visitor consents to that category.
- **Default policy.**
  - `geo` — first-time visitors in the EU/UK default to deny; everywhere else defaults to allow. Requires setting `CONSENT_GEO=true` on the site Worker (`vars` in `wrangler.jsonc`) so `worker/site-entry.js` injects `<meta name="cf-country">`.
  - `strict` — first-time visitors default to deny everywhere. No Worker config needed.
- **Auditable.** Choices are stored in a `consent` cookie shaped `{ v: <version>, c: { analytics: true, ... }, t: <ms> }`. Bump `CONSENT_VERSION` in `.site-config` to invalidate every visitor's cookie and re-prompt them — do this whenever categories or vendors change materially.

## Configuration

These values are saved to `.site-config`:

| Key | Purpose |
|---|---|
| `CONSENT_CATEGORIES` | Comma-separated enabled categories (e.g. `necessary,analytics,embeds`) |
| `CONSENT_DEFAULT` | `geo` or `strict` |
| `CONSENT_VERSION` | Integer; bump to invalidate stored consent and re-prompt |

## Files

| File | Purpose |
|---|---|
| `src/scripts/consent.ts` | Cookie store, geo detection, script/iframe gating |
| `src/components/ConsentBanner.astro` | Banner UI + preferences modal |
| `src/pages/privacy.astro` | Privacy policy with the enabled categories |
| `worker/site-entry.js` | Injects `<meta name="cf-country">` from `request.cf.country` when `CONSENT_GEO=true` (only for `CONSENT_DEFAULT=geo`) |

## Marking third-party loads as gated

| Original | Gated |
|---|---|
| `<script src="https://...">` | `<script data-src="https://..." data-consent="analytics">` |
| `<script>...inline...</script>` | `<script type="text/plain" data-consent="analytics">...</script>` |
| `<iframe src="https://www.youtube.com/embed/X">` | `<iframe data-src="https://www.youtube.com/embed/X" data-consent="embeds">` |

The runtime swaps these into live elements once the matching category is granted. Cloudflare Web Analytics and Turnstile are always exempt — they're cookieless / necessary.

## Updating the policy

Whenever you add or remove a vendor under any category, edit `src/pages/privacy.astro` to keep the vendor list accurate, and bump `CONSENT_VERSION` in `.site-config`. The banner re-appears on next visit.

## Listening for consent changes

Other scripts can listen for the `consentchange` event to react when the visitor changes their mind:

```ts
document.addEventListener("consentchange", (event: Event) => {
  const choices = (event as CustomEvent).detail;
  if (choices.analytics) {
    // initialize analytics
  }
});
```

## Removing consent

To remove the banner from a site (e.g. after dropping all third-party loads):

1. Remove `CONSENT_CATEGORIES` from `.site-config`, or set it to `necessary` only.
2. Remove the `<ConsentBanner>` import and usage from `src/layouts/BaseLayout.astro`.
3. If `CONSENT_GEO` is set in `wrangler.jsonc` `vars`, remove it (or set it to `"false"`) so the site Worker stops injecting the `cf-country` meta tag.
