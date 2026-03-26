---
name: check
description: "Health audit and troubleshooting"
argument-hint: "[optional: describe the problem]"
allowed-tools: Bash(npm run *), Bash(npx astro check), Bash(npx pa11y *), Bash(grep *), Bash(find dist/ *), Bash(npm audit *), Bash(lsof *), Bash(netstat *), Bash(dscacheutil *), Bash(getent *), Bash(nslookup *), Bash(gh issue *), Bash(gh label *), Write, Read, Glob
---

Run a full health check on the site — and fix what you find. If the owner described a specific problem, diagnose that first; otherwise run the full audit below. The checklists are for you (the agent) — **do not show raw checklist items, technical terms, or jargon to the owner.** Translate every finding into plain English. See the Results section at the bottom for how to present findings.

## Architecture decisions

These explain *why* each check category matters:

- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css-custom-properties.md) — contrast verification against CSS custom properties
- [ADR-0005 System fonts](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0005-system-fonts.md) — flag external font CDN links as violations
- [ADR-0006 IndieWeb POSSE](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0006-indieweb-posse.md) — why h-card, h-entry, h-feed, and `rel="me"` are checked
- [ADR-0007 Pre-deploy scans](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0007-mandatory-pre-deploy-scans.md) — why PII, token, and script scans are mandatory
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why third-party scripts are flagged
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — build baseline before checking other categories

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Build checks
- [ ] `npx astro check` passes (TypeScript)
- [ ] `npm run build` succeeds
- [ ] All pages have title, meta description, OG tags
- [ ] Images have alt text and are reasonably sized (<500KB)

## Accessibility (WCAG AA)

These checks are not optional. Accessibility failures are as serious as security failures.

### Automated checks
Build the site first, then scan the output. Read `DEV_HOSTNAME` from `.site-config` for the URL (fall back to `localhost` if not set):
```sh
npx pa11y-ci --sitemap https://DEV_HOSTNAME/sitemap-index.xml
```
If `pa11y-ci` is not installed, run:
```sh
npx pa11y dist/index.html
```
Either tool checks for WCAG 2.1 AA violations: missing alt text, low contrast, missing form labels, broken ARIA, heading order, etc.

### Manual checks (inspect the built HTML)
- [ ] Every page has exactly one `<h1>`, and headings don't skip levels
- [ ] Color contrast meets 4.5:1 for body text and 3:1 for large text — verify the CSS custom properties in `src/styles/global.css`
- [ ] All interactive elements (links, buttons, form inputs) are keyboard-reachable
- [ ] No images of text (use real text instead)
- [ ] Skip-to-content link present in the layout
- [ ] Form inputs have associated `<label>` elements
- [ ] `lang` attribute set on `<html>` element

If any accessibility check fails, explain what the issue is, who it affects, and how to fix it.

## Mobile and responsive

Check that the site works on small screens. Start the dev server if not already running.

- [ ] Viewport meta tag present: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- [ ] No horizontal scrolling at 320px width — check for fixed-width elements, overflow, or images without `max-width: 100%`
- [ ] Text is readable without zooming (minimum 16px body text)
- [ ] Touch targets are at least 44x44px (links, buttons)
- [ ] Navigation is usable on small screens (hamburger menu, collapsible nav, or simple enough to not need one)
- [ ] Images use responsive sizing (`max-width: 100%` or `srcset`)
- [ ] No content hidden on mobile that's visible on desktop (all information should be available)

## Privacy audit
- [ ] No customer PII in `dist/` (emails, phone numbers, names)
- [ ] No customer PII in git staging area
- [ ] `.env` files not tracked by git
- [ ] No API tokens or secrets in source or built files

## Security audit
- [ ] Security headers intact in `public/_headers` (CSP, X-Frame-Options, etc.)
- [ ] No third-party scripts except Cloudflare Web Analytics
- [ ] No `/keystatic` routes in production build
- [ ] `robots.txt` blocks `/keystatic/`
- [ ] No `.env` files in `dist/` or `public/`
- [ ] `npm audit` — check for known vulnerabilities
- [ ] Images in `public/images/` checked for EXIF GPS data (see `docs/security.md`)

