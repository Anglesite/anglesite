# Content Creator & Influencer

Covers: bloggers, YouTubers, podcasters, streamers, social media creators, newsletter writers, online educators.

## Pages

- **About / bio** — Who they are, what they create, who it's for. This is the "media kit lite" — brands check this page first.
- **Media kit** — Audience demographics, platform stats, past collaborations, rates (optional), contact for partnerships. Can be a page or a downloadable PDF. Essential for monetization.
- **Portfolio / work** — Best content, organized by type or topic. Embedded videos, featured posts, podcast episodes. The permanent home for work that lives on ephemeral platforms.
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

## Compliance

- **FTC endorsement guidelines**: Sponsored content and affiliate links must be disclosed. "#ad" or "sponsored" must be clear and conspicuous — not buried in hashtags. Applies to website content, not just social.
- **COPPA**: If the audience includes children under 13, strict rules apply to data collection. Relevant for family/kid content creators.
- **Music and media licensing**: Background music, stock footage, and images must be properly licensed. Note licensing in content if required.
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

## Data tracking

- **Contacts:** Name, Email, Company, Type (Brand/Agency/Media/Collaborator), Platform, Notes, Created Date
- **Collaborations:** Brand (linked), Platform, Deliverables, Rate, Status (Pitched/Confirmed/In Progress/Completed/Paid), Date, Notes
- **Content:** Title, Platform, Date Published, URL, Type (Video/Post/Podcast/Blog), Sponsored (checkbox), Brand (linked), Performance Notes
