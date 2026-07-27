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

If your dev server is already running, restart it after capturing a snapshot. Snapshots are
loaded once per process and cached, so `astro dev` keeps showing a bare link until it
restarts — for both an in-body embed and a reply/bookmark/like card. Production builds
always start a fresh process, so this only affects local preview.

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
your copy still shows what it said when you captured it. Re-run the same command to refresh it.

## Instagram

Instagram has no dedicated adapter — an Instagram URL goes through the generic Open Graph
adapter, the same one used for any site this template doesn't specifically recognize. Instagram
doesn't refuse the request outright, though: it serves a generic page with no post-specific
metadata at all. So running

```sh
npm run embed -- https://www.instagram.com/p/CxYZ123
```

against an Instagram URL reports success, but the snapshot it writes has none of the real post
in it — the author is just the bare domain, the caption is the single word "Instagram," and
there's no image. (The platform can also refuse the request outright and write nothing at all —
the fix below covers that case too.)

Either way, the command's own output tells you the slug for the file it did or didn't write. On
success, the last line names it directly:

```
✓ wrote /path/to/your/site/src/embeds/a1b2c3d4e5f6.json
```

On failure, it's spelled out instead:

```
✗ https://www.instagram.com/p/CxYZ123 — no Open Graph metadata could be read.
  If the platform blocks automated requests (Instagram does), snapshot succeeds nowhere:
  save a screenshot to public/embeds/a1b2c3d4e5f6/ and add it to
  that snapshot's media[] by hand.
```

`a1b2c3d4e5f6` there is your `<slug>` — copy the one from your own terminal output, not this
example.

1. Save a screenshot of the post into `public/embeds/<slug>/`, e.g.
   `public/embeds/a1b2c3d4e5f6/screenshot.png`.
2. Open (or, if nothing was written, create) `src/embeds/<slug>.json` and make sure it reads:

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

   If the command already wrote this file, `url`, `provider`, and `capturedAt` are already
   right — leave them, and just fix `author.name` and `content`, and add the `media` entry.
   If you don't have a screenshot, leave `media` as `[]`; the card still renders with the
   author name, caption, and a link to the original post.

   Three things have to be exactly right:

   - `url` must match the URL you put on its own line in your Markdown (see "Adding an embed"
     above) — that's how the page finds this file. A single trailing slash either way is fine.
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
