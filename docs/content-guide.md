# Content Guide

## Blog posts

Posts live in `src/content/posts/` as `.mdx` files. The owner creates them via Keystatic at `/keystatic/collection/posts`.

### Required frontmatter
- `title` — Post title
- `description` — For meta tags and listings (1–2 sentences)
- `publishDate` — YYYY-MM-DD format

### Optional frontmatter
- `image` — Path relative to public/ (e.g., `/images/blog/photo.webp`)
- `imageAlt` — Required if image is set
- `tags` — Array of strings. Default tags: `news`, `update`, `event`. Updated by `/anglesite:design-interview` to match the business.
- `draft` — Boolean. Drafts excluded from production builds.
- `syndication` — Array of URLs. Added after sharing on social media.

### Schema sync

The blog schema is defined in two places that must stay in sync:
- `src/content.config.ts` — Astro uses this for type checking
- `keystatic.config.ts` — Keystatic uses this for the editor UI

If you add or change a field, update both files.

## Images

- Store in `public/images/blog/` (blog) or `public/images/pages/` (site pages)
- Optimize before adding: aim for <500KB per image
- Use `.webp` format when possible
- Always include `alt` text for accessibility

## Your website is the center

The owner's website is the hub of their online presence. Social media platforms come and go, change their algorithms, or shut down — but the website is theirs. Every piece of content should live on the website first. Social media posts should drive people back to the website, not the other way around.

This means:
- **Publish here first.** The blog post, the announcement, the photo gallery — it goes on the website before anywhere else.
- **Social media is distribution, not home base.** Facebook, Instagram, Nextdoor, map listings — these are places to share a link and a teaser, not the full content.
- **Every social post should link back.** When sharing on social media, always include a link to the full content on the website. This drives traffic, builds search ranking, and ensures the owner controls the audience relationship.
- **Leads belong to the owner.** Someone who visits the website can be reached again — through the blog, through email, through a return visit. Someone who only sees a Facebook post is at the mercy of the algorithm.

### POSSE workflow

Publish On (own) Site, Syndicate Elsewhere:
1. Write and publish the post on the website
2. Share on social media with a link back to the website
3. Copy the social media share URLs
4. Edit the post in Keystatic → add URLs to the Syndication Links field
5. Save and publish again

The syndication URLs render as `u-syndication` links in the `h-entry` markup, connecting the original post to its copies.

POSSE handles the outbound side — publishing and syndicating. The inbound side is **Webmentions**: when another website links to the owner's post, it can notify the site automatically. This completes the conversation loop across the open web. See `docs/indieweb.md` → Webmentions for setup (optional, recommended for owners active in blogging communities).

### Where to share

Every community is different. Some towns live on Nextdoor, others on Facebook groups, others on Yelp. Don't assume — help the owner figure out where *their* customers actually are. Ask:

