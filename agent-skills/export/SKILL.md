---
name: export
description: "Produce a portable export of the site (built HTML, content, media, MIGRATING.md) so the owner can self-host or move to any other platform"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22). Deploy/provisioning steps require a Cloudflare account and Wrangler."
allowed-tools: Bash(npm run build), Bash(mkdir *), Bash(cp *), Bash(rsync *), Bash(zip *), Bash(ls *), Bash(find *), Bash(du *), Bash(grep *), Bash(date *), Bash(git rev-parse *), Bash(npx wrangler r2 *), mcp__cloudflare__r2_bucket_create, mcp__cloudflare__r2_bucket_get, mcp__cloudflare__r2_buckets_list, Read, Write
metadata:
  author: "David W. Keith"
  version: "1.5.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Produce a portable, self-contained export of the site so the owner is never
locked in. The output is a folder the owner can hand to a new developer, upload
to any static host, or archive. This is a trust feature — the explicit "you
can leave any time, here's how."

Anglesite is built so this export is always possible: content is `.mdoc`
Markdown, media is plain files in `public/`, the build output is plain HTML in
`dist/`, and the source is a standard Astro project with no Anglesite runtime.
Nothing in the export depends on the Anglesite plugin to work.

## Architecture decisions

- [ADR-0011 Owner ownership](references/docs/decisions/0011-owner-controls-everything.md) — the export is the operational expression of "the owner can walk away with everything"
- [ADR-0002 Keystatic CMS](references/docs/decisions/0002-keystatic-local-cms.md) — content is stored as `.mdoc` files so it's portable by design
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — `dist/` is self-contained, no runtime dependency on external scripts
- [ADR-0012 Verify first](references/docs/decisions/0012-verify-before-presenting.md) — the build must succeed before the export is presented

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Frame the task

Tell the owner, in plain language:

> "I'm going to package up your whole website so you can take it anywhere — to
> a different host, a new developer, or just keep as a backup. Nothing about
> this site is locked to Anglesite. When this finishes you'll have a folder
> that includes:
>
> - **`dist/`** — the finished website, ready to upload to any host
> - **`content/`** — your blog posts and pages in plain Markdown
> - **`public/`** — your images and other media
> - **`MIGRATING.md`** — step-by-step instructions for self-hosting on common
>   platforms (Netlify, Vercel, GitHub Pages, S3, or any web server)"

Then ask:

> "Do you also want me to include a copy of the source code in the export?
> That's useful if you plan to keep editing the site outside of Anglesite."

Store the answer as INCLUDE_SOURCE (`true` / `false`).

## Step 1 — Build the site

The export is only useful if the site builds. Build first.

```sh
npm run build
```

If the build fails, tell the owner what went wrong in plain language and stop.
Do not produce a partial export. Run `/anglesite:check` to diagnose, then
re-run `/anglesite:export` once the build succeeds.

## Step 2 — Create the export folder

Read `SITE_NAME` from `.site-config`. Slugify it (lowercase, spaces and
non-alphanumeric characters replaced with `-`, collapsed and trimmed) and
combine with today's date for the export folder name:

```
EXPORT_DIR=export/{slug}-{YYYY-MM-DD}
```

For example: `export/pairadocs-farm-2026-05-06`.

Create the folder:

```sh
mkdir -p EXPORT_DIR
```

If the folder already exists from a previous export today, append `-2`, `-3`,
etc. — never overwrite a previous export.

Add `export/` to `.gitignore` if it isn't already, so exports don't get
committed. Use the **Read** tool to load `.gitignore`, then the **Edit** tool
to append `export/` if missing.

## Step 3 — Copy the built site

The built site in `dist/` is self-contained static HTML, CSS, and JS. It can
be uploaded to any static host as-is.

```sh
cp -R dist EXPORT_DIR/dist
```

If `cp -R` is unavailable (rare), fall back to `rsync -a dist/ EXPORT_DIR/dist/`.

## Step 4 — Copy content sources

