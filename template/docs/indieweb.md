# IndieWeb

How the website participates in the IndieWeb. Reference for the webmaster agent — read when building pages, setting up identity, or advising the owner on their online presence. Not user-facing documentation.

The IndieWeb is a movement built on a few core ideas: own your domain, own your content, publish on your own site first, and connect with other sites using open standards instead of corporate platforms. Anglesite implements these by default.

---

## What's already in place

These ship with every Anglesite site. No setup needed:

| Feature | Where | What it does |
|---|---|---|
| `h-card` | Site header (`BaseLayout.astro`) | Machine-readable identity: business name + URL |
| `h-entry` | Blog posts (`[slug].astro`) | Machine-readable posts: title, date, content, photo, tags |
| `h-feed` | Blog listing (`/blog/index.astro`) | Machine-readable feed of posts |
| `u-syndication` | Blog posts | Links back to copies on social media |
| RSS feed | `/rss.xml` | Feed readers and podcast apps |
| Feed discovery | `<link rel="alternate">` in `<head>` | Feed readers auto-discover the RSS feed |
| POSSE workflow | Keystatic syndication field | Publish here first, share elsewhere, record the links |
| Domain ownership | Cloudflare Registrar | Owner controls DNS, email, identity |
| `h-event` | Events (`/events/index.astro`, `/events/[slug].astro`) | Machine-readable events with `Event` JSON-LD; add entries to the `events` Keystatic collection |

---

## rel="me" — Identity verification

`rel="me"` links connect the website to the owner's social profiles. They're how the IndieWeb verifies "this website and this social account belong to the same person/business."

### When to add

During `/anglesite:start` Step 2 (design interview), when asking about social profiles. Also during `/anglesite:domain` when setting up Bluesky verification.

### How to add

Add `rel="me"` to social links in the site footer or about page:

```html
<a href="https://instagram.com/businessname" rel="me">Instagram</a>
<a href="https://bsky.app/profile/businessname.com" rel="me">Bluesky</a>
<a href="https://facebook.com/businessname" rel="me">Facebook</a>
```

### Common platforms

| Platform | URL format |
|---|---|
| Instagram | `https://instagram.com/USERNAME` |
| Bluesky | `https://bsky.app/profile/DOMAIN` (after domain verification) |
| Facebook | `https://facebook.com/PAGE` |
| LinkedIn | `https://linkedin.com/in/USERNAME` or `https://linkedin.com/company/NAME` |
| YouTube | `https://youtube.com/@HANDLE` |
| TikTok | `https://tiktok.com/@USERNAME` |
| Mastodon | `https://INSTANCE/@USERNAME` |
| GitHub | `https://github.com/USERNAME` |
| Yelp | `https://yelp.com/biz/BUSINESS-SLUG` |
| Google Business | Not linkable with rel="me" (use Google site verification instead) |

### Two-way verification

For full IndieWeb verification, the social profile should link back to the website:

- **Instagram** — Add website URL to bio
- **Bluesky** — Use domain as handle (see `/anglesite:domain` → Bluesky verification)
- **Mastodon** — Add website URL to profile; Mastodon checks `rel="me"` automatically and shows a verified badge
- **GitHub** — Add website URL to profile
- **Other platforms** — Add website URL wherever the platform allows a "website" field

Tell the owner: "I've added links to your social profiles on the website. If you add your website URL to your profile on those platforms too, some of them will show a verified badge."

---

## Microformats reference

Microformats are CSS classes that make content machine-readable. Search engines, feed readers, and IndieWeb tools use them. The scaffold adds them to templates — the owner never needs to think about them.

### h-card (identity)

On the site header. Tells machines "this is who owns this site."

Required properties:

- `p-name` — business name
- `u-url` — site URL

Optional properties to add during `/anglesite:design-interview` if the business has a physical location:

- `p-adr` — address (wrap in an `<address>` element)
- `p-tel` — phone number
- `p-locality` — city
- `p-region` — state
- `p-postal-code` — ZIP
- `u-photo` — logo or business photo

Example with location:

```html
<header class="h-card">
  <a href="/" class="p-name u-url">Pairadocs Farm</a>
  <address>
    <span class="p-street-address">128 Pullets Dr</span>,
    <span class="p-locality">Central</span>,
    <span class="p-region">SC</span>
    <span class="p-postal-code">29630</span>
  </address>
  <a href="tel:+15551234567" class="p-tel">(555) 123-4567</a>
</header>
```

### h-entry (blog posts)

On each blog post. Tells machines "this is a piece of content."

Properties already in the blog template:

- `p-name` — post title
- `dt-published` — publish date (ISO 8601 datetime)
- `e-content` — post body
- `u-photo` — featured image
- `p-category` — tags
- `u-syndication` — links to copies on social media

### h-feed (blog listing)

On the blog listing page. Wraps the collection of `h-entry` items so machines can discover the feed.

```html
<div class="h-feed">
  <h1 class="p-name">Blog</h1>
  <!-- h-entry items here -->
</div>
```

### h-event (events)

For businesses that host events — venues, theaters, farms, fitness studios, breweries, museums, houses of worship. Ships as a real feature, not just markup guidance: `/events/index.astro` lists upcoming entries from the `events` Keystatic collection, and `/events/[slug].astro` renders each one with both `h-event` microformats and `Event` JSON-LD (the two serve different audiences — microformats for IndieWeb tools, JSON-LD for search engines).

To add an event, create an entry in the **Events** collection in Keystatic (`title`, `date`, `time`, `endTime`, `location`, `description`, `recurring`, `image`) — the page and both markup formats are generated automatically. No page-authoring needed.

Properties rendered:

- `p-name` — event name
- `dt-start` — start date (ISO 8601, day-level — the schema stores time-of-day as free text, not a timezone-aware value, so only the date is encoded in the datetime attribute; the human-readable time is shown alongside it)
- `dt-end` — present when `endTime` is set
- `p-location` — venue name or address
- `p-summary` — short description
- `e-content` — full description (Markdoc body)
- `u-url` — link to event page

The index page filters one-time events whose `date` has passed; events with a `recurring` value (e.g. "weekly") always stay listed — keep `date` pointed at the next occurrence.

Business types that commonly need events: `event-venue`, `community-theater`, `farm`, `brewery`, `fitness`, `museum`, `house-of-worship`, `bookshop`, `entertainment`, `dance-studio`, `marina`, `tour-guide`. Suggest enabling it (adding a link to `/events/`) for these types during `/anglesite:start`.

---

## Active IndieWeb — run your own endpoints

Everything above (microformats, `rel="me"`, RSS, POSSE) is **passive** — static HTML that needs no server. The **active** IndieWeb adds live endpoints: IndieAuth (sign in to other services with the domain), Webmention (receive cross-site mentions), and Micropub (publish from third-party clients).

