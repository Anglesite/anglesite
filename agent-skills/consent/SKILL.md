---
name: consent
description: "Add a category-based GDPR/CCPA cookie consent banner that gates third-party loads"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm run build), Bash(grep *), Write, Read, Glob, Edit
metadata:
  author: "David W. Keith"
  version: "1.2.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Add a category-based privacy / cookie consent banner. Required before the site can load analytics, embeds, or ad-tech in regulated regions (EU/UK, California, increasingly more US states). Categories are: **necessary** (always on), **analytics**, **embeds**, **ads**. Third-party scripts and iframes are gated via a `data-consent` attribute pattern — they don't run until the visitor consents to their category.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](references/docs/decisions/0003-cloudflare-workers-hosting.md) — geo detection uses `request.cf.country` from the Worker entry
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — when sanctioned exceptions are added (booking, ecommerce, ads), this skill gates them properly

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt. If `false`, proceed without pre-announcing.

## When to use this skill

Run `/anglesite:consent` when the site adds anything that drops a cookie or loads third-party JS:

- Analytics beyond Cloudflare Web Analytics (Plausible, GA4, Fathom)
- Embeds (YouTube, Vimeo, Spotify, Twitter/X, Instagram, Maps with cookies)
- Ad networks (AdSense, Mediavine, etc.)
- Marketing pixels (Meta, LinkedIn, TikTok)

A site that only uses Cloudflare Web Analytics (cookieless, the default) does **not** need this banner.

## Step 0 — Check prerequisites

Read `.site-config`. If `CONSENT_VERSION` is already set, this is an update — tell the owner: "Consent is already set up. I can update categories, regenerate the banner, or refresh the privacy policy. What would you like to do?" Then jump to the appropriate step.

## Step 1 — Pick categories

Ask the owner which categories the site needs. Necessary is always on:

| Category | Examples on this site |
|---|---|
| **Necessary** (always on) | Login session, contact form CSRF, Turnstile |
| **Analytics** | Plausible, GA4, Fathom, Hotjar |
| **Embeds** | YouTube, Vimeo, Spotify, Maps, social embeds |
| **Ads** | AdSense, Mediavine, retargeting pixels |

Loop through each non-necessary category — the owner says yes/no. Save the enabled set to `.site-config`:

```
CONSENT_CATEGORIES=necessary,analytics,embeds
```

If only `necessary` is selected, tell the owner: "You don't need a consent banner — your site doesn't load anything that would require consent. Stop here." Exit gracefully.

## Step 2 — Pick the default policy

Ask: "How should consent default for first-time visitors?"

| Default | When |
|---|---|
| **Geo (recommended)** | Default-deny in EU/UK; default-allow elsewhere. Requires enabling the `CONSENT_GEO` flag on the site Worker (see Step 4). |
| **Strict** | Default-deny everywhere. Safest. Lowest measured analytics traffic. |

Save: `CONSENT_DEFAULT=geo` or `CONSENT_DEFAULT=strict`.

## Step 3 — Install the runtime and banner

Both files ship in the template — no copying needed. Verify they exist:

- `src/scripts/consent.ts` — runtime (cookie store, gating, category resolver)
- `src/components/ConsentBanner.astro` — banner component (banner UI + preferences modal)

If either is missing, copy from `references/template/src/scripts/consent.ts` and `references/template/src/components/ConsentBanner.astro` to the user's site.

### Wire the banner into the layout

Edit `src/layouts/BaseLayout.astro`:

1. At the top of the frontmatter, import the component and read enabled categories from `.site-config`:

   ```astro
   import ConsentBanner from "../components/ConsentBanner.astro";
   const consentCategories = (configContent.match(/^CONSENT_CATEGORIES=(.+)$/m)?.[1]?.trim() ?? "")
     .split(",").map(s => s.trim()).filter(Boolean);
   const consentDefault = configContent.match(/^CONSENT_DEFAULT=(.+)$/m)?.[1]?.trim() ?? "strict";
   const consentVersion = configContent.match(/^CONSENT_VERSION=(.+)$/m)?.[1]?.trim() ?? "1";
   ```

2. Just before `</body>`:

   ```astro
   {consentCategories.length > 1 && (
     <ConsentBanner
       categories={consentCategories}
       defaultPolicy={consentDefault}
       version={consentVersion}
     />
   )}
   ```

