---
name: pwa
description: "Make the site installable as a Progressive Web App with offline support"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm run build), Bash(node *), Write, Read, Glob, Edit
metadata:
  author: "David W. Keith"
  version: "1.2.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Make the site installable as a Progressive Web App. Visitors can add it to their home screen for instant, app-like access — no app store listing, no review process, no 30% platform fee. A service worker caches key pages so essential content (hours, menu, contact info) stays available even without internet.

Follows Open Web Advocacy principles: the web is an app platform, and web apps deserve feature parity with native. Uses only vanilla JavaScript — no Workbox, no third-party service worker libraries.

## Architecture decisions

- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — The service worker is vanilla JS. No Workbox, no sw-precache. First-party code only.
- [ADR-0003 Workers hosting](references/docs/decisions/0003-cloudflare-workers-hosting.md) — Cloudflare edge caching provides the first layer. The service worker adds a second, client-side layer for true offline support when the network is completely unavailable.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config` for `PWA_ENABLED`. If it's already `true`, tell the owner: "Your site already has PWA support. Would you like to change which pages are cached offline, update the install prompt, or troubleshoot?" Then adjust as needed.

Verify the site builds cleanly: run `npm run build`. If the build fails, fix it before proceeding.

## Step 1 — Determine offline content

Ask the owner:

> "Which pages should visitors be able to view even without internet? Common choices for [business type] include:
>
> 1. **Essentials only** — home page and contact info
> 2. **Key pages** — home, about, menu/services, contact, hours
> 3. **Everything** — all pages cached as visitors browse
>
> I'd recommend option 2 for most sites."

Map their answer to a precache list. For option 3, do not precache everything — instead use runtime caching (cache pages as the visitor navigates).

Also ask:

> "Would you like a subtle 'Add to Home Screen' prompt so visitors know they can install the site? It appears once, and if dismissed, won't show again for 30 days."

## Step 2 — Enhance the web app manifest

Read `public/manifest.webmanifest`. Rewrite it with full PWA fields:

```json
{
  "name": "<full site name from .site-config SITE_NAME>",
  "short_name": "<≤12 chars, abbreviate if needed>",
  "description": "<one-sentence site description>",
  "start_url": "/",
  "id": "/",
  "display": "standalone",
  "orientation": "any",
  "scope": "/",
  "background_color": "<existing background_color>",
  "theme_color": "<existing theme_color>",
  "categories": ["<business-appropriate categories>"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ],
  "shortcuts": []
}
```

**Manifest field guidance:**

- `display`: Always `"standalone"`. This is what makes the app feel native — no browser chrome.
- `id`: Set to `"/"` so the browser treats it as a stable identity even if `start_url` changes later.
- `categories`: Use [W3C standardized categories](https://www.w3.org/TR/manifest-app-info/#categories-member). Common for small businesses: `"business"`, `"food"`, `"health"`, `"shopping"`, `"entertainment"`, `"education"`.
- `shortcuts`: Populate with 2–4 key pages. Example for a restaurant: `[{"name": "Menu", "url": "/menu", "description": "View our menu"}, {"name": "Contact", "url": "/contact", "description": "Get in touch"}]`. Each shortcut needs `name` and `url`; `description` and `icons` are optional.
- `orientation`: Use `"any"` unless the site is specifically designed for one orientation.

Preserve existing `theme_color` and `background_color` values.

## Step 3 — Generate PWA icons

Check `public/` for existing icon files. Look for:
- A high-resolution PNG or SVG (512×512 or larger) — ideal source
- `apple-touch-icon.png` (180×180) — usable but not ideal

**If a 512×512+ source icon exists:**

Create a Node script to generate the required sizes. Sharp is available as an Astro transitive dependency:

```javascript
// scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SOURCE = process.argv[2]; // e.g., "public/logo-512.png"
const OUT = "public/icons";
await mkdir(OUT, { recursive: true });

