# Podcaster

Covers: independent podcast shows, podcast networks, interview-format podcasts, narrative/storytelling podcasts, educational podcasts, podcast studios offering production services, live podcast events. See also [creator.md](creator.md) for general content creators and [video-creator.md](video-creator.md) for video-first creators. See the "Podcast and video as marketing" section in [content-guide.md](../content-guide.md) for businesses using a podcast as a marketing channel.

## Pages

- **Episodes** — The episode archive. Each episode is a blog post with: embedded audio player, show notes, guest info and links, timestamps/chapters, transcript. This is the single most important thing for podcast SEO — search engines can't listen to audio but they can read show notes and transcripts. Newest first, organized by season if applicable. Filter by topic/tag if the show covers multiple subjects.
- **About** — What the show is about, who it's for, who hosts it. Include a short "elevator pitch" version (1–2 sentences for sharing) and a longer version. Host bio with photo. Origin story. If there are multiple hosts, individual bios.
- **Subscribe / listen** — Links to every platform where the show is available: Apple Podcasts, Spotify, YouTube, Overcast, Pocket Casts, Amazon Music, RSS feed. Make the RSS feed prominently available — it's the open standard and ensures listeners can use any app. Include simple instructions: "Search for [show name] in your podcast app, or paste this RSS link."
- **Guests** — If the show features guests: a guest directory with name, episode link, and brief bio. Past guests check this page. Potential guests check this page. It's also great for SEO — each guest name is a searchable term.
- **Contact / pitch** — How to suggest topics, pitch as a guest, or send listener feedback. If the show accepts guest pitches, include what makes a good guest and what to include in the pitch (topic, credentials, previous appearances). Business inquiries and sponsorship contacts separated from listener feedback.
- **Sponsorship / advertise** — If the show accepts sponsors: audience demographics, download numbers, audience description, ad formats offered (pre-roll, mid-roll, host-read, produced), pricing or "contact for rates," past sponsors (if they're willing to be listed). This is the podcast's sales page.
- **Blog / news** — Show announcements, behind-the-scenes, host commentary, bonus content, show milestones, listener spotlights.
- **Newsletter** — Email list for show announcements, episode notifications, bonus content. The most valuable audience asset — platform-independent. "Get new episodes in your inbox."
- **Live events** — If the show does live recordings, meetups, or touring shows. Dates, venues, ticket links.
- **Merch / support** — Show merch, listener support (Patreon, Ko-fi, memberships), bonus episodes behind a paywall.

## Design

**Visual mood:** Clean, audio-focused, and inviting. The site can be bold or minimal depending on the show's personality — a true-crime podcast feels different from a comedy show. The design should reflect the show's tone, but audio content needs clear structure more than visual flair.

**Color direction:** Show brand colors drive everything. Pull from the podcast cover art — that artwork is the most recognized visual asset. Warm or cool based on the show's personality. Strong contrast for readability since episode pages are text-heavy (show notes, transcripts). Avoid clutter — the design frames the content, not competes with it.

**Typography feel:** Modern stack (system-ui sans-serif). Medium weight. Episode pages need clear hierarchy — episode title, guest name, date, and description must be instantly scannable. Body text optimized for reading show notes and transcripts at length.

**Layout emphasis:** Latest episode and subscribe/listen links above the fold. The home page hero is the current episode with an embedded player ready to go. Use Pattern 2 (hero + content) for home with show artwork and the latest episode as the hero. Episode archive below. Mailing list signup prominent on every page. Max-width 64rem.

**Photography style:** Show artwork as the primary visual — it appears everywhere (hero, social sharing, structured data). Guest photos for interview shows (consistent size and framing across episodes). Host photos for the about page. 1:1 for podcast cover art and guest portraits. 16:9 for page heroes and social share images.

**Key component:** Episode list with play button, title, date, description snippet, and platform links. Each episode expands or links to a detail page with full show notes, guest info, timestamps, transcript, and links mentioned in the episode. Subscribe buttons for all platforms on every episode.

## Tools

### Podcast hosting

Every podcast needs a hosting platform that stores the audio files and generates the RSS feed. The website embeds the player; the host serves the files.

- **Buzzsprout** (~$12/mo for 3 hrs upload, proprietary) — Beginner-friendly. Distribution to all platforms, episode transcription, basic analytics. Good starting point. buzzsprout.com
- **Transistor** (~$19/mo, proprietary) — Multiple shows on one account, better analytics, private podcasts for paid content. Good for growing shows. transistor.fm
- **Captivate** (~$19/mo, proprietary) — Growth-focused features, unlimited team members, built-in calls to action. captivate.fm
- **Libsyn** (~$5/mo, proprietary) — One of the oldest hosts. Reliable, good for high-volume shows. libsyn.com
- **Castopod** (open source, self-hosted) — ActivityPub integration (federated social). The IndieWeb/self-sovereignty option. Requires a server. castopod.org
- **Anchor/Spotify for Podcasters** (free, proprietary) — Free but Spotify-controlled. Limited portability. Fine for starting out; move to an independent host when the show grows. podcasters.spotify.com

### Distribution

- **Apple Podcasts Connect** — Submit the RSS feed. The largest traditional podcast directory. podcasters.apple.com
- **Spotify for Podcasters** — Submit the RSS feed. Second-largest platform, growing fast. podcasters.spotify.com
- **Podcast Index** — Open podcast directory. The Podcasting 2.0 hub. Submit the RSS feed. podcastindex.org
- **YouTube** — Upload full episodes as video (with audiogram or video recording). YouTube is increasingly the primary discovery platform for podcasts. Separate from RSS distribution — requires uploading to YouTube directly.

### Production

- **Descript** (free tier, proprietary) — Edit audio by editing the transcript. Removes filler words, generates transcripts. Good for beginners who find traditional audio editing intimidating. descript.com
- **Audacity** (open source, free) — Traditional audio editor. Powerful, free, widely used. audacityteam.org
- **Hindenburg** (~$95 one-time, proprietary) — Audio editor designed for spoken word (podcasts, radio, journalism). Better than Audacity for voice. hindenburg.com
- **Riverside** (~$15/mo, proprietary) — Remote recording with separate audio/video tracks. Better quality than Zoom for interviews. riverside.fm
- **Zencastr** (free tier, proprietary) — Remote recording alternative. Records each participant locally for better quality. zencastr.com
- **Otter.ai** (free tier, proprietary) or **Whisper** (open source, free) — Transcription. Whisper is OpenAI's open-source model and runs locally. Otter is cloud-based with a free tier.

### Growth and monetization

- **Chartable** (free tier) — Podcast analytics and attribution. Track how listeners find the show. chartable.com
- **Podcorn** (free to list) — Marketplace connecting podcasters with sponsors. Good for smaller shows. podcorn.com
- **Patreon** (5–12% of income, proprietary) — Bonus episodes and membership content. patreon.com
- **Ko-fi** (free, no fees on donations) — Listener tips and support. ko-fi.com
- **Memberful** (~$25/mo, proprietary) — Private podcast feeds for paying members. memberful.com
- **Buttondown** (free tier, indie) — Newsletter for episode announcements and listener engagement. buttondown.email

## Compliance

- **Music and audio licensing**: Background music, sound effects, and intro/outro music must be licensed. Options: royalty-free music libraries (Epidemic Sound, Artlist, Free Music Archive), Creative Commons music (credit required), or original music. Using copyrighted music without a license can get episodes pulled from platforms.
- **Guest consent**: Get explicit permission to record and publish. A simple email or message confirming consent is the minimum. For sensitive topics, a written release is better. If a guest asks to have their episode removed, honor the request.
- **Trademark in show name**: Check that the show name doesn't infringe on existing trademarks. Search the USPTO database (tmos.uspto.gov) before committing to a name. Changing a show name after building an audience is painful.
- **FTC disclosure**: If the show has sponsors or affiliate links, disclose them clearly. "This episode is sponsored by [brand]" at the beginning of the ad read. See `docs/smb/legal-checklist.md` for website-specific disclosure.
- **Accessibility**: Transcripts make the show accessible to deaf and hard-of-hearing audiences. They also improve SEO dramatically. Auto-generated transcripts are a starting point — review for accuracy, especially with technical terms and proper nouns. See `docs/accessibility.md`.
- **Privacy for guests and listeners**: Don't share guest contact info without permission. If collecting listener data (email signups, surveys), follow privacy requirements. See `docs/security.md`.
- **Platform terms of service**: Each distribution platform has content policies. Apple Podcasts and Spotify can remove shows that violate their terms. The website is the one platform the podcaster fully controls — another reason the website matters.

## Content ideas

Episode teasers and clips (30–60 second audio or video snippets for social), behind-the-scenes of production (recording setup, editing process, guest booking), listener Q&A episodes, milestone celebrations (100 episodes, download milestones), "best of" compilations, guest announcements, topic polls (let listeners vote on future topics), show recommendations (other podcasts worth listening to), equipment and process posts (what mic, what software, what workflow), blooper reels, host AMAs, year-in-review episodes, listener stories and feedback spotlights, cross-promotion with other podcasters.

## Key dates

- **International Podcast Day** (Sep 30) — Listener milestones, episode highlights, behind-the-scenes, guest spotlights, "how I started podcasting" content.
- **World Radio Day** (Feb 13) — The spiritual ancestor of podcasting. History of audio storytelling, audio medium appreciation.
- **Podcast Movement conference** (Aug, varies) — Networking, learning, industry trends. Content around conference takeaways.
- **Hot Pod Summit** (varies) — Podcast industry event. Content about industry direction.

## Structured data

Use `PodcastSeries` for the show:
- `name`, `description`, `url`, `image`
- `author` — `Person` or `Organization`
- `webFeed` — RSS feed URL
- `genre` or `about` — show topic/category

Use `PodcastEpisode` for each episode:
- `name`, `datePublished`, `description`, `duration`
- `url` — episode page on the website
- `associatedMedia` — `AudioObject` with `contentUrl` pointing to the audio file
- `partOfSeries` — link to the `PodcastSeries`
- `guest` — `Person` for interview episodes

## Data tracking

- **Episodes:** Title, Number, Season, Publish Date, Guest (if any), Status (Recorded/Editing/Published/Scheduled), Duration, Download Count, Transcript (checkbox), Notes
- **Guests:** Name, Title/Bio, Email, Episode(s), Booked Date, Recorded Date, Status (Pitched/Confirmed/Recorded/Published/Declined), Notes
- **Sponsors:** Name, Contact, Episodes Sponsored, Rate, Ad Format (Pre/Mid/Post/Host-Read), Status (Active/Past/Pitched), Payment Status, Notes
- **Platforms:** Platform Name, URL, Subscriber Count (if available), Last Updated