- "Where do people in your area talk about local businesses?" (Facebook groups, Nextdoor, Yelp, Reddit, community forums)
- "Where do your competitors show up?" (Check their social profiles, review sites, directory listings)
- "Where have you gotten word-of-mouth so far?" (If they're already hearing "I found you on Yelp," lean into that)

Common platforms and when they're strongest:
- **Facebook** — Dominant for local businesses, events, and community groups in many areas. Some communities have active "buy local" or neighborhood groups that are the real discovery channel.
- **Instagram** — Visual businesses (restaurants, florists, tattoo, photography, makers). Stronger in urban and suburban areas.
- **Nextdoor** — Hyperlocal. Strong in suburban residential areas for trades, cleaning, pet services, childcare, repair shops.
- **Yelp** — Still the first search for restaurants, salons, repair, and services in many West Coast and urban markets. Less dominant elsewhere but still matters for reviews.
- **Google Business Profile** — Universal. Post updates directly. Helps local search ranking. Every business should claim this.
- **Apple Business Connect** — Claim the business on Apple Maps. Half of US smartphone users are on iPhone — if the business isn't on Apple Maps, those customers can't find it. See `docs/webmaster.md` → Map listings.
- **OpenStreetMap** — Open data powering DuckDuckGo, Bing, and many navigation apps. Add or correct the business listing for free.
- **LinkedIn** — Professional services, accounting, insurance, B2B. Stronger for client-based businesses than consumer retail.
- **TikTok / YouTube / Instagram Reels** — Video-first platforms. Especially powerful for food businesses, makers, beauty, and any visual craft. Short-form video (process, reveals, behind-the-scenes) is the primary discovery channel for many businesses. The website hosts the permanent version (embedded or linked in a blog post); social gets the short clip. During `/anglesite:start`, ask if they create video content and plan the site accordingly.
- **Community-specific** — Local forums, town Facebook groups, church bulletins, library bulletin boards, community newsletters. These aren't "social media" but they're where people find businesses.

The owner doesn't need to be on every platform. Pick 1–2 where their customers already are. Revisit after 3 months — if a platform isn't driving website visits, drop it and try another.

## What to post about

Content brings people to the website. Help the owner think about what their customers want to know. Every post is an opportunity to demonstrate expertise, build trust, and give people a reason to visit.

### Post types

Not everything has to be a long blog post. Mix formats:

- **Blog posts** — Longer, evergreen content. Tips, guides, how-tos, explainers. Great for search traffic. Published on the website, shared everywhere.
- **Photo posts** — Before/after shots, new products, behind the scenes, event photos. Quick to create, highly shareable. Post the photo on the website with a caption, then share on social.
- **Announcements** — New hours, new services, holiday closures, event dates. Short and factual. Post on the website first so there's a permanent link, then share on social.
- **Seasonal/timely** — Holiday specials, seasonal tips, weather-related advice. Plan these ahead — they're predictable and high-traffic. See `docs/smb/seasonal-calendar/` for month-by-month hooks by business type.
- **Customer stories** — Testimonials, case studies, "before and after" features (with permission). The most persuasive content there is.

### Podcast and video as marketing

A business doesn't need to be a "content creator" to use audio and video. Many small businesses benefit from podcast appearances, video content, or even hosting their own show — not as their product, but as their marketing. This is different from being a creator (see [creator.md](smb/creator.md) for businesses where content IS the product).

**When podcast/video makes sense for a non-creator business:**
- Professional services (accounting, legal, healthcare, insurance) — Expert positioning. A monthly podcast or YouTube series answering common questions builds trust and search presence. "Ask a [profession]" format works.
- Trades and repair — Process videos (how we fixed this, what we found, why this matters) drive discovery. YouTube is the second-largest search engine — people search "how to fix [thing]" and find the business.
- Restaurants and food businesses — Recipe videos, cooking process, plating, behind-the-counter. TikTok and Reels are primary discovery. See [restaurant.md](smb/restaurant.md) content ideas.
- Farms and makers — Process and craft videos (harvest, production, making). Visual and satisfying content that builds connection.
- Real estate — Property walkthroughs, neighborhood guides, market updates. Video IS the listing now.
- Fitness — Workout clips, form demonstrations, nutrition tips. Drives class bookings.

**How the website supports it:**
- Each video or podcast episode becomes a blog post on the website (embedded player + show notes or description). This is the canonical home — social platforms are distribution.
- Episode archive page if producing a series. Organized by topic, not just chronologically.
- RSS feed for podcast distribution (the website can host this; see creator.md for hosting tools).
- Transcripts improve SEO dramatically — search engines can't watch videos but can read transcripts.

**What to tell the owner during `/anglesite:start`:**
- Ask: "Do you create any video or audio content — even casually?" If yes, plan the site to feature it.
- If they're interested but haven't started: a smartphone, natural light, and a quiet room is enough. Don't let equipment be a barrier. Start with one short video or appear as a guest on someone else's podcast.
- If they're already producing content on social but not on their website: that's the #1 quick win. Embed existing content in blog posts. The content already exists — it just needs a permanent home.

### Ideas by business type

Every SMB file in `docs/smb/` has a "Content ideas" section with industry-specific suggestions. Read the file matching the owner's `BUSINESS_TYPE` from `.site-config` and use those ideas as starting points.

### Frequency

Aim for 1–4 posts per month. Consistency matters more than frequency. One good post a month beats four rushed ones. Social shares can happen more often — reshare older blog posts, post quick photos, respond to community events.

## Off-season strategy

Many businesses are seasonal — farms, campgrounds, event venues, food trucks, Christmas tree farms, tourist-area businesses. The website shouldn't go dark when the business does. An off-season website that's clearly dormant looks abandoned to search engines and potential customers.

What to do during the off-season:

- **Keep the site alive.** Update the home page to reflect the current state: "We're closed for the season — see you in May!" with a mailing list signup or pre-order form. Don't just leave last summer's content as-is.
- **Mailing list signup.** The off-season is the best time to capture future customers: "Sign up to know when we open" or "Get first pick of 2027 CSA shares." A simple email form is the highest-value off-season feature.
- **Off-season content.** Behind-the-scenes posts (barn renovation, new plantings, recipe testing), planning and preparation stories, "what we learned this year" wrap-ups. This keeps the blog active and maintains search ranking.
- **Pre-season ordering.** CSA signups, event venue availability for next year, campground reservations. Many seasonal businesses book months ahead — the website should support that year-round.
- **Seasonal homepage rotation.** If the business has a strong seasonal cycle, plan 2–4 homepage variations per year. During `/anglesite:design-interview`, ask: "What does your business look like in each season?" and plan content accordingly.
- **Update key dates.** Before the new season, update hours, pricing, availability, and any seasonal pages. Don't make customers wonder if last year's info is still current.

## Why each page matters

- **Home** — First impression. Should answer: who are you, what do you do, why should I care?
- **About** — Builds trust. Search engines reward sites with clear identity.
- **Blog** — Brings search traffic. Write about problems your customers have.
- **Service/product pages** — What search engines look for when someone searches "restaurant near me" or "family lawyer in [city]."
- **Contact** — Make it easy. Phone, email, location, hours. Don't hide it.
- **Testimonials** — Social proof. Real quotes from real customers.

## Blog archive

The blog listing page (`/blog/`) shows only posts from the last 30 days, newest first. Older posts move to `/blog/archive/`. This keeps the main page fresh without deleting content.

Implementation: both pages query the same content collection, filtered by `publishDate` relative to the current build date. The archive page shows everything older than 30 days. The blog listing links to the archive at the bottom.