const sizes = [192, 512];
for (const size of sizes) {
  await sharp(SOURCE).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(`${OUT}/icon-${size}.png`);
  // Maskable icons need 10% safe zone padding — shrink content to 80% and center on background
  const padding = Math.round(size * 0.1);
  const inner = size - padding * 2;
  const bg = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const content = await sharp(SOURCE).resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  await sharp(bg).composite([{ input: content, left: padding, top: padding }]).png().toFile(`${OUT}/icon-maskable-${size}.png`);
}
console.log("PWA icons generated in public/icons/");
```

Run: `node scripts/generate-pwa-icons.mjs public/<source-icon>`. Delete the script after it runs — it's a one-time operation.

**If only `apple-touch-icon.png` (180×180) exists:**

Tell the owner: "Your current icon is 180×180. For the best install experience (sharp home screen icon, splash screen), a 512×512 PNG or SVG logo works best. Want to provide one, or should I proceed with what we have?"

If proceeding with 180×180, create the `public/icons/` directory and use the apple-touch-icon for all sizes (upscaling is acceptable for maskable icons which are displayed at small sizes). Update manifest icon entries to reference the available files.

**If no icon exists at all:**

Ask the owner for a logo or icon file. Do not generate a placeholder — a missing icon is better than a generic one for a real business.

## Step 4 — Create the offline page

Create `src/pages/offline.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), ".site-config");
const config = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
const siteName = config.match(/^SITE_NAME=(.+)$/m)?.[1]?.trim() ?? "this site";
---

<BaseLayout title="Offline" description="You are currently offline.">
  <div class="offline-page">
    <h1>You're offline</h1>
    <p>It looks like your internet connection is unavailable. Pages you've visited before may still be accessible.</p>
    <nav aria-label="Cached pages">
      <a href="/">Home page</a>
    </nav>
  </div>

  <style>
    .offline-page {
      text-align: center;
      padding: var(--space-xl) var(--space-md);
    }
    .offline-page h1 {
      margin-block-end: var(--space-md);
    }
    .offline-page p {
      color: var(--color-muted);
      max-width: 32rem;
      margin-inline: auto;
      margin-block-end: var(--space-lg);
    }
    .offline-page nav {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-sm);
    }
    .offline-page nav a {
      color: var(--color-primary);
    }
  </style>
</BaseLayout>
```

Add links to the offline page's `<nav>` for whichever pages the owner chose to cache in Step 1 (e.g., `/menu`, `/contact`, `/about`).

## Step 5 — Create the service worker

Create `public/sw.js`:

```javascript
const CACHE_VERSION = 1;
const CACHE_NAME = `site-v${CACHE_VERSION}`;
const OFFLINE_URL = "/offline/";

const PRECACHE_URLS = [
  "/",
  "/offline/",
  // Add pages the owner chose in Step 1
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith("site-") && k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  // Navigation requests: network-first, fall back to cache, then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // CSS, JS, fonts: stale-while-revalidate
  const dest = request.destination;
  if (dest === "style" || dest === "script" || dest === "font") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        return cached || network;
      })
    );
    return;
  }

  // Images: cache-first
  if (dest === "image") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }
});
```

**Customization notes:**

- Add pages from Step 1 to `PRECACHE_URLS`. Only precache pages the owner specifically chose — large precache lists slow down the first visit.
- Bump `CACHE_VERSION` when the owner deploys significant content changes. The service worker update flow handles this automatically (old caches are purged on activation).
- The service worker does NOT cache the Keystatic admin route (`/keystatic/`) or API endpoints.
- If the site has a Pagefind search index, do NOT precache `/pagefind/` — it can be large and updates every build.

## Step 6 — Register the service worker

Read `src/layouts/BaseLayout.astro`. Add service worker registration just before `</body>`:

```html
<script is:inline>
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated" && navigator.serviceWorker.controller) {
            const banner = document.getElementById("sw-update");
            if (banner) banner.hidden = false;
          }
        });
      });
    });
  }
</script>
```

Also add an update notification element in the `<body>`, before the closing `</body>`:

```html
<div id="sw-update" hidden role="alert" style="position:fixed;bottom:0;left:0;right:0;padding:var(--space-sm) var(--space-md);background:var(--color-primary);color:#fff;text-align:center;z-index:1000;">
  Site updated. <button onclick="location.reload()" style="color:#fff;text-decoration:underline;background:none;border:none;cursor:pointer;font:inherit;">Refresh</button>
</div>
```

This tells returning visitors when new content is available without forcing a reload.

## Step 7 — Add install prompt (if requested)

If the owner opted in during Step 1, create `src/components/InstallPrompt.astro`:

```astro
---
interface Props {
  appName?: string;
}
const { appName = "this site" } = Astro.props;
---

