# Embedding social posts

Anglesite embeds posts from X, Bluesky, Mastodon, YouTube — and any other URL — without
loading a single line of the platform's JavaScript and without your visitors' browsers ever
talking to the platform. It does this by **snapshotting** the post into your own site repo.

## Adding an embed

1. Snapshot the post:

   ```sh
   npm run embed -- https://x.com/jack/status/20
   ```

2. Put the URL on a line by itself in your Markdown:

   ```markdown
   Here's where it all started.

   https://x.com/jack/status/20

   Twenty years later…
   ```

3. Commit `src/embeds/` and `public/embeds/` along with your post.

That's it. The URL renders as a card; everything it displays is served from your own domain.

### After capturing or editing a snapshot, build with `--force`

Two separate caches sit between a snapshot file and the page:

- **Your dev server.** Snapshots are loaded once per process, so `astro dev` keeps showing a
  bare link — for both an in-body embed and a reply/bookmark/like card — until you restart it.
- **Astro's on-disk content cache** (`node_modules/.astro/`). It doesn't know a snapshot file
  changed, so an **in-body** embed can keep rendering the old card across repeated production
  builds. This is not just a local-preview problem: a container that keeps that directory
  between deploys will publish the stale card.

So whenever you capture a snapshot, hand-edit one, or change `EMBED_VIDEO_INLINE`, build with:

```sh
npx astro build --force
```

(Deleting `node_modules/.astro/` before an ordinary build does the same thing.) Reply, bookmark,
and like cards come from the page layout rather than the Markdown pipeline, so they aren't
affected — those pick up a changed snapshot on an ordinary build.

To sweep a site you've already written, snapshot every bare URL at once:

```sh
npm run embed -- --all
```

`--all` is a best-effort textual sweep: it finds bare URLs alone on a line and skips fenced
code blocks, but it isn't the same detection the renderer uses. It can miss a post already
written as an explicit link — `[https://x.com/jack/status/20](https://x.com/jack/status/20)`
— which still renders as a card. Anything `--all` misses can always be captured by passing
the URL explicitly, as in step 1 above.

## Reply, bookmark, and like context

Set `inReplyTo`, `bookmarkOf`, or `likeOf` in a post's frontmatter and snapshot that URL — the
cited post renders as a card with correct `h-cite` microformats, which is what other IndieWeb
sites read when they receive your Webmention.

## Only public addresses are fetched

The snapshotter refuses any URL that points at a private or internal address — your own
machine, your local network, or a cloud provider's internal metadata service — and it
re-checks after every redirect, so a public page can't bounce it somewhere private.

This matters most for `--all`, which fetches every bare URL it finds without asking you about
each one. If your site has content you didn't write yourself — an imported site, a guest post,
anything pasted in — that sweep would otherwise happily fetch whatever those URLs point at and
publish what came back.

If you see `refusing to fetch a private or reserved address`, that's this guard. A URL on your
own machine can't be snapshotted, which is intended: a snapshot gets committed and published,
so it has to come from somewhere your visitors could reach too.

## What happens if you skip the snapshot

Nothing breaks. An un-snapshotted URL stays an ordinary link. Builds never contact the network,
so a platform being down, rate-limiting you, or deleting the post can never fail your build.

## Why snapshots instead of live embeds

- **No tracking.** A normal embed lets the platform see every visitor to your page. A snapshot
  is just HTML and images from your own domain.
- **It outlives the platform.** The post is in your git repo. If the account is deleted, the
  post is removed, or the platform shuts off its API, your page keeps rendering.
- **Fast pages.** No third-party scripts, no render-blocking requests.

The trade-off: a snapshot is a point-in-time capture. If the original post is later edited,
your copy still shows what it said when you captured it. Re-run the same command to refresh it,
then rebuild with `npx astro build --force` so the cached Markdown render is thrown away too
(see "After capturing or editing a snapshot, build with `--force`" above).

## Instagram

Instagram has no dedicated adapter — an Instagram URL goes through the generic Open Graph
adapter, the same one used for any site this template doesn't specifically recognize.
Instagram reliably returns HTTP 200 with no post-specific metadata at all (just a bare
`<title>Instagram</title>`, no `og:` tags whatsoever), and the snapshotter treats that as a
failure rather than writing a card with none of the real post in it. So running

```sh
npm run embed -- https://www.instagram.com/p/CxYZ123
```

against an Instagram URL fails and writes nothing:

```
✗ https://www.instagram.com/p/CxYZ123 — no Open Graph metadata could be read.
  If the platform blocks automated requests (Instagram does), snapshot succeeds nowhere.
  Nothing was written, so create src/embeds/a1b2c3d4e5f6.json by hand,
  and reference any screenshot you save under public/embeds/a1b2c3d4e5f6/
  from its media[]. See integrations/docs/embeds-setup.md ▸ Instagram.
```

(The platform can also refuse the request outright instead of serving that empty page — the
fix below covers that case too, and reports the same way.)

`a1b2c3d4e5f6` there is your `<slug>` — the command derives it from the URL and prints it in
this message even though it wrote nothing, so copy the one from your own terminal output, not
this example. You'll need it for both steps below.

1. Save a screenshot of the post into `public/embeds/<slug>/`, e.g.
   `public/embeds/a1b2c3d4e5f6/screenshot.png`.
2. Since the command didn't write a snapshot, create `src/embeds/<slug>.json` by hand:

   ```json
   {
     "version": 1,
     "url": "https://www.instagram.com/p/CxYZ123",
     "provider": "opengraph",
     "author": {
       "name": "Name as it appears on the post"
     },
     "content": "The post's caption, as plain text",
     "capturedAt": "2026-07-26T00:00:00.000Z",
     "media": [
       {
         "src": "/embeds/a1b2c3d4e5f6/screenshot.png",
         "alt": "Describe what's in the screenshot"
       }
     ]
   }
   ```

   If you don't have a screenshot, leave `media` as `[]`; the card still renders with the
   author name, caption, and a link to the original post.

   Three things have to be exactly right:

   - `url` must match the URL you put on its own line in your Markdown (see "Adding an embed"
     above) — that's how the page finds this file. Instagram goes through the generic Open Graph
     path, which only normalizes away a trailing slash — a query string must otherwise match
     exactly between the two, so if Instagram's "Copy link" button appended `?utm_source=…`,
     either put that same query string in both places or leave it out of both. (Platforms with
     a dedicated adapter — X, YouTube, Bluesky, Mastodon — do get broader normalization: their
     tracking parameters like `?s=…`/`?t=…` are stripped and short forms like `youtu.be/…` or
     `twitter.com/…` resolve to the same snapshot. That doesn't apply here.)
   - `provider` must be the string `"opengraph"` — there is no Instagram-specific value.
   - `media[].src` must start with `/embeds/` and point at a file that actually exists under
     `public/embeds/`. Anything else is dropped silently — that image just won't render, even
     though the rest of the card does.

3. Commit the JSON file and the screenshot together, same as any other snapshot.

## Playing videos inline (optional)

By default a YouTube URL renders as a thumbnail linking to the video — no third-party requests.
To play videos in the page instead, add to `.site-config`:

```
EMBED_VIDEO_INLINE=true
```

This uses `youtube-nocookie.com` and loads the player only when the visitor scrolls to it. It
is the one setting here that permits any third-party connection, which is why it's off by
default and why `frame-src` widens to exactly that one host and nothing else.
