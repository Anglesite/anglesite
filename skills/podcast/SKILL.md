---
name: podcast
description: "Set up a podcast on the site — episodes, RSS feed with iTunes namespace, transcripts, audio player, and platform submission"
allowed-tools: Bash(npm run build), Bash(npm run dev), Bash(npx wrangler r2 *), Bash(wc -c *), Bash(stat *), mcp__cloudflare__r2_bucket_create, mcp__cloudflare__r2_bucket_get, mcp__cloudflare__r2_buckets_list, mcp__cloudflare__r2_bucket_delete, Read, Write, Edit, Glob, Grep
disable-model-invocation: true
---

Stand up first-class podcast support: a Keystatic `episodes` collection, an RSS 2.0 feed with the iTunes and Podcast Index namespaces, episode pages with an embedded vanilla audio player, transcripts with anchored timestamps, optional YouTube video embed per episode, and a submission checklist for the major directories.

## Architecture decisions

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — episodes are static pages, the RSS feed is generated at build time
- [ADR-0002 Keystatic](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0002-keystatic-local-cms.md) — episodes live in local `.mdoc` files
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — uses the native `<audio>` element, no embedded player widget
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the owner controls the audio host and the RSS feed they submit to directories

## References

- Podcaster industry guide: `${CLAUDE_PLUGIN_ROOT}/docs/smb/podcaster.md` — pages, design, hosting, distribution, monetization
- Episode schema: `template/keystatic.config.ts` (`episodes`) and `template/src/content.config.ts` (`episodes`)
- RSS feed: `template/src/pages/podcast/rss.xml.ts`
- Episode pages: `template/src/pages/podcast/index.astro`, `template/src/pages/podcast/[slug].astro`
- Subscribe page: `template/src/pages/podcast/subscribe.astro`
- Audio player: `template/src/components/AudioPlayer.astro`

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Determine entry path

Read `.site-config` for `SITE_TYPE`, `BUSINESS_TYPE`, and any existing podcast-related keys (`PODCAST_*`).

Glob for `src/content/episodes/*.mdoc`. Then:

- **No existing episodes** → run the full setup flow (Steps 1–7)
- **Existing episodes** → run the management flow (Step 8)

If the owner's intent is unclear, ask: "Are we setting up a new podcast, or do you want to add an episode / change something about an existing show?"

---

## Step 1 — Show metadata

Ask the owner for the show-level details. Frame each question by the use case so the owner understands what it's for. Do not ask preemptively for fields that aren't required at this stage.

Required:

