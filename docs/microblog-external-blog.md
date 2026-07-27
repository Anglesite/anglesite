# Connecting an Anglesite site to Micro.blog

Micro.blog can follow any deployed Anglesite site as an "external blog": it
polls your feed, adds new posts to your Micro.blog timeline, and (if you
enable it) cross-posts them to other networks. This guide covers registering
the feed, verifying you own the site, optionally letting the Micro.blog apps
post directly to your site via Micropub, and why Micro.blog doesn't need a
dedicated POSSE client in Anglesite.

It assumes a site that's already been deployed (`File ▸ Deploy…`, or the
Deploy tab) with a working public URL.

## 1. Register your feed

Micro.blog treats "the feeds on your account" as the source of your own
timeline — under **Account ▸ Edit Feeds & Cross-posting**, add your site's
feed URL. Per Micro.blog's own docs: "adding feeds to your account on
Micro.blog controls where *your own posts* come from" (see
[Micro.blog and feeds](https://book.micro.blog/microblog-and-feeds/)).

Recommended: register the **JSON Feed**, `https://yoursite.example/feed.json`.
`https://yoursite.example/rss.xml` also works and is advertised as an
alternate on every page (`<link rel="alternate" ... href="/rss.xml">` in
[`BaseLayout.astro`](../Resources/Template/src/layouts/BaseLayout.astro)),
but JSON Feed is the closer match to Micro.blog's own microblog conventions
(next section).

Micro.blog checks feeds for external (non-Micro.blog-hosted) blogs "every
few minutes," or immediately if it's notified of a new post — see
[Micro.blog and feeds](https://book.micro.blog/microblog-and-feeds/).

### Title-less posts already read correctly

This epic changed how Anglesite renders short posts in feeds: **notes,
replies, likes, and photos never carry a synthesized title** — the feed item
omits `title` entirely rather than faking one from an excerpt (see
`FEED_COLLECTIONS` and `toFeedItem` in
[`feeds.ts`](../Resources/Template/src/lib/feeds.ts)). The full post body
renders inline as `content_html` in JSON Feed, as the RSS `<description>`,
and as Atom's `<content type="html">`.

This matches Micro.blog's own textcasting model. JSON Feed's spec (which
Micro.blog helped originate) exists in part for "microblogs, which are often
plain text and without titles" — see
[JSON Feed](https://book.micro.blog/json-feed/). Micro.blog's RSS guidance
for microblog-style posts is the same: keep `<title>` off title-less items
and put the full post in `<description>` rather than splitting it across
`<description>`/`<content:encoded>` — see
[RSS for microblogs](https://book.micro.blog/rss-for-microblogs/). Anglesite's
RSS renderer already does this (`renderRss` in `feeds.ts` emits
`i.contentHtml` as `<description>`, and only emits `<title>` when the item
has one).

Likes, replies, and bookmarks with no written commentary still emit
something concrete rather than empty content: Anglesite falls back to a link
to the target URL (`interactionContentFallback` in `feeds.ts`), so an
"empty" like or reply still syndicates its point of reference.

Tags (`entry.data.tags`) come through as `<category>` in RSS/Atom and JSON
Feed's `tags` array; each tag also gets a browsable `/tags/<slug>/` page on
your own site.

## 2. Verify you own the site (rel=me)

Micro.blog (and IndieAuth generally) verifies site ownership with
bidirectional `rel="me"` links: your site links out to a profile (e.g. your
Micro.blog profile), and that profile links back to your site. Micro.blog's
docs put it as: "your profile on that platform also links back to your
blog, confirming your blog and the profile are owned by the same person" —
see [IndieAuth](https://book.micro.blog/indieauth/).

Anglesite already supports this — no code changes were needed for this doc.
From the site window: **Website ▸ Add Integration… ▸ IndieWeb**. That
integration's "Profile link" fields (up to three) write `<link rel="me">`
tags into every page's `<head>` (see the `indieweb` descriptor in
[`IntegrationCatalog.swift`](../Sources/AnglesiteCore/IntegrationCatalog.swift)
and its output in
[`BaseLayout.astro`](../Resources/Template/src/layouts/BaseLayout.astro)).
Add your `https://micro.blog/<you>` profile URL as one of the three, then
add your site's URL to the "also known as" / website field on your
Micro.blog profile so the link is mutual.

Anglesite's IndieWeb integration also enables webmention/pingback discovery
(a `webmention.io` username field) and the template unconditionally
advertises `<link rel="indieauth-metadata" href="/.well-known/oauth-authorization-server">`
for IndieAuth sign-in (OAuth Server Metadata / RFC 8414) — useful if you
ever want to sign in to other IndieWeb tools with your Anglesite site as
your identity, independent of Micro.blog.

## 3. Enable cross-posting on Micro.blog's side

Once your feed is added as a source, the same **Edit Feeds & Cross-posting**
screen "controls which feeds cross-post to other platforms like Bluesky or
Mastodon" — toggle the networks you want there. Per Micro.blog: "When
Micro.blog sees a new post in your feed, it adds it to the Micro.blog
timeline and also cross-posts it [to] those platforms that are enabled" —
see [Micro.blog and feeds](https://book.micro.blog/microblog-and-feeds/).
This is entirely configured on Micro.blog's side; Anglesite doesn't need to
know which networks Micro.blog forwards to.

## 4. Optional: post to your site from the Micro.blog apps (Micropub)

Micro.blog's iOS and Mac apps can post to any site that implements
[Micropub](https://book.micro.blog/micropub/), the same protocol Micro.blog
uses for its own hosted blogs. Anglesite's site template composes
`@dwk/micropub` into the per-site Cloudflare Worker
(`handleMicropub` in
[`worker.ts`](../Resources/Template/worker/worker.ts)), exposing
`POST /micropub` and a media-upload endpoint, backed by IndieAuth-issued
bearer tokens.

To use it:

1. Activate the **Micropub** worker for your site: **Site Settings ▸
   Workers**, toggle it on. (This mirrors `SiteSettings.activeWorkerIDs` —
   see `WorkerRow` in
   [`PlistEditorModel.swift`](../Sources/AnglesiteApp/PlistEditorModel.swift).)
   Until it's activated, `/micropub` returns `503` rather than posting
   anything (`handleMicropub` checks for the required D1/IndieAuth bindings
   before dispatching).
2. Sign in to your site from a Micropub client via IndieAuth to get a
   token.

**Known gap:** Micro.blog's own docs say a self-hosted site needs to
advertise its endpoint with `<link rel="micropub" href="https://example.com/micropub">`
on the homepage for auto-discovery (see
[Micropub](https://book.micro.blog/micropub/)). Anglesite's
`BaseLayout.astro` does not yet emit that `<link>` tag (it advertises
`rel="me"`, `rel="webmention"`, and `rel="indieauth-metadata"`, but not
`rel="micropub"`), and the worker doesn't send a `Link:` HTTP header either.
Until that's added, a Micropub client that requires auto-discovery may not
find the endpoint automatically even after step 1 above. This is a
follow-up for whoever picks up the Micropub-in-Micro.blog integration next,
not something this docs-only change should silently paper over.

## Why Micro.blog is not a POSSE target

Micro.blog does **not** join the POSSE target list in
[`POSSEClients.swift`](../Sources/AnglesiteCore/POSSEClients.swift)
(currently Mastodon and Bluesky). Rationale: Micro.blog ingests the site's
own feed (PESOS-free syndication at the platform edge), so a push-style
POSSE client is redundant; cross-posting *from* Micro.blog onward is
configured on Micro.blog itself.

In other words: sections 1–3 above (feed registration, `rel=me`
verification, cross-posting toggles) are the entire integration surface for
syndicating *to* Micro.blog and onward. There's no "push a copy to
Micro.blog" client to add to `POSSEClients.swift`, because Micro.blog
already pulls from the feed Anglesite publishes.

## References

- [Micro.blog and feeds](https://book.micro.blog/microblog-and-feeds/) — Sources, cross-posting toggles, polling cadence
- [RSS for microblogs](https://book.micro.blog/rss-for-microblogs/) — title-less items, full HTML in `<description>`
- [JSON Feed](https://book.micro.blog/json-feed/) — `content_html`, title-less microblog posts
- [IndieAuth](https://book.micro.blog/indieauth/) — `rel=me` verification, IndieAuth sign-in
- [Micropub](https://book.micro.blog/micropub/) — posting API, endpoint discovery via `rel=micropub`
