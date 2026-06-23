# Content Creator & Influencer

Covers: bloggers, social media influencers, newsletter writers, online educators, multi-platform content creators. For specialized creator types, see also [musician.md](musician.md), [podcaster.md](podcaster.md), and [video-creator.md](video-creator.md). See the "Podcast and video as marketing" section in [content-guide.md](../content-guide.md) for businesses using audio/video as a marketing channel (not as their primary product).

## Pages

- **About / bio** — Who they are, what they create, who it's for. This is the "media kit lite" — brands check this page first.
- **Media kit** — Audience demographics, platform stats, past collaborations, rates (optional), contact for partnerships. Can be a page or a downloadable PDF. Essential for monetization.
- **Portfolio / work** — Best content, organized by type or topic. Embedded videos, featured posts, podcast episodes. The permanent home for work that lives on ephemeral platforms. If primarily podcast or video, see [podcaster.md](podcaster.md) or [video-creator.md](video-creator.md) for more detailed page guidance.
- **Blog** — Long-form content that owns the SEO. Social platforms drive discovery, the blog captures and retains the audience.
- **Newsletter / subscribe** — Email list is the most valuable asset. Prominent sign-up on every page. Platform-independent audience.
- **Shop / support** — Merch, digital products, memberships, tip jar. Link to Ko-fi, Patreon, or on-site store.
- **Appearances / events** — Speaking engagements, podcast guest spots, meetups, conventions. Both upcoming and past.
- **Contact** — Business inquiries email (separate from personal). Social links. Collaboration form.

## Design

**Visual mood:** Personal brand forward. Clean, personality-driven, and immediately recognizable. The site should feel like the creator's content — familiar to their existing audience and inviting to new visitors. Varies by niche but always intentional.

**Color direction:** Warm or cool based on the creator's content tone and existing brand colors. Pull from their established palette (channel art, social profiles, merch). Consistency with their cross-platform brand is more important than any design trend. Avoid generic — the palette should be unmistakably theirs.

**Typography feel:** Modern stack (system-ui sans-serif). Medium weight. Clean and readable — the creator's personality comes through in content, not type ornamentation. Headings can be bolder to create hierarchy on content-heavy pages.

**Layout emphasis:** Links/bio page and latest content above the fold. The home page is the hub — it answers "who is this person and where do I find their stuff?" Use Pattern 2 (hero + content) for home with a personal photo and quick bio as the hero, followed by latest content and platform links. Max-width 64rem.

**Photography style:** Brand-consistent photos that match the creator's cross-platform identity. Professional headshot for the hero/about page. Casual behind-the-scenes shots for blog and content pages. Aspect ratios match the platforms they're on — 1:1 for profile-style, 16:9 for banner-style.

**Key component:** Link hub — a curated, branded links page (like Linktree but built into the site). Platform links, latest content, newsletter signup, shop, and support all in one scannable section. This replaces the "link in bio" service entirely.

## Tools

- **Ko-fi** (free, no fees on donations) — Tips, memberships, commissions, and shop. Indie-friendly and creator-focused. ko-fi.com
- **Patreon** (5–12% of income, proprietary) — Membership and subscription content. Well-known but takes a significant cut. patreon.com
- **Cal.com** (open source, free tier) — For booking brand collaboration calls, podcast appearances, etc. cal.com
- **Buttondown** (free tier for 100 subscribers, open source core) — Newsletter platform. Clean, simple, respects subscribers. buttondown.email
- The website itself is the most important tool — it's the media kit, portfolio, and owned hub that outlasts any platform.

For podcast-specific tools, see [podcaster.md](podcaster.md). For video-specific tools, see [video-creator.md](video-creator.md). For musician-specific tools, see [musician.md](musician.md).

## Review platforms

Review platforms in the traditional sense don't apply to most content creators — audiences don't leave Yelp reviews for bloggers. Reputation is built through platform presence, audience engagement, and the creator's own website as a portfolio.

- **Social platforms** — Follower counts, comments, and engagement rates on the creator's primary platforms (Instagram, YouTube, TikTok) function as public social proof for potential brand partners.
- **Google Business Profile** — Only relevant if the creator operates as a business with a physical presence (e.g., a studio open for brand shoots, workshops, or events). If not, skip.

For creators monetizing through brand deals, the media kit on the website IS the reputation asset — not review platform ratings.

See `docs/smb/reviews.md` for general review management guidance.

## Compliance

- **FTC endorsement guidelines**: Sponsored content and affiliate links must be disclosed. "#ad" or "sponsored" must be clear and conspicuous — not buried in hashtags. Applies to website content, not just social.
- **COPPA**: If the audience includes children under 13, strict rules apply to data collection. Relevant for family/kid content creators.
- **Music and media licensing**: Background music, stock footage, and images must be properly licensed. Note licensing in content if required. See [musician.md](musician.md), [podcaster.md](podcaster.md), and [video-creator.md](video-creator.md) for type-specific licensing guidance.
- **Podcast/video accessibility**: Transcripts and captions are increasingly expected (and legally required in some contexts). Captions on video improve engagement regardless of legal requirements. Auto-generated captions are a starting point; review for accuracy. See `docs/accessibility.md`.
- **Tax obligations**: Brand deals and platform income are taxable. Creators are self-employed (Schedule C). Quarterly estimated taxes apply.
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

For individual content pieces, use `Article` or `BlogPosting` as appropriate. For podcast and video structured data, see [podcaster.md](podcaster.md) and [video-creator.md](video-creator.md).

## Data tracking

- **Contacts:** Name, Email, Company, Type (Brand/Agency/Media/Collaborator), Platform, Notes, Created Date
- **Collaborations:** Brand (linked), Platform, Deliverables, Rate, Status (Pitched/Confirmed/In Progress/Completed/Paid), Date, Notes
- **Content:** Title, Platform, Date Published, URL, Type (Video/Post/Podcast/Blog), Sponsored (checkbox), Brand (linked), Performance Notes