The banner self-mounts only when consent is configured. Sites that don't run `/anglesite:consent` are unaffected.

## Step 4 — Enable geo injection on the site Worker (only for `CONSENT_DEFAULT=geo`)

If the owner chose `geo`, turn on the `CONSENT_GEO` flag on the site Worker (`worker/site-entry.js`). The Worker uses Cloudflare's `HTMLRewriter` to inject `<meta name="cf-country" content="DE">` into every HTML response based on `request.cf.country`. The consent runtime reads this tag and applies EU-default-deny when the country is in the EEA/UK list.

Edit `wrangler.jsonc` and add (or extend) the `vars` block:

```jsonc
"vars": {
  "CONSENT_GEO": "true"
}
```

If `vars` already exists, just add the `CONSENT_GEO` key inside it. The setting takes effect on the next deploy.

For `CONSENT_DEFAULT=strict`, skip this step — the runtime defaults to deny without it.

## Step 5 — Set the consent version

Save to `.site-config`:

```
CONSENT_VERSION=1
```

Bump this integer whenever the categories change or the privacy policy is materially updated. The runtime treats a stored cookie with an older version as expired and re-prompts.

## Step 6 — Update the privacy policy

If `src/pages/privacy.astro` does not exist yet, copy `references/template/src/pages/privacy.astro` to the site.

Edit the page to reflect the enabled categories. The template has placeholders for each — keep the sections that match `CONSENT_CATEGORIES`, remove the rest. Update:

- Owner name (read from `.site-config:OWNER_NAME` — prompt once if missing: "What name should appear on the privacy policy?")
- Site domain (`SITE_DOMAIN`)
- Contact email (`CONTACT_EMAIL` if set)
- Last-updated date (today)
- Vendor list under each category — list every concrete vendor in use (e.g., "Plausible Analytics" under analytics, "YouTube embeds" under embeds)

Add a footer link to `/privacy` in `src/layouts/BaseLayout.astro` if not already present.

## Step 7 — Mark third-party loads as gated

For every existing third-party `<script>` and `<iframe>` on the site, replace the `src` with `data-src` and add `data-consent="<category>"`. The runtime swaps `data-src` → `src` once consent is granted.

Example — a YouTube embed becomes:

```html
<iframe data-src="https://www.youtube.com/embed/VIDEO_ID"
        data-consent="embeds"
        title="..." loading="lazy"></iframe>
```

A Plausible script becomes:

```html
<script data-src="https://plausible.io/js/script.js"
        data-consent="analytics"
        defer></script>
```

For inline scripts, use `type="text/plain"` plus `data-consent`:

```html
<script type="text/plain" data-consent="analytics">
  // ...analytics init...
</script>
```

The runtime swaps the type to `text/javascript` and re-executes when granted.

**Cloudflare Web Analytics is exempt** — it's cookieless and ships with the platform. Don't gate it.

**Turnstile is exempt** — it's necessary (CSRF / spam protection) and runs under the necessary category.

## Step 8 — Update CSP

The banner uses `'self'` only — no CSP changes needed for it. Each gated category may need new CSP entries when a vendor is enabled (booking, ecommerce, etc. — those skills already update CSP). Verify `public/_headers` allowlists the domains for each enabled category.

## Step 9 — Verify

```sh
npm run build
```

Tell the owner: "Consent banner is set up. Here's what to know:"

- First visit (or after a version bump): visitors see the banner. Nothing in your selected categories runs until they choose.
- "Accept all" enables every selected category. "Reject all" leaves only necessary on. "Preferences" opens a per-category toggle.
- The choice is stored in a `consent` cookie for 6 months, signed with `CONSENT_VERSION=<n>`. Bump that number when categories or vendors change to re-prompt everyone.
- The site Worker detects EU visitors (via `CONSENT_GEO=true`) so first-visit defaults match local law (only if you picked the geo policy).

Ask the owner if they'd like to preview it.

## Re-running the command

If `/anglesite:consent` is run again:

1. Read existing config from `.site-config`
2. Ask what they want to change — categories, default policy, version bump
3. Update files accordingly
4. Re-build to verify