<div class="install-prompt" hidden>
  <p>Add <strong>{appName}</strong> to your home screen for quick access.</p>
  <div class="install-prompt-actions">
    <button class="install-prompt-action" data-action="install" type="button">Install</button>
    <button class="install-prompt-action" data-action="dismiss" type="button">Not now</button>
  </div>
</div>

<style>
  .install-prompt {
    position: fixed;
    bottom: var(--space-md);
    left: var(--space-md);
    right: var(--space-md);
    max-width: 28rem;
    margin-inline: auto;
    padding: var(--space-md);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    z-index: 900;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .install-prompt p {
    flex: 1 1 100%;
    margin: 0;
    font-size: var(--font-size-sm);
  }
  .install-prompt-actions {
    display: flex;
    gap: var(--space-sm);
    margin-inline-start: auto;
  }
  .install-prompt-action[data-action="install"] {
    background: var(--color-primary);
    color: #fff;
    border: none;
    padding: var(--space-xs) var(--space-md);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
  }
  .install-prompt-action[data-action="dismiss"] {
    background: none;
    border: none;
    color: var(--color-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
  }
  @media (prefers-reduced-motion: reduce) {
    .install-prompt { animation: none; }
  }
</style>

<script is:inline>
  (function () {
    var DISMISS_KEY = "pwa-install-dismissed";
    var DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
    var banner = document.querySelector(".install-prompt");
    if (!banner) return;

    var dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < DISMISS_MS) return;

    var deferredPrompt = null;

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      banner.hidden = false;
    });

    banner.addEventListener("click", function (e) {
      var action = e.target.dataset && e.target.dataset.action;
      if (action === "install" && deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          banner.hidden = true;
        });
      } else if (action === "dismiss") {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        banner.hidden = true;
      }
    });

    window.addEventListener("appinstalled", function () {
      banner.hidden = true;
    });
  })();
</script>
```

Import and render it in `src/layouts/BaseLayout.astro`, just before the closing `</body>`:

```astro
import InstallPrompt from "../components/InstallPrompt.astro";
```

```html
<InstallPrompt appName={siteName} />
```

Read `.site-config` for `SITE_NAME` and pass it as `appName`.

## Step 8 — Configure headers

Read `public/_headers`. Add a cache-control rule for the service worker so browsers always check for updates:

```
/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /
```

If the `_headers` file does not exist, create it with just these rules.

If the file already has rules, append these at the end. Do not modify existing rules.

## Step 9 — Save configuration

Append to `.site-config`:

```
PWA_ENABLED=true
PWA_OFFLINE_STRATEGY=<essentials|key-pages|browse>
```

Use `essentials`, `key-pages`, or `browse` to reflect the choice from Step 1 (options 1, 2, or 3 respectively).

## Step 10 — Build and verify

Run `npm run build`.

After a successful build, verify:
1. `dist/sw.js` exists
2. `dist/offline/index.html` exists
3. `dist/manifest.webmanifest` contains `"display": "standalone"`
4. Icon files exist in `dist/icons/` (if generated in Step 3)

Tell the owner:

> "Your site is now a Progressive Web App! Here's what changed:
>
> - **Installable** — visitors on Chrome, Edge, or Safari can add it to their home screen
> - **Offline support** — [list cached pages] stay available without internet
> - [if install prompt] **Install prompt** — a subtle banner invites first-time visitors to install
>
> To test: open the site in Chrome DevTools → Application tab → Manifest and Service Workers sections. On mobile, try 'Add to Home Screen' from the browser menu.
>
> Push notifications are not yet included — for notifying customers about updates, `/anglesite:newsletter` sets up email subscriptions, which reach all devices reliably."

## Re-running the command

If `/anglesite:pwa` runs on a site that already has PWA support:

1. Read `.site-config` for `PWA_ENABLED` and `PWA_OFFLINE_STRATEGY`
2. Ask what the owner wants to change:
   - **Offline pages** — update `PRECACHE_URLS` in `public/sw.js` and `PWA_OFFLINE_STRATEGY` in `.site-config`
   - **Install prompt** — add, remove, or restyle `InstallPrompt.astro`
   - **Icons** — regenerate from a new source image
   - **Cache bust** — bump `CACHE_VERSION` in `public/sw.js` to force a full refresh
3. Rebuild and verify