Markdown sources are the canonical content, independent of the build output.
Copy the whole content tree:

```sh
cp -R src/content EXPORT_DIR/content
```

This includes posts, pages, and any custom collections defined in
`src/content.config.ts`. The `.mdoc` files are standard Markdoc and can be
opened in any text editor or imported into another CMS.

## Step 5 — Copy media

```sh
cp -R public EXPORT_DIR/public
```

This copies images, fonts, manifests, redirects, and the robots.txt — the same
static assets that ship with the deployed site.

## Step 6 — Optionally copy the source

If INCLUDE_SOURCE is `true`, copy the project sources so the owner can keep
building. Skip build artefacts, dependencies, and local-only files:

```sh
rsync -a \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.astro' \
  --exclude='.cache' \
  --exclude='.wrangler' \
  --exclude='export' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.DS_Store' \
  --exclude='.git' \
  ./ EXPORT_DIR/source/
```

This produces a clean Astro + Keystatic project that builds with `npm install
&& npm run build` on any machine. It still has `.site-config` so future
Anglesite sessions work, but nothing in the source requires Anglesite — it's
standard Astro.

If `rsync` isn't available, tell the owner: "I need rsync for this part — it's
already installed on macOS and Linux. On Windows, install it via WSL or Git
Bash. Skipping the source copy for now." Continue without it.

## Step 7 — Generate MIGRATING.md

