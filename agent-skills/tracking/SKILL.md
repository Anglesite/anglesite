---
name: tracking
description: "Embed Meta Pixel, Google Ads / GA4, LinkedIn, TikTok, Pinterest, or X conversion pixels via @astrojs/partytown (off the main thread), plus Microsoft Clarity analytics (heatmaps + session recording) on the main thread. All gated behind cookie consent."
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm install *), Bash(npm run build), Bash(npx astro check), Bash(grep *), Write, Read, Edit, Glob
metadata:
  author: "David W. Keith"
  version: "1.6.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Wrap advertising and analytics pixels (Meta Pixel, Google Ads conversion tag, GA4, LinkedIn Insight, TikTok Pixel, Pinterest Tag, X / Twitter Pixel) in [Partytown](https://partytown.builder.io/) so they run in a web worker instead of blocking the main thread. This is the sanctioned way to attach an SMB's existing ad accounts to the site without breaking Anglesite's "no third-party JS on the main thread" guarantee or its mandatory pre-deploy script scan.

Use this skill **only** for ad-attribution and conversion tracking. For traffic analytics, the site already ships Cloudflare Web Analytics (cookieless, on the main thread, wired up by `/anglesite:stats`) — a tracking pixel is not a substitute.

## Architecture decisions

- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — pixels installed by this skill are a sanctioned exception. They run inside Partytown's web worker, never on the main thread, and the loader domains are added to both the CSP and the pre-deploy script allowlist via `template/scripts/csp.ts`.
- [ADR-0007 Pre-deploy scans](references/docs/decisions/0007-mandatory-pre-deploy-scans.md) — the third-party script scan still runs against the built HTML; only domains tied to a configured `TRACKING_*` key in `.site-config` are allowed.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt. If `false`, proceed without pre-announcing.

## When to use this skill

Run `/anglesite:tracking` when the owner says any of:

- "I'm running a Facebook / Instagram ad and need to install the pixel"
- "Google Ads asked me to add a conversion tag"
- "My agency / marketer sent me a tracking ID"
- "I want to retarget visitors who didn't book / buy"
- "How do I see which ad campaigns send paying customers?"

Do **not** run this skill for:

- Plain traffic analytics — that's `/anglesite:stats` (Cloudflare Web Analytics)
- Form-submit or signup conversions inside Anglesite — those are already counted in the `anglesite_events` dataset surfaced by `/anglesite:stats`
- Hotjar heatmaps / session recording — Partytown can't safely run it (it needs main-thread DOM access) and its free tier (≈35 sessions/day) is too limited to recommend. Refuse and explain.

**Microsoft Clarity is supported, but opt-in only** — see "Supported platforms" below. Unlike Hotjar, it's genuinely free with no traffic caps, so when an owner wants heatmaps or session recording this skill installs it as a first-class **analytics** provider. It's the one tracker that runs on the main thread instead of in Partytown (session recording needs direct DOM access).

Two things keep Clarity opt-in rather than default:

- **Cloudflare Web Analytics is already the default** traffic analytics for every Anglesite site (cookieless, on the main thread, no extra account, surfaced by `/anglesite:stats`). Clarity is an *additive* behavioral layer — heatmaps + session replay — not a replacement for it.
- **Clarity requires a separate Microsoft account** (clarity.microsoft.com) that the owner likely doesn't already have. Don't surface it in the default platform checklist below and don't recommend it speculatively. Configure it **only when the owner explicitly asks** for heatmaps, session recording, or Clarity by name — then walk them through creating the project to get the ID.

## Cost — the only real downside

Partytown ships a small loader that runs on first paint to spawn the worker. With one pixel installed, the page is *heavier* than running the pixel inline. The break-even is roughly two pixels per page; once a third pixel is added (e.g. Meta + GA4 + LinkedIn — common for B2B), Partytown is a clear win on Largest Contentful Paint.

Tell the owner this on first run so they don't add pixels speculatively: "Each pixel you install collects data for one ad platform. There's no harm in only installing the ones you actually run ads on — fewer pixels means a faster site."

## What it can't do

State this plainly to the owner before installing anything:

- **iOS Safari intelligent tracking prevention still applies.** Partytown moves the script off the main thread; it does not change cookie scope or fingerprinting countermeasures. Conversion attribution on iPhone Safari will be lower than the ad platform's dashboard suggests.
- **Server-side conversions (Conversions API, Google Enhanced Conversions) are out of scope.** Those need a server endpoint that signs payloads with a long-lived secret. If the owner needs them, route them to `/anglesite:forms` (custom Worker) or surface as a follow-up.
- **Consent gating is mandatory in regulated regions.** If `CONSENT_VERSION` is set in `.site-config`, this skill will gate every pixel behind `data-consent="ads"` (marketing) or `data-consent="analytics"` and the runtime will only mount Partytown after consent is granted. If consent is not yet set up, this skill will run `/anglesite:consent` first when the site might serve EU/UK or California visitors.

## Supported platforms

| Platform | `.site-config` key | Forwarded global | Loader domain | Consent category |
|---|---|---|---|---|
| Meta Pixel (Facebook / Instagram Ads) | `TRACKING_META_PIXEL_ID` | `fbq` | `connect.facebook.net` | `ads` |
| Google Ads conversion tag | `TRACKING_GOOGLE_ADS_ID` | `gtag`, `dataLayer.push` | `www.googletagmanager.com` | `ads` |
| Google Analytics 4 (GA4) | `TRACKING_GA4_ID` | `gtag`, `dataLayer.push` | `www.googletagmanager.com` | `analytics` |
| LinkedIn Insight Tag | `TRACKING_LINKEDIN_PARTNER_ID` | `lintrk` | `snap.licdn.com` | `ads` |
| TikTok Pixel | `TRACKING_TIKTOK_PIXEL_ID` | `ttq.track`, `ttq.page`, `ttq.identify` | `analytics.tiktok.com` | `ads` |
| Pinterest Tag | `TRACKING_PINTEREST_TAG_ID` | `pintrk` | `s.pinimg.com` | `ads` |
| X / Twitter Pixel | `TRACKING_X_PIXEL_ID` | `twq` | `static.ads-twitter.com` | `ads` |
| Microsoft Clarity (heatmaps + session recording) | `TRACKING_CLARITY_PROJECT_ID` | — (main thread, **not** Partytown) | `www.clarity.ms` | `analytics` |

> **Microsoft Clarity is the one sanctioned main-thread exception.** Unlike the ad pixels above, Clarity is a free, privacy-friendly **analytics** tool (heatmaps + session replay) that auto-masks text and form inputs by default. Its session recording has to observe the live DOM, which Partytown's web worker can't expose — so Clarity **must** load on the main thread. **Do not "fix" this by wrapping it in Partytown**; that would break session replay. It is still gated behind the `analytics` consent category, and its loader domain (`www.clarity.ms`) is still added to the pre-deploy allowlist via `template/scripts/csp.ts`, exactly like every other tracker.

Each ID format is platform-specific — Meta uses a 15–16 digit number, GA4 starts with `G-`, Google Ads with `AW-`, LinkedIn with a partner ID number, TikTok with a `C` prefix, Pinterest with a 13-digit number, X with an alphanumeric tag, and Clarity uses a 10-character lowercase alphanumeric project ID. Don't validate format strictly; the platforms reject bad IDs at fire time and we don't want to block a legitimate format change.

## Step 0 — Check prerequisites

Read `.site-config`. If any `TRACKING_*` key is already set, this is an update — tell the owner: "I see {Meta Pixel / GA4 / …} is already installed. I can add another platform, change an ID, or remove a pixel. What would you like to do?" Then jump to the matching step.

## Step 1 — Pick platforms

Ask: "Which ad platforms are you actually running campaigns on right now? Don't install pixels speculatively — each one is data your visitors don't need to give away."

Surface the **ad pixels** from "Supported platforms" above (Meta, Google Ads, GA4, LinkedIn, TikTok, Pinterest, X) with checkboxes. Multi-select is normal: a typical SMB is on Meta + Google Ads, a B2B is on Google Ads + LinkedIn.