## Content and SEO
- [ ] Every page has a unique `<title>` and `<meta name="description">`
- [ ] Open Graph tags present (`og:title`, `og:description`, `og:image`)
- [ ] Sitemap exists at `/sitemap-index.xml`
- [ ] `robots.txt` exists and includes sitemap URL
- [ ] No broken internal links — scan `dist/` for hrefs that don't resolve to a file
- [ ] Blog posts have valid frontmatter (title, description, publishDate)
- [ ] Business name, address, and contact info are easy to find (not buried)

## IndieWeb (see `docs/indieweb.md`)
- [ ] `h-card` in site header with `p-name` and `u-url`
- [ ] `h-entry` on blog posts with `p-name`, `dt-published`, `e-content`
- [ ] Blog listing page wrapped in `h-feed`
- [ ] `rel="me"` links present for the owner's social profiles
- [ ] Syndication links render as `u-syndication` with `rel="syndication"`
- [ ] RSS feed at `/rss.xml` with `<link rel="alternate">` discovery in `<head>`
- [ ] Event pages use `h-event` markup if the business hosts events

## Performance
- [ ] Images are in modern formats (.webp preferred) and optimized (<500KB)
- [ ] No render-blocking resources in `<head>` beyond essential CSS
- [ ] CSS is reasonably sized (check for unused rules)
- [ ] No large JavaScript bundles in `dist/_astro/` (Astro should produce near-zero client JS)

For a thorough performance audit, tell the owner: "Let's check how fast your site loads. I'll open Google's free speed test tool." Then open:

Open the PageSpeed tool in their browser: `https://pagespeed.web.dev/`

Have the owner paste their site URL. Explain the scores: green (90+) is great, orange (50-89) needs work, red (<50) is urgent.

## Social preview
- [ ] `og:title`, `og:description`, and `og:image` present on every page in `dist/`
- [ ] `twitter:card` meta tag present (value: `summary_large_image` if og:image exists, `summary` otherwise)
- [ ] OG image file exists at the path referenced by `og:image` and is approximately 1200x630 pixels
- [ ] `apple-touch-icon.png` exists in `public/` (180x180) — if missing, run `npm run ai-images` to generate it
- [ ] `og-image.png` exists in `public/` — if missing, run `npm run ai-images` to generate it
- [ ] `manifest.webmanifest` icon paths reference files that actually exist in `public/`
- [ ] Test by pasting the site URL into a group chat or social media draft — the preview card should show the site title, description, and image
- [ ] Each page has its own `og:title` and `og:description` (not all the same)

## Reputation

If `BUSINESS_TYPE` is set in `.site-config`, invoke the reputation skill for review coaching and competitive awareness.

Read `REVIEW_PLATFORMS` from `.site-config` if available. When invoking the reputation skill, note that this is a non-interactive check context so it should present tips, not questions.

If `REVIEW_PLATFORMS` is set, include the platform names in the nudge: "Reminder: check your [Google, Yelp] reviews — responding within a few days helps your reputation." If not set, use the generic nudge.

Read `${CLAUDE_PLUGIN_ROOT}/skills/reputation/SKILL.md` and follow it. Include the output as a "Reputation" section in the health report. Keep it brief — 1-3 action items max. If `BUSINESS_TYPE` is not set, skip this section.

## Results

**The owner is not technical.** Do not report raw checklist items. Translate every finding into one plain-English sentence that answers: what's wrong, why it matters, and what happens next. Group by severity using these everyday labels:

- **Must fix before publishing** — "Your site has a problem that needs to be fixed before it can go live."
- **Worth fixing soon** — "This won't break anything, but fixing it will make your site better."
- **All good** — "This part of your site is working well."

Examples of how to translate findings:

| Technical finding | What to tell the owner |
|---|---|
| Missing alt text on 3 images | "Three photos on your site don't have descriptions for people who use screen readers. I can add those for you." |
| Low color contrast on body text | "The text on some pages is hard to read against the background. I'll adjust the colors so it's easier on the eyes." |
| OG tags missing | "When you share your site link in a text or on social media, it won't show a nice preview card yet. I can fix that." |
| h-card missing | "Search engines and other sites can't find your business name and address in a standard format. I'll add that to the page." |
| npm audit found vulnerability | "One of the behind-the-scenes tools has a known security issue. I'll update it." |
| CSP header misconfigured | "Your site's security settings need a small adjustment. I'll take care of it." |
| EXIF GPS data in images | "Some of your photos have location information embedded in them. I'll strip that out so visitors can't see where the photos were taken." |

Never show the owner: CSS selectors, HTML tag names, HTTP headers, schema.org terms, WCAG levels, npm package names, or code snippets. If you need to explain *why* something matters, use an analogy or a concrete consequence ("visitors on phones will have to scroll sideways").

If any must-fix issues are found, explain and offer to fix them. If everything passes, keep it short: "Your site looks good — it builds correctly, works on phones, is secure, and is easy for search engines to find. No issues."

After the check, tell the owner: "This is the same kind of checkup a good web developer would do regularly. Your site should get one of these at least once a month — just type `/anglesite:check` anytime."

## File bugs for persistent issues

After the audit, if any must-fix issues were found that couldn't be resolved in the current session, file a GitHub issue for each one. Read `GITHUB_REPO` from `.site-config`. If not set, skip this step.

Follow the bug filing workflow in `docs/bug-filing.md`. Use the appropriate label:
- Accessibility violations → `accessibility`
- Security findings → `security`
- Build failures → `build`
- Content issues → `content`
- Everything else → `bug`

## Troubleshooting

If the owner reported a specific problem (or you found one during the audit), diagnose and fix it.

### Step 1 — Check prerequisites

```sh
npm run ai-check
```

Then read `.site-config` to verify it has `SITE_NAME` and `DEV_HOSTNAME`. If either is missing, suggest running `/anglesite:start` first.

### Common tool issues
- **Wrangler auth expired:** Run `npx wrangler login` to re-authenticate.
- **Dev server port conflict:** Run `lsof -i :4321` (macOS/Linux) or `netstat -ano | findstr :4321` (Windows) to find what's using port 4321.
- **fnm/Node not in PATH:** Run `npm run ai-setup` to fix shell profile.

### HTTPS / local preview issues
- **Certificate error in browser:** The local CA may not be trusted. Run `npm run ai-setup` to reinstall it.
- **"This site can't be reached":** Check hostname resolution:
  - macOS: `dscacheutil -q host -a name HOSTNAME`
  - Linux: `getent hosts HOSTNAME`
  - Windows: `nslookup HOSTNAME`
  Replace HOSTNAME with the value from `.site-config`. If it doesn't resolve to 127.0.0.1, run `npm run ai-setup`.
- **Port 443 not forwarding:** Run `npm run ai-check` and look for `https_portforward`. If missing, run `npm run ai-setup` (macOS auto-configures; Linux/Windows require manual setup — see setup log).
- **Certificate hostname mismatch:** Domain changed since cert was generated. Run `npm run ai-setup` to regenerate.
- **HTTPS works at :4321 but not :443:** Port forwarding rules not loaded. On macOS, run `npm run ai-setup` to reload pfctl. On Linux/Windows, check the setup log for manual instructions.

### Step 2 — Diagnose

1. Ask the owner to describe what's wrong (or what error they saw)
2. Check log files: `~/.anglesite/logs/build.log`, `deploy.log`, `check.log`, `dev.log`
3. Run `npx astro check` and `npm run build` to reproduce

### Step 3 — Fix it

1. Explain what went wrong in plain language
2. Fix it
3. Verify by running checks again
4. Ask if they want to publish the fix