The per-protocol guidance below still includes the easy third-party path (webmention.io, indieauth.com delegation). But when the owner wants to **own** those endpoints — keeping identity, tokens, and data on their own Cloudflare account — `/anglesite:indieweb` deploys the [`@dwk/*`](https://github.com/davidwkeith/workers) endpoint trio into the site's own Worker, rooted at the primary domain. It's the self-owned alternative that fits the "you own everything" stance.

When to reach for it:

- The owner is IndieWeb-aware and wants to run their own endpoints, not delegate them
- The site is on a **custom domain** (identity must be HTTPS-rooted there — the skill refuses on a bare `*.workers.dev` address)
- It's an opt-in enhancement — don't offer it during `/anglesite:start`

> The `@dwk/*` packages are published on npm (`0.1.0-beta.2`+). `/anglesite:indieweb`'s Step 1 still runs a live install-and-import smoke test before proceeding — a published version alone isn't a guarantee the compiled build loads cleanly under Node ESM — and reports "not available yet" only if that check fails. Plugin maintainers: see `docs/platforms/dwk-workers.md` and ADR-0020 for the integration design.

---

## Webmentions

Webmentions let other websites notify yours when they link to your content — like @mentions but across the open web. A blogger who links to the owner's post can send a webmention, and it appears on the post.

### When to add

This is an optional enhancement. Recommend it when:

- The owner is active in a community that uses webmentions (bloggers, IndieWeb, tech)
- The owner wants to display cross-site replies on their posts
- The owner has been running the site for a while and wants deeper integration

Don't recommend it during `/anglesite:start`. It adds complexity that most SMB owners don't need initially.

### Setup

**Option 1: webmention.io (easiest)**

1. Owner signs in at webmention.io using their domain (requires `rel="me"` links — see above)
2. Add to `BaseLayout.astro` `<head>`:

   ```html
   <link rel="webmention" href="https://webmention.io/DOMAIN/webmention" />
   ```

3. Update CSP in `public/_headers`: add `webmention.io` to `connect-src` if fetching mentions client-side (not needed if only receiving)
4. Webmentions are collected by webmention.io and can be displayed on posts

**Option 2: Self-owned endpoint via `/anglesite:indieweb` (recommended for ownership)**

Run the owner's own Webmention endpoint on their domain instead of delegating to webmention.io. `/anglesite:indieweb` deploys `@dwk/webmention` into the site's Worker: it receives mentions, verifies the source link asynchronously, stores them in a D1 inbox, and edge-renders them onto the target page (no client JS). No third-party dependency; the mention data lives only on the owner's Cloudflare account. See the "Active IndieWeb" section above and `docs/platforms/dwk-workers.md`.

Display details: the note and blog post templates ship an empty `<div id="webmentions">` after the article; the Worker fills it per-request (h-cite list with author, avatar, content, permalink) only for pages that actually have verified mentions — mention-free pages serve unchanged, and new mentions appear within about a minute. Styling lives under the `.webmentions-*` rules in `src/styles/global.css` (it must stay global — scoped Astro styles can't reach edge-injected markup).

**Option 3: Static webmentions (build-time)**

Fetch webmentions during `npm run build` and bake them into the HTML. No client-side JavaScript needed. Use the webmention.io API or a self-hosted endpoint. This fits Anglesite's zero-JS philosophy.

### Sending webmentions

Ships as a real feature when Webmention is enabled — not a third-party pointer. `scripts/send-webmentions.ts` runs as part of `/anglesite:deploy` (gated on `INDIEWEB_WEBMENTION=true`): it scans the built blog posts and notes for external links inside `e-content`, discovers each target's Webmention endpoint (HTTP `Link` header, then `<link rel="webmention">`), and sends one. This closes the loop with the site's own receiving endpoint instead of falling back to `webmention.io` or a manual tool — the self-owned story is complete on both directions.

Each `(post, link)` pair is attempted once, ever; the outcome is tracked in `webmention-sent.json` at the project root, which is committed to the repo like `.site-config` so state survives across deploys. Targets are checked against a private/loopback-address guard before any request goes out. Run it directly with `npm run ai-webmention-send`.

### Backfeed from social replies (Brid.gy)

The POSSE workflow (see above) records where a post was syndicated — the `syndication` field, rendered as `u-syndication` links. Those social copies still collect their own likes, replies, and reposts on the silo (X, Mastodon, Bluesky) — none of that activity reaches the canonical post automatically.

[Brid.gy](https://brid.gy) closes that loop: it polls the owner's connected social accounts, matches activity on syndicated posts back to the original via the `u-syndication` link, and sends a webmention to the site for each one — likes, replies, and reposts all show up as regular webmentions in the site's inbox, no different from a mention sent directly. It's a free, well-established IndieWeb community service (not a paid SaaS), but it **is** a third-party dependency — the one piece of the loop that doesn't run entirely on the owner's own infrastructure. Mention it as optional, not a default step.

Prerequisites (all already true for a site with Webmention enabled and POSSE in use):

- `rel="me"` links to the social profiles being connected (passive layer, ships by default)
- A Webmention receiving endpoint on the owner's domain (`/anglesite:indieweb`, Webmention selected)
- Syndication links recorded on posts (the owner's normal POSSE habit — see `/anglesite:syndicate`)

Setup (owner-facing, not something the skill automates — Brid.gy account linking happens on brid.gy's own site):

1. Go to `https://brid.gy` and sign in with the site's domain (IndieAuth, since the site already has an endpoint)
2. Connect each social account Brid.gy supports that the owner posts to
3. Brid.gy starts polling; new likes/replies/reposts on syndicated copies arrive as webmentions within its normal poll interval — no further setup on the Anglesite side

If the owner later disables Webmention or removes `/anglesite:indieweb`, backfeed simply stops arriving (the receiving endpoint is gone) — nothing to clean up on Brid.gy's side beyond disconnecting the account there.

---

## IndieAuth

IndieAuth lets the owner sign into IndieWeb services using their domain name as their identity — no username/password needed. The domain IS the identity.

### When to add

Only when the owner wants to use IndieWeb services (IndieWeb wiki, Micropub clients, webmention dashboards). Most SMB owners won't need this.

### Setup (delegation)

The simplest approach — delegate authentication to an existing provider:

Add to `BaseLayout.astro` `<head>`:

```html
<link rel="authorization_endpoint" href="https://indieauth.com/auth" />
```

This tells IndieWeb services: "To verify this domain's owner, use indieauth.com." The owner signs in via one of their `rel="me"` linked profiles.

Requirements:

- At least one `rel="me"` link on the site (see above)
- The linked profile must link back to the website

### Setup (self-owned, via `/anglesite:indieweb`)

For owners who want full control, `/anglesite:indieweb` deploys `@dwk/indieauth` into the site's Worker — the authorization, token, and metadata endpoints on the owner's own domain, with PKCE and DPoP-bound tokens. The domain becomes a real IndieAuth provider, not a delegate. The tokens it issues are what `@dwk/micropub` consumes (see below). See the "Active IndieWeb" section above and `docs/platforms/dwk-workers.md`. Advanced; only for owners who actively use IndieWeb services.

---

## Micropub

Micropub lets the owner publish to their own site from third-party apps (a phone client, a bookmarklet) — short notes, photos, replies — without opening the editor. The site is the canonical home; the client is just an input device.

### When to add

Only when the owner actively wants to post from a Micropub client and has IndieAuth set up (Micropub authorizes via IndieAuth tokens). Niche; most SMB owners use the Keystatic editor instead.

### Setup (self-owned, via `/anglesite:indieweb`)

`/anglesite:indieweb` deploys `@dwk/micropub` into the site's Worker (create/update/delete, plus an R2-backed media endpoint). Because Anglesite is a static site, a created post is bridged into real content: the endpoint stores it, a worker bridge commits it as a `.mdoc` in a `notes` collection, and the GitHub Actions deploy workflow rebuilds the site. The post is queryable instantly and **live on the site after the rebuild (~1–2 min)** — set this expectation with the owner. Note that the endpoint requires DPoP on every request, so only DPoP-capable Micropub clients work. See `docs/platforms/dwk-workers.md`.

---

## What to tell the owner

The owner doesn't need to understand IndieWeb terminology. Here's what matters to them:

- **"Your website is yours."** You own the domain, the code, and all the content. No platform can take it away or change the rules on you.
- **"Post here first."** When you write something, put it on your website first. Then share it on social media. If a social platform shuts down, your content is still here.
- **"Your domain is your identity."** Your website address is your permanent online address. Social media handles change — your domain doesn't.
- **"Other websites can talk to yours."** (Only when webmentions are set up.) When someone links to your blog post from their website, you'll see it — like a comment, but from across the web.

---

## Checklist for the agent

### During `/anglesite:start` and `/anglesite:design-interview`

- [ ] `h-card` in site header has `p-name` and `u-url`
- [ ] `h-card` includes location properties if business has a physical address
- [ ] `rel="me"` links added for each social profile the owner mentions
- [ ] Social profile URLs use the correct format (see table above)

### During `/anglesite:deploy`

- [ ] `h-entry` markup on blog posts (p-name, dt-published, e-content)
- [ ] `h-feed` wrapper on blog listing page
- [ ] RSS feed at `/rss.xml` with discovery link in `<head>`
- [ ] Syndication links render as `u-syndication` with `rel="syndication"`

### When creating an event

- [ ] Entry added to the `events` Keystatic collection (title, date, description at minimum)
- [ ] `/events/[slug].astro` renders `h-event` markup and `Event` JSON-LD automatically — no manual markup needed

### When owner is ready for advanced features

- [ ] Webmention endpoint configured (webmention.io or self-hosted)
- [ ] IndieAuth delegation or endpoint configured
- [ ] Two-way `rel="me"` verification confirmed