**Do not put Microsoft Clarity in this checklist.** Clarity is opt-in analytics that needs its own Microsoft account, and the site already has Cloudflare Web Analytics by default — so only add it when the owner explicitly asks for heatmaps or session recording (or names Clarity). If they do, set `TRACKING_CLARITY_PROJECT_ID` from the prompt below and follow the same install steps; otherwise skip it entirely.

For each chosen platform, ask for the tracking ID. Frame the question by what the owner will see in their ad dashboard:

- Meta: "It's the Pixel ID under Events Manager → Data Sources → your pixel. 15 or 16 digits."
- Google Ads / GA4: "Open Google Tag Manager or your GA4 admin. Looks like `G-ABC1234567` for GA4 or `AW-1234567890` for a Google Ads conversion tag."
- LinkedIn: "Campaign Manager → Account assets → Insight tag. The partner ID is 6–8 digits."
- TikTok: "TikTok Ads Manager → Assets → Events → Web. The pixel code starts with `C` followed by alphanumerics."
- Pinterest: "Pinterest Business → Ads → Conversions. 13-digit numeric ID."
- X: "X Ads → Tools → Conversion tracking. Alphanumeric pixel code."
- Microsoft Clarity: "Open clarity.microsoft.com → your project → Settings → Overview. The Project ID is a 10-character code (it's also embedded in the install snippet Clarity gives you)."

Save each one to `.site-config` using the **Write tool** (update the existing file). Multiple keys are fine — owners often run two or three pixels concurrently:

```
TRACKING_META_PIXEL_ID=1234567890123456
TRACKING_GA4_ID=G-ABC1234567
TRACKING_GOOGLE_ADS_ID=AW-9876543210
TRACKING_CLARITY_PROJECT_ID=abcde12345
```

If the owner only mentions Google Ads (no GA4), set `TRACKING_GOOGLE_ADS_ID` and leave GA4 unset — they share the same loader (`gtag.js`) but represent different conversion goals and are billed separately on the Google side. The skill will detect the shared loader and only emit it once at build time.

## Step 2 — Confirm consent posture

Read `CONSENT_VERSION` from `.site-config`.

- **Set** — consent banner is in place. Continue to Step 3; pixels will be gated behind `data-consent="ads"` (or `"analytics"` for GA4) and the consent runtime will mount Partytown after consent is granted.
- **Not set** — ask: "Will visitors from the EU, UK, or California ever see this site? If yes, we have to add a consent banner before installing tracking pixels — it's required by law there." If yes, run the `consent` skill non-interactively, picking categories `necessary, analytics, ads` and the geo default. If the owner says "US-only customers, no California" or similar, note the exposure but don't force consent — record `TRACKING_CONSENT_OPT_OUT=true` in `.site-config` so subsequent runs don't re-prompt.

If the owner is uncertain, default to running consent setup. The cost of a banner is small; the cost of an enforcement complaint is not.

## Step 3 — Install Partytown

Check `package.json` for `@astrojs/partytown`. If missing, install it:

```sh
npm install @astrojs/partytown
```

Open `astro.config.ts`. Add the import and integration. The `forward` array tells Partytown which globals tracking scripts call from the main thread (button clicks, form submits) so the worker can intercept and replay them. Build the array dynamically from the configured pixels — only include forwards for platforms the owner actually installed:

```ts
import partytown from "@astrojs/partytown";

// ...inside defineConfig({ integrations: [...] }):
partytown({
  config: {
    debug: false,
    forward: [
      // Add only the entries that match TRACKING_* keys in .site-config.
      // Multiple platforms can share `dataLayer.push` and `gtag` — list them once.
      "fbq",            // TRACKING_META_PIXEL_ID
      "gtag",           // TRACKING_GA4_ID or TRACKING_GOOGLE_ADS_ID
      "dataLayer.push", // TRACKING_GA4_ID or TRACKING_GOOGLE_ADS_ID
      "lintrk",         // TRACKING_LINKEDIN_PARTNER_ID
      "ttq.track", "ttq.page", "ttq.identify", // TRACKING_TIKTOK_PIXEL_ID
      "pintrk",         // TRACKING_PINTEREST_TAG_ID
      "twq",            // TRACKING_X_PIXEL_ID
    ],
  },
}),
```