Read `SITE_NAME`, `SITE_DOMAIN` (if set), and `GITHUB_REPO` (if set) from
`.site-config`. Use the **Write** tool to create `EXPORT_DIR/MIGRATING.md`
using the template in the next section, substituting `{SITE_NAME}`,
`{SITE_DOMAIN}`, `{GITHUB_REPO}`, and `{DATE}` (today's YYYY-MM-DD).

If `SITE_DOMAIN` isn't set, omit the domain-specific paragraphs and use a
generic placeholder. If `GITHUB_REPO` isn't set, skip the "back into Anglesite"
section's git clone reference and tell the reader to use the source folder
directly.

### MIGRATING.md template

```markdown
# Migrating {SITE_NAME}

Exported on {DATE}.

This folder is a complete, portable copy of your website. You can host it
anywhere, hand it to any developer, or keep it as an archive. Nothing in this
export depends on Anglesite, Claude, or any specific platform.

## What's in this folder

- `dist/` — the finished website. Static HTML, CSS, and JavaScript files.
  This is what visitors see. You can upload this folder to almost any host
  and the site will work.
- `content/` — your blog posts and pages as `.mdoc` Markdown files. This is
  the source of truth for your writing. It's plain text, readable by any
  editor, and can be imported into most other CMSes.
- `public/` — your images, fonts, redirects, and other static files. These
  get served as-is.
- `source/` — *(if you asked for it)* the full project source code, ready to
  rebuild from scratch with `npm install && npm run build`.

## Self-hosting

Pick whichever option fits your situation. All of them work with the `dist/`
folder.

### Option A — Netlify (drag and drop)

1. Go to https://app.netlify.com/drop
2. Drag the `dist/` folder onto the page
3. Netlify gives you a `*.netlify.app` URL — your site is live in seconds
4. To use your own domain, click "Domain settings" and follow Netlify's
   instructions

Free tier covers most small business sites. No credit card required.

### Option B — Vercel

1. Sign up at https://vercel.com (free tier is generous)
2. Install the Vercel CLI: `npm i -g vercel`
3. From inside `dist/`, run: `vercel --prod`
4. Follow the prompts — Vercel deploys and gives you a URL

To use your own domain, add it via Vercel's dashboard.

### Option C — GitHub Pages

1. Create a new GitHub repository (e.g. `{SITE_NAME}-site`)
2. Copy the contents of `dist/` into the repo
3. Push, then go to Settings → Pages and pick the branch and root folder
4. GitHub Pages gives you a `*.github.io` URL — usually live within a minute

For a custom domain, add a `CNAME` file to the repo with your domain on a
single line, then point your domain's DNS at GitHub Pages.

### Option D — Amazon S3 + CloudFront

1. Create an S3 bucket with static website hosting enabled
2. Upload the contents of `dist/` (not the folder itself — the contents)
3. Set the index document to `index.html` and error document to `404.html`
4. *(Recommended)* Put CloudFront in front for HTTPS and a CDN
5. Point your domain at the CloudFront distribution

This is the most flexible option, and the cheapest at scale. It's also the
most work to set up.

### Option E — Any web server (Apache, nginx, Caddy, etc.)

`dist/` is just a folder of static files. Copy it to your server's web root
and you're done. Make sure the server is configured to:

- Serve `index.html` for directory requests
- Serve `404.html` for missing pages
- Send the correct `Content-Type` for `.css`, `.js`, `.webp`, `.svg`, etc.
  (most servers do this automatically)

If you have an `_redirects` file in `public/` (and now in `dist/`), most
modern static hosts (Netlify, Cloudflare Workers / Pages-style hosts, Render) read it directly. For
Apache or nginx, you'll need to translate those rules into the server's own
redirect format.

## Editing content without Anglesite

The `content/` folder contains all your writing as `.mdoc` (Markdoc) files.
Markdoc is a Markdown variant — most Markdown editors can open and edit these
files. Frontmatter (the YAML between `---` markers at the top) holds the
title, description, publish date, and other metadata.

To rebuild after edits, you need the full project (the `source/` folder, if
included). Then:

```sh
cd source
npm install
npm run build
```

The new `dist/` is what you upload.

## Re-importing into another CMS

The `.mdoc` files in `content/` are close enough to standard Markdown that
most CMSes can import them with minor tweaks:

- **WordPress** — use a Markdown import plugin, or convert to WXR with
  pandoc/scripts
- **Ghost** — Ghost has a JSON import format; convert frontmatter to Ghost's
  fields with a small script
- **Eleventy / Astro / Hugo / Jekyll** — these all read Markdown with
  frontmatter natively; just copy the files into the appropriate folder
- **Notion / other modern editors** — paste the Markdown content directly

The images referenced from posts live in `public/images/` (or wherever the
post points). Bring those along when you migrate.

## Coming back to Anglesite

If you want to come back later, you have two paths:

1. **From the source folder** *(if included)* — open it in Claude Code and
   run `/anglesite:start`. Anglesite will pick up where you left off.
{GITHUB_CLONE_BLOCK}
2. **Fresh import** — start an empty Anglesite project and run
   `/anglesite:import https://{SITE_DOMAIN}` (or the URL of wherever the site
   is hosted now) to pull the content back in.

## Domain considerations

Your domain (`{SITE_DOMAIN}`) is registered in your own account, separate
from the website hosting. Moving the site does not affect the domain. To point
the domain at a new host:

1. Get the new host's DNS instructions (usually a CNAME or set of A records)
2. Log into your domain registrar (or Cloudflare, if you used Cloudflare's
   registrar)
3. Update the DNS records to match the new host
4. Wait — DNS changes usually take effect within minutes but can take up to
   48 hours

If you used Cloudflare DNS for HTTPS, security headers, and analytics, those
features stay with Cloudflare regardless of where the site is hosted. You can
keep Cloudflare in front of any of the options above.

## Privacy and data

This export contains everything that was on the live site. It does **not**
contain:

- Customer or visitor data (the site doesn't collect any)
- Analytics history (lives with Cloudflare or your analytics provider)
- Email account data (separate from the website)
- Payment processor data (Stripe, Square, etc. — separate accounts)
- Domain registration (separate, in your name at your registrar)

You own the domain, the analytics account, the email, and the payment
accounts independently. Migrating the website does not require migrating any
of those.

---

Exported by Anglesite on {DATE}. Questions? Open an issue at
https://github.com/Anglesite/anglesite — or, more importantly, you don't
need to ask permission to leave. You already have everything you need.
```

`{GITHUB_CLONE_BLOCK}` is the literal text:

```
2. **From GitHub** — clone https://github.com/{GITHUB_REPO} and run
   `/anglesite:start` in the cloned folder.
3. **Fresh import** — ...
```

When `GITHUB_REPO` is set. Renumber the list as needed. Otherwise omit it
entirely.

## Step 8 — Verify the export

Confirm the export contains what it should:

```sh
ls EXPORT_DIR
```

Should include `dist/`, `content/`, `public/`, `MIGRATING.md`, and (if
INCLUDE_SOURCE) `source/`.

Sanity-check sizes:

```sh
du -sh EXPORT_DIR/dist EXPORT_DIR/content EXPORT_DIR/public
```

Confirm `dist/` contains an `index.html`:

```sh
find EXPORT_DIR/dist -maxdepth 2 -name 'index.html'
```

If any of these checks come back empty, tell the owner what's missing and
offer to re-run the affected step. Don't claim success on a partial export.

## Step 9 — Present the export

Tell the owner in plain language:

> "Your export is ready at **`EXPORT_DIR`**.
>
> Inside you'll find:
> - `dist/` — your finished website, ready to upload anywhere
> - `content/` — every post and page as Markdown
> - `public/` — your images and other media
> - `MIGRATING.md` — step-by-step instructions for self-hosting and
>   re-importing
> {SOURCE_BULLET}
>
> The whole thing is yours. You don't need Anglesite, Claude, or anyone else
> to use it. Open `MIGRATING.md` first — it walks through the most common
> options for taking the site somewhere new.
>
> A few things to keep in mind:
> - This export captures the site as it is **right now**. If you make more
>   changes here, run `/anglesite:export` again to refresh.
> - The export folder is in `.gitignore` and won't be committed — it's for
>   your records, not for the site itself.
> - Your domain, analytics, and email are separate accounts in your name.
>   Moving the website does not affect any of them."

Where `{SOURCE_BULLET}` is `- \`source/\` — the full project source code,
ready to rebuild from scratch` if INCLUDE_SOURCE is `true`, otherwise omitted.

## Step 10 — Offer next steps

Ask the owner what they want to do next:

> "Want me to do anything else with this export? For example:
> - **Zip it up** so it's easy to email or hand off
> - **Walk through one of the hosting options** in `MIGRATING.md` together
> - **Nothing — just leave it there for now**"

If they ask to zip:

```sh
zip -rq EXPORT_DIR.zip EXPORT_DIR
```

Tell them where the zip is and roughly how big.

If they ask to walk through a host, follow the matching section in
`MIGRATING.md` and help them through it.

## Edge cases

### Build is broken

The export pipeline depends on a working build. If `npm run build` fails,
stop in Step 1 with a clear explanation. Do not produce a partial export —
that breaks the trust the export is meant to deliver.

### `dist/` is huge

If `du -sh EXPORT_DIR/dist` reports more than ~200 MB, mention it: "Your built
site is on the larger side — that's usually images. Most static hosts handle
this fine, but if you hit upload limits, run `/anglesite:optimize-images`
before exporting again."

### Missing `.site-config` keys

If `SITE_NAME` is missing, ask the owner once: "What name should I use for
the export folder?" If `SITE_DOMAIN` is missing, generate `MIGRATING.md`
without the domain-specific paragraphs and tell the owner: "Your site doesn't
have a domain set yet, so I left those instructions generic. Once you do have
one, you can update `MIGRATING.md` yourself or run `/anglesite:export` again."

### Owner already has a separate backup workflow

If the owner says they just want a quick zip of the site, skip the source
copy and the MIGRATING.md walk-through and produce a minimal export with
`dist/`, `content/`, `public/`, and a one-paragraph MIGRATING.md. The full
guide is overkill for "I just want a backup."

## Keep docs in sync

After this skill runs, no project docs need updating — the export is a
side-effect, not a state change. The export folder itself is the deliverable.
