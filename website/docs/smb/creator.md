# Content Creator & Influencer

Covers: bloggers, YouTubers, podcasters, streamers, social media creators, newsletter writers, online educators, podcast studios, video production businesses. See also the "Podcast and video as marketing" section in [content-guide.md](../content-guide.md) for businesses using audio/video as a marketing channel (not as their primary product).

## Pages

- **About / bio** — Who they are, what they create, who it's for. This is the "media kit lite" — brands check this page first.
- **Media kit** — Audience demographics, platform stats, past collaborations, rates (optional), contact for partnerships. Can be a page or a downloadable PDF. Essential for monetization.
- **Portfolio / work** — Best content, organized by type or topic. Embedded videos, featured posts, podcast episodes. The permanent home for work that lives on ephemeral platforms.
- **Podcast** — If they have a podcast: episode archive with show notes, embedded audio player, guest list, subscribe links (Apple Podcasts, Spotify, RSS, YouTube). Each episode should be a blog post with show notes — this is the single best thing for podcast SEO. The website is the canonical home; platforms are distribution.
- **Video** — If video-first: embedded player (YouTube or self-hosted), organized by series or topic. Transcripts improve SEO and accessibility. Each video can be a blog post with the embed, description, and links mentioned in the video.
- **Blog** — Long-form content that owns the SEO. Social platforms drive discovery, the blog captures and retains the audience.
- **Newsletter / subscribe** — Email list is the most valuable asset. Prominent sign-up on every page. Platform-independent audience.
- **Shop / support** — Merch, digital products, memberships, tip jar. Link to Ko-fi, Patreon, or on-site store.
- **Appearances / events** — Speaking engagements, podcast guest spots, meetups, conventions. Both upcoming and past.
- **Contact** — Business inquiries email (separate from personal). Social links. Collaboration form.

## Tools

- **Ko-fi** (free, no fees on donations) — Tips, memberships, commissions, and shop. Indie-friendly and creator-focused. ko-fi.com
- **Patreon** (5–12% of income, proprietary) — Membership and subscription content. Well-known but takes a significant cut. patreon.com
- **Cal.com** (open source, free tier) — For booking brand collaboration calls, podcast appearances, etc. cal.com
- **Buttondown** (free tier for 100 subscribers, open source core) — Newsletter platform. Clean, simple, respects subscribers. buttondown.email
- The website itself is the most important tool — it's the media kit, portfolio, and owned hub that outlasts any platform.

### Podcast-specific tools

- **Podcasting 2.0 / RSS** — The podcast RSS feed is the canonical distribution channel. Host the feed URL on the website or use a hosting platform that provides one. Every podcast app pulls from RSS.
- **Buzzsprout** (~$12/mo, proprietary) — Podcast hosting with distribution to all major platforms. Good for beginners. buzzsprout.com
- **Transistor** (~$19/mo, proprietary) — Podcast hosting with analytics and multiple shows. transistor.fm
- **Castopod** (open source, self-hosted) — ActivityPub-integrated podcast hosting. The IndieWeb option. castopod.org
- **Podcast Index** — Open podcast directory. Submit the RSS feed. podcastindex.org
- **YouTube** — Increasingly the primary podcast platform. Video podcasts or audiograms (waveform + static image) both work. YouTube discovery is unmatched.

### Video-specific tools

- **YouTube** — The primary long-form video platform. Channel SEO, playlists, community posts. Embed videos on the website for the permanent archive.
- **PeerTube** (open source, federated) — Self-hosted or join an instance. The decentralized alternative. joinpeertube.org
- **OBS Studio** (open source, free) — Screen recording and live streaming. Essential for streamers. obsproject.com
- **DaVinci Resolve** (free tier) — Professional video editing. Free version is more than enough for most creators. blackmagicdesign.com

## Compliance

- **FTC endorsement guidelines**: Sponsored content and affiliate links must be disclosed. "#ad" or "sponsored" must be clear and conspicuous — not buried in hashtags. Applies to website content, not just social.
- **COPPA**: If the audience includes children under 13, strict rules apply to data collection. Relevant for family/kid content creators.
- **Music and media licensing**: Background music, stock footage, and images must be properly licensed. Note licensing in content if required.
- **Podcast/video accessibility**: Transcripts and captions are increasingly expected (and legally required in some contexts). Captions on video improve engagement regardless of legal requirements. Auto-generated captions are a starting point; review for accuracy.
- **Tax obligations**: Brand deals and platform income are taxable. Creators are self-employed (Schedule C). Mention this during `/setup-customers` if relevant.
- **Privacy policy**: Required if collecting email addresses (newsletter). Must comply with CAN-SPAM (US), GDPR (EU audience), etc.

## Content ideas

Behind-the-scenes of content creation, brand partnership announcements, personal takes on industry trends, audience Q&A recaps, event appearances, product reviews (owned on the website, not just on social), collaboration highlights, media kit updates, "how I got started" stories, gear and tool recommendations, income transparency reports (if their brand), lessons learned, platform tips for aspiring creators, repurposed long-form versions of popular short-form content.

## Key dates

- **World Social Media Day** (Jun 30) — Behind-the-scenes of content creation, platform reflections, audience appreciation.
- **National Podcast Day** (Sep 30) — If applicable. Listener milestones, episode highlights, guest spotlights.
- **Creator Economy Week** (varies) — Platform-specific creator events and announcements.

## Structured data

Use `Person` with:
- name, url, `sameAs` (all social platform URLs)
- `jobTitle` ("Content Creator", "YouTuber", etc.)
- `knowsAbout` (topics/niches)

For individual content pieces, use `Article`, `BlogPosting`, `VideoObject`, or `PodcastEpisode` as appropriate.

For podcasts, use `PodcastSeries` for the show and `PodcastEpisode` for each episode with:
- `name`, `datePublished`, `duration`, `description`
- `associatedMedia` linking to the audio file
- `partOfSeries` linking to the show

## Data tracking

- **Contacts:** Name, Email, Company, Type (Brand/Agency/Media/Collaborator), Platform, Notes, Created Date
- **Collaborations:** Brand (linked), Platform, Deliverables, Rate, Status (Pitched/Confirmed/In Progress/Completed/Paid), Date, Notes
- **Content:** Title, Platform, Date Published, URL, Type (Video/Post/Podcast/Blog), Sponsored (checkbox), Brand (linked), Performance Notes
