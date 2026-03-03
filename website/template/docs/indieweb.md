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
  <a href="/" class="p-name u-url">Joe's Pizza</a>
  <address>
    <span class="p-street-address">123 Main St</span>,
    <span class="p-locality">Springfield</span>,
    <span class="p-region">IL</span>
    <span class="p-postal-code">62701</span>
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

For businesses that host events — venues, theaters, farms, fitness studios, breweries, museums, houses of worship. Add `h-event` markup when creating event pages or event listings.

Properties:
- `p-name` — event name
- `dt-start` — start date/time (ISO 8601)
- `dt-end` — end date/time (ISO 8601)
- `p-location` — venue name or address
- `p-summary` — short description
- `e-content` — full description
- `u-url` — link to event page

Example:

```html
<article class="h-event">
  <h2 class="p-name">Fall Harvest Festival</h2>
  <time class="dt-start" datetime="2025-10-11T10:00:00-05:00">Oct 11, 10am</time> –
  <time class="dt-end" datetime="2025-10-11T16:00:00-05:00">4pm</time>
  <span class="p-location">Green Acres Farm, Springfield, IL</span>
  <div class="e-content">
    <p>Apple picking, corn maze, hayrides, and cider donuts.</p>
  </div>
</article>
```

Use `h-event` alongside the `Event` JSON-LD structured data that SMB files already recommend. They serve different audiences — microformats for IndieWeb tools, JSON-LD for search engines.

Business types that commonly need events: `event-venue`, `community-theater`, `farm`, `brewery`, `fitness`, `museum`, `house-of-worship`, `bookshop`, `entertainment`, `dance-studio`, `marina`, `tour-guide`.

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

**Option 2: Cloudflare Worker (self-hosted)**

Build a Worker that receives webmention POST requests, validates them, and stores them in KV or D1. More control, no third-party dependency, but more work to build.

**Option 3: Static webmentions (build-time)**

Fetch webmentions during `npm run build` and bake them into the HTML. No client-side JavaScript needed. Use the webmention.io API or a self-hosted endpoint. This fits Anglesite's zero-JS philosophy.

### Sending webmentions

When the owner publishes a post that links to another website, the site can notify that website. This is done at build time or deploy time:
- Use a tool like `webmention.app` or a build script that scans the post for external links and sends webmentions
- This is advanced and optional — most SMB sites receive more than they send

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

### Setup (self-hosted)

For owners who want full control, build an authorization endpoint as a Cloudflare Worker. This is advanced and rarely needed for SMB sites.

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

### When creating event pages
- [ ] `h-event` markup with dt-start, dt-end, p-name, p-location
- [ ] Corresponding `Event` JSON-LD structured data

### When owner is ready for advanced features
- [ ] Webmention endpoint configured (webmention.io or self-hosted)
- [ ] IndieAuth delegation or endpoint configured
- [ ] Two-way `rel="me"` verification confirmed