Use the **Edit** tool to splice it into the existing `integrations: [...]` array. Don't replace the whole config.

**Do not add a Clarity entry to the `forward` array.** Microsoft Clarity runs on the main thread, not in Partytown, so it has no forwarded global — its inline snippet calls `clarity(...)` directly on the page. The `forward` array is only for Partytown-wrapped pixels.

## Step 4 — Add the pixel snippets to the layout

The pixels live in `src/components/TrackingPixels.astro` so that `BaseLayout`, `KioskLayout`, and `ImmersiveLayout` can all opt in by importing one component. Create the component (or edit if it exists). The frontmatter reads each `TRACKING_*` key from `.site-config` and a single `consentEnabled` flag, then renders one `<script type="text/partytown">` block per configured pixel.

Frontmatter scaffold:

```astro
---
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), ".site-config");
const config = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
const read = (key: string) => config.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();

const metaPixelId = read("TRACKING_META_PIXEL_ID");
const ga4Id       = read("TRACKING_GA4_ID");
const googleAdsId = read("TRACKING_GOOGLE_ADS_ID");
const linkedinId  = read("TRACKING_LINKEDIN_PARTNER_ID");
const tiktokId    = read("TRACKING_TIKTOK_PIXEL_ID");
const pinterestId = read("TRACKING_PINTEREST_TAG_ID");
const xId         = read("TRACKING_X_PIXEL_ID");
const clarityId   = read("TRACKING_CLARITY_PROJECT_ID");

// Both Google Ads and GA4 share gtag.js. Emit the loader once.
const gtagId = ga4Id ?? googleAdsId;

// When the consent banner is wired up, pixels start as `text/plain` so
// nothing fires until the visitor accepts. The consent runtime swaps the
// type to `text/partytown` for that category. Without consent, pixels run
// in Partytown directly on first paint.
const consentEnabled = !!read("CONSENT_VERSION");
const adsType        = consentEnabled ? "text/plain" : "text/partytown";
const analyticsType  = consentEnabled ? "text/plain" : "text/partytown";

// Microsoft Clarity is the exception: it must run on the MAIN THREAD (its
// session recording observes the live DOM, which Partytown's worker can't
// expose). So it promotes to `text/javascript`, not `text/partytown`, and
// it carries NO `data-partytown-type` hint. It's still gated behind the
// `analytics` category when consent is enabled.
const clarityType    = consentEnabled ? "text/plain" : "text/javascript";
---
```

Then drop in one block per platform from `references/docs/platforms/tracking-pixels.md`. The reference doc has the inline snippets verbatim (Meta, Google Ads/GA4, LinkedIn, TikTok, Pinterest, X, and Microsoft Clarity) — copy each block whose ID variable is non-empty. Skip blocks whose key isn't set; the conditional rendering keeps `dist/` clean. The Clarity block is the only one that renders with `type={clarityType}` and **no** `data-partytown-type` attribute, because it runs on the main thread.

Import and render the component once in `BaseLayout.astro`, just before `</head>`:

```astro
import TrackingPixels from "../components/TrackingPixels.astro";
// ...inside <head>:
<TrackingPixels />
```

Repeat the import in `KioskLayout.astro` and `ImmersiveLayout.astro` if those layouts are used and the owner wants tracking on those pages too. Skip kiosk pages by default — kiosk mode is usually internal-facing and shouldn't load ad pixels.

The `data-partytown-type="text/partytown"` attribute is what the consent runtime reads when it promotes a `text/plain` script back to a live tag — the runtime uses this hint to switch to `text/partytown` (so the pixel runs in the worker) instead of plain `text/javascript` (which would put it on the main thread, defeating the point).

## Step 5 — Update the consent runtime (only if consent is enabled)

If `CONSENT_VERSION` is set, open `src/scripts/consent.ts` and check whether it already promotes scripts to the type given in `data-partytown-type`. The shipped runtime (since the partytown-aware update) reads `el.dataset.partytownType` and uses it as the new `type` attribute when consent is granted; older runtimes hard-code `text/javascript` and will need a one-line change:

```ts
const newType = el.dataset.partytownType ?? "text/javascript";
el.setAttribute("type", newType);
```

If you patched the runtime, surface a one-line note so the owner knows: "I updated your consent runtime so tracking pixels move into Partytown's web worker once visitors accept marketing cookies." Don't dwell on it.

## Step 6 — Update the privacy policy

Open `src/pages/privacy.astro`. For each platform installed, add one line under the matching consent category. Example for the `ads` section:

> We use Meta Pixel, Google Ads conversion tracking, and the LinkedIn Insight Tag to measure how our advertising performs. These services may set cookies in your browser when you accept marketing cookies.

Bump `CONSENT_VERSION` in `.site-config` by one if consent is enabled — the consent runtime treats the existing cookie as expired and re-prompts visitors so they can review the new vendors.

## Step 7 — Verify

```sh
npx astro check
```

```sh
npm run build
```

The pre-deploy script scan reads the `TRACKING_*` keys and adds the corresponding loader domains (`connect.facebook.net`, `www.googletagmanager.com`, `snap.licdn.com`, `analytics.tiktok.com`, `s.pinimg.com`, `static.ads-twitter.com`, `www.clarity.ms`) to its allowlist via `template/scripts/csp.ts`. If the build succeeds and the scan passes, the install is correct. If the scan fails with "unauthorized third-party script", check that the keys in `.site-config` match the loader actually rendered into the HTML.

Tell the owner what's now in place:

- Pixels run in a web worker (off the main thread). The page stays interactive while they load.
- {If consent enabled} Pixels won't fire until visitors accept marketing cookies. EU/UK/California visitors default to "off"; everyone else defaults to "on" (or whatever `CONSENT_DEFAULT` is set to).
- Conversion data shows up in each ad platform's dashboard within 30–60 minutes of the next deploy.
- The pre-deploy scan now permits these specific loader domains. If a fourth platform is added later, re-run `/anglesite:tracking` so the allowlist updates.

## Step 8 — Help the owner verify the install in their ad dashboards

Each ad platform has its own validator. Surface the relevant URLs and tell the owner what to expect:

- **Meta**: Open Events Manager → Test Events → enter the live site URL → load any page → confirm a `PageView` event appears.
- **Google Ads / GA4**: Install the [Google Tag Assistant](https://tagassistant.google.com/) extension or open GA4 → Realtime → confirm an event arrives within 30 seconds of loading the site.
- **LinkedIn**: Open Campaign Manager → Account assets → Insight tag → status will go from "Unverified" to "Active" after the first pageview.
- **TikTok**: TikTok Ads Manager → Events → Web → status panel.
- **Pinterest**: Pinterest Business → Ads → Conversions → Pixel health.
- **X**: X Ads → Tools → Conversion tracking → status.
- **Microsoft Clarity**: clarity.microsoft.com → your project → it flips to "Recording" once it receives the first session (usually within a few minutes). Heatmaps and recordings populate as visitors browse.

Frame it as a one-time check: "Run through these on the live site once — if a platform shows the pixel as 'Active' or 'Receiving events', you're done. If something stays unverified after 24 hours, run `/anglesite:check` and we'll diagnose it."

## Re-running the command

If `/anglesite:tracking` is run again:

1. Read all `TRACKING_*` keys from `.site-config`
2. Ask what changed: add a platform, remove a platform, change an ID
3. Update `.site-config` and `src/components/TrackingPixels.astro`
4. Update the `forward` array in `astro.config.ts` if a new platform was added
5. Bump `CONSENT_VERSION` if consent is enabled and a new vendor was added
6. Re-build and confirm the pre-deploy scan passes

## Removal

If the owner wants to remove a platform: delete the matching `TRACKING_*` key from `.site-config`, rebuild, and confirm the pixel no longer appears in `dist/`. Removing every key removes the component's output entirely; the `@astrojs/partytown` integration can stay installed (it's inert when no Partytown scripts are emitted) or be uninstalled with `npm uninstall @astrojs/partytown` if the owner wants to keep dependencies tight.