- **Show title** — what listeners search for in podcast apps
- **Show description** — 1–2 sentences for podcast apps and search engines
- **Language** — defaults to `en-us`. Ask if the show is in another language
- **Apple category** — see [Apple's category list](https://podcasters.apple.com/support/1691-apple-podcasts-categories). Common picks: `Technology`, `Business`, `Society & Culture`, `Comedy`, `News`, `Arts`, `Education`
- **Explicit content?** — `true` or `false`. Required by Apple Podcasts
- **Show artwork** — Apple requires a square image, 1400×1400 minimum, 3000×3000 recommended, JPEG or PNG, RGB color space, under 512 KB. Ask the owner to drop the file in `public/images/podcast/cover.jpg` (or similar)

On-demand (the iTunes feed needs an owner email — frame the ask around directory submission):

- **Owner name** — read `OWNER_NAME` from `.site-config`. If missing, ask: "Apple Podcasts requires an owner name on the feed. What name should appear there?" Save back to `.site-config` as `OWNER_NAME`.
- **Owner email** — ask: "Apple Podcasts uses a private email to verify show ownership and contact you about the feed. What email should I put on the feed? It's not displayed publicly." Save to `.site-config` as `PODCAST_OWNER_EMAIL`. Add the email to `PII_EMAIL_ALLOW` in `.site-config` so the deploy scan does not flag it (the feed exposes it inside the iTunes XML but only podcast apps read that).

Save the rest to `.site-config`:

```
PODCAST_TITLE=…
PODCAST_DESCRIPTION=…
PODCAST_AUTHOR=…
PODCAST_LANGUAGE=en-us
PODCAST_CATEGORY=Technology
PODCAST_EXPLICIT=false
PODCAST_IMAGE=/images/podcast/cover.jpg
```

These get exposed to the build via Astro's `import.meta.env` by adding the matching `PUBLIC_PODCAST_*` keys (Astro requires the `PUBLIC_` prefix for client-readable env). Update the build environment by writing them to a `.env` file the owner does not commit:

```
PUBLIC_PODCAST_TITLE=…
PUBLIC_PODCAST_DESCRIPTION=…
PUBLIC_PODCAST_AUTHOR=…
PUBLIC_PODCAST_OWNER_NAME=…
PUBLIC_PODCAST_OWNER_EMAIL=…
PUBLIC_PODCAST_IMAGE=/images/podcast/cover.jpg
PUBLIC_PODCAST_CATEGORY=Technology
PUBLIC_PODCAST_LANGUAGE=en-us
PUBLIC_PODCAST_EXPLICIT=false
```

`.env` is gitignored. For Cloudflare Pages, mirror these as Pages environment variables (Project → Settings → Variables and Secrets) so production builds can read them.

## Step 2 — Audio hosting

Tell the owner: "Audio files are large — they don't belong in the website's git repo or `public/` directory. They live on a host that serves the audio and (usually) reports download analytics. I'll embed the player on your site, but the file itself sits somewhere else."

Read the audio hosting comparison in `${CLAUDE_PLUGIN_ROOT}/docs/smb/podcaster.md` (Tools → Podcast hosting) and present the options:

- **Buzzsprout** (~$12/mo) — beginner-friendly, transcription included, basic download analytics. Good first host.
- **Transistor** (~$19/mo) — multi-show, better analytics, private podcasts.
- **Captivate** (~$19/mo) — growth-focused features, built-in calls to action.
- **Libsyn** (~$5/mo) — reliable, oldest in the space.
- **Castopod** (open source, self-hosted, requires a server) — IndieWeb / ActivityPub option.
- **Cloudflare R2** (self-hosted, ~$0.015/GB-month storage, **zero egress fees**) — the cheapest option, and Anglesite can provision the bucket and upload episodes for the owner. No download analytics out of the box (Cloudflare reports requests in aggregate). Recommended for owners already on Cloudflare and not relying on host-side analytics for sponsor reporting.

Ask the owner which they want. Save to `.site-config` as `PODCAST_HOST=r2` (or `buzzsprout`, `transistor`, `captivate`, `libsyn`, `castopod`).

### 2a. If the owner picked R2

Anglesite can provision an R2 bucket with the Cloudflare MCP tools and upload episodes through `wrangler`. The owner does not need to touch the Cloudflare dashboard.

**Cost expectations for the owner** (prices as of writing — re-check before quoting):

- **Storage**: $0.015 per GB-month. A 30-minute MP3 at ~40 MB ≈ $0.0006/month per episode. 100 episodes ≈ $0.06/month in storage.
- **Class A operations** (writes/uploads): $4.50 per million. One upload per episode is rounding error.
- **Class B operations** (reads/downloads): $0.36 per million. 100,000 episode downloads ≈ $0.04.
- **Egress (bandwidth)**: $0 — this is the reason R2 is cheap for podcasts.
- **Free tier**: 10 GB storage, 1 million Class A, 10 million Class B ops per month. Most starting podcasts stay under this for the first ~250 episodes.

Tell the owner: "For most starting podcasts, R2 is free or under $1/month. The trade-off vs. Buzzsprout is that you don't get per-episode download charts — Cloudflare gives you total request counts, but not the listener-app breakdown sponsors sometimes ask for."

Then provision:

1. **Confirm the user is logged in to Cloudflare** — run `npx wrangler whoami`. If not logged in, prompt them through `npx wrangler login` (browser OAuth).

2. **Pick a bucket name.** Use `<site-slug>-podcast-audio` (e.g., `acmeshow-podcast-audio`). R2 bucket names are globally unique within an account, lowercase, hyphens allowed. Read `SITE_SLUG` from `.site-config`; if missing, derive from `PODCAST_TITLE` (lowercased, hyphenated).

3. **Check whether the bucket already exists** with the Cloudflare MCP tool `mcp__cloudflare__r2_buckets_list`. If a bucket with the chosen name is present, reuse it; otherwise create it with `mcp__cloudflare__r2_bucket_create` (location: `auto` unless the owner has a strong reason to pin a region).

4. **Save the bucket name** to `.site-config` as `PODCAST_R2_BUCKET=<name>`.

5. **Configure public access.** R2 buckets are private by default — podcast apps need the audio at a public URL.
   - Recommended: a custom subdomain like `audio.<owner-domain>`. Tell the owner: "I'll set up `audio.<your-domain>` to serve audio files. Cloudflare DNS handles this; no extra setup needed beyond confirming the domain." Bucket → R2 → Settings → Custom Domains → Connect Domain. Save as `PODCAST_R2_PUBLIC_BASE=https://audio.<owner-domain>`.
   - Fallback: enable the `r2.dev` development URL (`https://pub-<hash>.r2.dev`). Faster to set up, but Cloudflare rate-limits it and discourages production use. Save the URL to `.site-config` as `PODCAST_R2_PUBLIC_BASE=…`.

6. **Emit the upload command** for the owner to run per episode. Tell them: "Drop the MP3 anywhere on your machine, then run this for each episode."

   ```sh
   npx wrangler r2 object put <bucket>/<slug>.mp3 --file=/path/to/episode.mp3 --content-type=audio/mpeg
   ```

   The episode's audio URL will be `${PODCAST_R2_PUBLIC_BASE}/<slug>.mp3`.

7. **Auto-fill the Keystatic episode entry** in Step 4: when the host is R2 and the owner gives a local file path, run `wc -c <path>` for `lengthBytes`, set `audioUrl` to `${PODCAST_R2_PUBLIC_BASE}/<slug>.mp3`, and (if `wrangler` is configured) run the `wrangler r2 object put` command on their behalf — only after confirming the bucket and the file path with the owner.

8. **Off-ramp.** R2 isn't a podcast host in the Buzzsprout sense. If the owner later wants per-episode analytics or transcription, they can move to a real podcast host without changing their RSS feed URL: re-host the audio elsewhere, update each episode's `audioUrl`, redeploy. Mention this when offering R2 so the owner doesn't feel locked in.

### 2b. If the owner picked any other host

The owner uploads each episode to the host's dashboard and copies the host's MP3 URL into the Keystatic episode entry. Anglesite does not store audio files on R2 or in `public/audio/` in this case.

**Do not drop audio files in `public/audio/` for production.** Cloudflare's static assets bind has a 25 MB per-file limit, but more importantly, large binaries in git slow every clone, push, and deploy. The legacy `public/audio/` path is preserved only as a last-resort fallback for very small files (e.g., a single 5 MB trailer); the deploy skill warns when files there exceed 10 MB.

## Step 3 — Activate the episodes collection

The schema is already defined in `template/src/content.config.ts` and `template/keystatic.config.ts`, but only activates when `src/content/episodes/` contains at least one file. Create the directory with a `.gitkeep`:

```sh
mkdir -p src/content/episodes public/audio public/images/podcast
```

Use the Write tool to create `src/content/episodes/.gitkeep` (empty file).

Then run `node scripts/build-keystatic-config.ts` if such a script exists, or simply rerun `npm run dev` — Astro picks up the new content directory automatically.

## Step 4 — Create the first episode

Walk the owner through filling in the first episode. Frame the questions plainly:

- **Title** — episode title (e.g., "Ep. 1: Welcome to the Show")
- **Publish date** — today by default
- **Description** — 1–3 sentences for listings, RSS, and social sharing
- **Audio** — depends on the host:
  - **R2**: ask for the local MP3 path. Upload via `npx wrangler r2 object put $PODCAST_R2_BUCKET/<slug>.mp3 --file=<path> --content-type=audio/mpeg` and set `audioUrl = $PODCAST_R2_PUBLIC_BASE/<slug>.mp3`.
  - **Hosted (Buzzsprout, Transistor, etc.)**: paste the host's RSS-ready MP3 URL (Buzzsprout labels it "MP3 URL"; Transistor calls it the "audio file URL").
  - **Legacy `public/audio/`**: only for trailers under 10 MB; set `audioUrl = /audio/<slug>.mp3`.
- **Audio file size** — bytes. Auto-fill when possible: for R2 or `public/audio/` runs, `wc -c <local-path>` before/after upload and write the result to the episode's `lengthBytes`. For hosted platforms, the host shows the size in the episode dashboard. Apple's directory listing requires this.
- **Duration** — `MM:SS` or `HH:MM:SS`
- **Episode number, season** — sequential numbering (optional but recommended; Apple uses these for sorting)
- **Episode type** — `full`, `trailer`, or `bonus`
- **Explicit?** — defaults to the show-level setting
- **Guests** — names only (free-text). Frame as "Who's on this episode?" — guest contact info doesn't go in the episode file.
- **YouTube URL** — optional. If the owner uploads a video version of the episode to YouTube, paste the watch URL here. The episode page will embed a privacy-respecting `youtube-nocookie` iframe under the audio player. See Step 4b.

Write the file at `src/content/episodes/<slug>.mdoc`. The body of the file is the **show notes and transcript** — this is the SEO-critical part. See Step 5.

### 4b. Video version (optional)

Ask the owner: "Do you also publish video versions of episodes — on YouTube, Spotify, or both? More podcasts are doing this for the discovery boost."

If yes:

1. Set `PODCAST_VIDEO=youtube` in `.site-config`. This adds `www.youtube-nocookie.com` to the site's `frame-src` CSP and updates `public/_headers` on the next build.
2. Paste the YouTube watch URL into each episode's `youtubeUrl` field. The skill embeds the player on the episode page automatically.
3. Tell the owner about Spotify's video path: in Spotify for Podcasters, upload the MP4 file to the matching episode after RSS publication. Spotify joins the audio (from RSS) and the video (uploaded directly) on its side. Apple Podcasts supports video via RSS (`<enclosure type="video/mp4">`) but most owners use the YouTube + Spotify direct-upload combo instead — this skill ships the audio-first RSS path.

Trade-offs to surface:
- YouTube embeds are a third-party iframe. Even on `youtube-nocookie`, viewers' interactions are visible to YouTube. Some owners prefer to leave the YouTube link in the show notes instead of embedding.
- The audio enclosure in RSS still wins for downloads, offline listening, and most podcast apps. Video is for discovery.

## Step 5 — Show notes and transcripts

Tell the owner: "Search engines can't listen to audio, but they can read text. Show notes and transcripts are how your podcast gets discovered through search."

### Show notes

Ask the owner to provide:

- A 2–4 sentence episode summary
- Topic timestamps (e.g., "12:34 — How we got started")
- Links mentioned in the episode
- Guest bio + their links (if applicable)
- Sponsors / disclosures (FTC requirement if monetized — see `${CLAUDE_PLUGIN_ROOT}/docs/smb/podcaster.md` Compliance)

### Timestamp anchors

Format timestamps as markdown links to special anchors. The audio player picks these up and seeks the player when clicked:

```markdown
- [12:34](#t-12-34) — How we got started
- [25:10](#t-25-10) — The hardest decision of year one
- [1:08:42](#t-1-8-42) — Listener Q&A
```

The pattern is `#t-<minutes>-<seconds>` for under an hour, `#t-<hours>-<minutes>-<seconds>` for an hour or more. The vanilla JS in `AudioPlayer.astro` parses these and calls `audio.currentTime`.

### Transcripts

Ask the owner: "Do you have a transcript? If yes, I'll add it under the show notes. If no, I can suggest tools."

Tools:
- **Whisper** (free, open source, runs locally) — `pip install openai-whisper && whisper episode.mp3`
- **Otter.ai** (free tier, cloud) — paste in audio, gets a transcript
- **Descript** (subscription) — generates a transcript while editing
- **The host's auto-transcription** — Buzzsprout, Captivate, and Riverside all offer this

If the owner has a transcript, paste it into the markdown body under a `## Transcript` heading. Format speaker turns with bold names and inline `[12:34](#t-12-34)` links every 30–60 seconds so listeners can jump to a specific spot from the transcript.

Remind the owner: auto-generated transcripts get proper nouns and technical terms wrong. Always proofread before publishing.

## Step 6 — Verify the build

Run the build:

```sh
npm run build
```

Then check:

- `dist/podcast/index.html` — episode listing
- `dist/podcast/<slug>/index.html` — episode page with audio player
- `dist/podcast/rss.xml` — feed with iTunes namespace and at least one `<item>`

Open the episode page in `npm run dev` and verify:

- The audio player loads and plays the file
- Clicking a `[12:34](#t-12-34)` link in show notes seeks the player
- The page shows duration, season/episode numbers, and guest names

Validate the RSS feed:

```sh
npx podcast-validator dist/podcast/rss.xml
```

If `podcast-validator` is not installed, point the owner at the [Cast Feed Validator](https://castfeedvalidator.com/) and the [Podbase iTunes validator](https://podba.se/validate/) with the deployed feed URL.

## Step 7 — Submit to directories

After the first deploy, walk the owner through directory submissions. **Submit once** — the directories pull updates from the RSS feed automatically afterward.

> Use this checklist as a markdown checkbox list and update it as the owner confirms each submission. Save the state to `.site-config` as `PODCAST_SUBMITTED=apple,spotify,…`.

- [ ] **Apple Podcasts Connect** — sign in at <https://podcasters.apple.com/>, click "+", paste the feed URL. Apple reviews new shows within 24–72 hours. Once approved, copy the show URL and save to `.env` as `PUBLIC_PODCAST_APPLE_URL=…`.
- [ ] **Spotify for Podcasters** — <https://podcasters.spotify.com/>, "Add a podcast" → paste feed URL. Approval is usually within an hour. Save the show URL as `PUBLIC_PODCAST_SPOTIFY_URL=…`.
- [ ] **Overcast** — Overcast pulls from Apple Podcasts; submitting to Apple is sufficient. Once the show appears in Overcast, save the URL as `PUBLIC_PODCAST_OVERCAST_URL=…`.
- [ ] **Pocket Casts** — submit at <https://www.pocketcasts.com/submit/>. Save the URL as `PUBLIC_PODCAST_POCKETCASTS_URL=…`.
- [ ] **Podcast Index** — submit at <https://podcastindex.org/add>. The open directory underpinning Podcasting 2.0 apps. Save the URL as `PUBLIC_PODCAST_INDEX_URL=…`.
- [ ] **YouTube** (optional) — separate from RSS. The owner uploads the audio (with cover art as a static video, or as a real video recording) directly. YouTube is a major podcast discovery surface. Once a video is up, paste the watch URL into the episode's `youtubeUrl` field to embed it on the website.
- [ ] **Spotify video** (optional) — Spotify for Podcasters lets the owner attach an MP4 to an existing audio episode. Spotify pulls the audio from RSS and the video from this direct upload. Worth the extra step — Spotify pushes video shows in the app.

After saving the platform URLs to `.env`, redeploy so `/podcast/subscribe/` shows direct links instead of the platform homepages.

## Step 8 — Manage existing podcast

If `src/content/episodes/*.mdoc` already exists, the owner is back to add/edit/release an episode. Ask:

- **New episode** → repeat Step 4 (creating a new `.mdoc` file)
- **Edit existing** → update the relevant `.mdoc` file
- **Update show metadata** → edit `.env` and `.site-config`, then redeploy
- **Pull stats** → defer to `/anglesite:stats` (this skill does not fetch host analytics)

Remind the owner: "You can also create or edit episodes directly in Keystatic — look under 'Podcast Episodes' in the sidebar."

After any change, run `npm run build` and verify the RSS feed still validates.

---

## Cross-skill notes

- **Newsletter integration** (`/anglesite:newsletter`) — when an episode is published, the newsletter skill can syndicate it. The episode body is markdown, so it works the same as a blog post. Suggest this once the show has a few episodes.
- **QR codes** (`/anglesite:qr`) — offer a QR code for each episode page (e.g., for a sticker, a flyer at a live show, or a guest's social bio).
- **Photography** (`/anglesite:photography`) — show artwork and guest portraits matter more for podcasts than most verticals. The photography shot list for podcasters covers this.
- **SEO** (`/anglesite:seo`) — the podcast pages get the standard SEO pass. The transcript is the biggest single SEO contribution; remind the owner not to skip it.
- **Backup** (`/anglesite:backup`) — episode `.mdoc` files commit normally. Audio files do not belong in git: hosted shows have audio at the host, R2-hosted shows have audio in the bucket, and the legacy `public/audio/` fallback should only hold tiny clips. The backup skill skips `public/audio/` files larger than 10 MB.
- **Stats** (`/anglesite:stats`) — Cloudflare reports website visits to episode pages. Audio download counts come from the podcast host (Buzzsprout, Transistor, etc.) — the website cannot see them.

## Re-running the command

`/anglesite:podcast` is idempotent. Running it again on an existing podcast enters Step 8 (manage). It does not overwrite show metadata, episodes, or `.env`.
