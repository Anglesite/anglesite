# SEO & Discoverability

How people find the website. Reference for the webmaster agent — read during `/start`, `/design-interview`, and content planning. Not user-facing documentation.

For local SEO specifics (NAP consistency, map listings, structured data), see `docs/webmaster.md` → Local SEO. This file covers the broader picture.

## How small businesses get found

Search engines are important, but they're not the only path. For most local businesses, discovery comes from:

1. **Map listings** — Google Maps, Apple Maps. Someone searches "pizza near me" and your listing appears. This is the #1 discovery channel for most local businesses.
2. **Word of mouth** — A friend says "go to [business]." They search the name to find the address and hours. The website's job here is to confirm the recommendation and make the next step easy.
3. **Search engines** — Someone searches a question or need ("how to fix a leaky faucet [town]" or "best coffee [neighborhood]"). Blog content and service pages serve this.
4. **Social media** — They see a post, click through to the website. The content-guide.md POSSE workflow handles this.
5. **Directories and review sites** — Yelp, TripAdvisor, industry-specific directories. External, but the website should be linked from all of them.
6. **Direct** — Saw the sign, got a business card, heard an ad. They type the URL directly. This is why a memorable domain matters.

Don't let the owner obsess over "SEO" at the expense of the basics. A complete Google Business Profile with good photos and reviews often drives more traffic than any blog post.

## What the agent already does

These are handled by the scaffold and existing commands — don't duplicate the work, just know it's there:

- `<title>` and `<meta name="description">` on every page (enforced by `/check`)
- Open Graph tags for social sharing (enforced by `/check`)
- Sitemap at `/sitemap-index.xml` (Astro generates automatically)
- `robots.txt` with sitemap reference
- Clean, semantic HTML with proper heading hierarchy
- Fast page loads (static site, no client JS, optimized images)
- Mobile-responsive design
- SSL/HTTPS (Cloudflare provides automatically)
- Structured data / JSON-LD (set up during `/start`, validated during `/check`)
- `h-card` and `h-entry` microformats

These are the fundamentals that most SEO guides spend pages explaining. They're already done.

## What the agent should do during setup

### During `/start` (Step 2 — page planning)

- **Page titles** — Each page needs a unique, descriptive title. Not "Services" — instead "Residential Plumbing Services in [Town]." Include the business type and location naturally. Don't keyword-stuff.
- **Meta descriptions** — 1–2 sentences that would make someone click. Include the town/area. These show up in search results as the snippet under the title.
- **URL structure** — Clean, readable URLs. `/services/residential-plumbing/` not `/page-3/`. Astro's file-based routing handles this naturally.

### During `/design-interview`

- **Ask about the service area.** "What towns or neighborhoods do you serve?" This informs page titles, meta descriptions, structured data `areaServed`, and content strategy.
- **Ask about what people search for.** "When someone needs what you offer, what would they type into Google?" The owner knows their customers' language better than any keyword tool. Use their words in page headings and content.
- **Ask about competitors.** "Who are the other [business type] businesses in your area? Do they have websites?" Understanding the local landscape helps with differentiation and content planning.

### Content strategy for search

Blog posts are the primary tool for attracting search traffic beyond the business name. Help the owner write about:

- **Questions their customers ask.** Every "how do I..." or "what's the difference between..." that a customer asks in person is a blog post. These posts answer real questions and attract people searching for answers.
- **Local topics.** "[Town] farmer's market guide," "best hiking near [area]," "what to do in [town] this weekend." Local content with geographic keywords ranks well because there's less competition.
- **Seasonal content.** "Preparing your [thing] for winter," "spring cleaning checklist," "holiday gift guide from [business]." Predictable, plannable, and searched every year. See `docs/smb/seasonal-calendar/`.
- **Service/product deep dives.** A plumber writing about "Why your water heater makes that noise" demonstrates expertise and attracts search traffic. Every service page should have a companion blog post that goes deeper.

Frequency matters less than quality. One useful post per month is better than four thin ones. See `docs/content-guide.md` → Frequency.

## Page-level SEO checklist

Applied during `/start` and `/check`. Most of this is already enforced — this is the full picture:

1. **Title tag** — Unique per page, under 60 characters, includes business type and location for key pages
2. **Meta description** — Unique per page, under 160 characters, compelling (this is your ad copy in search results)
3. **H1** — One per page, matches the page topic, not identical to the title tag (but related)
4. **Headings** — Logical hierarchy (h1 → h2 → h3), no skipped levels, descriptive (not "Our Services" — instead "Residential Plumbing Services")
5. **Image alt text** — Descriptive, not keyword-stuffed. "Freshly baked sourdough loaves cooling on a wire rack" not "best bakery bread [town]"
6. **Internal links** — Pages should link to each other where relevant. The services page links to related blog posts. Blog posts link back to the services page. This helps both visitors and search engines.
7. **URL** — Short, readable, includes the topic. No dates in URLs unless it's time-sensitive content.
8. **Open Graph** — Title, description, and image for every page. Controls how the page looks when shared on social media.

## What NOT to do

The owner may ask about these. Explain why they're bad ideas:

- **Keyword stuffing** — Repeating the same phrase unnaturally. Search engines penalize this. Write for humans.
- **Buying backlinks** — Paid links from random sites. Google detects and penalizes this. Earn links by creating useful content.
- **Duplicate content** — Same text on multiple pages. Write unique content for each page, even if the services are similar.
- **Hidden text** — White text on white background, tiny font sizes. This is spam. Search engines have been catching this for 20 years.
- **"SEO experts" cold-emailing** — The owner will get emails promising "#1 on Google." These are almost always scams or low-quality services. A well-built website with good content and a claimed Google Business Profile is more effective than anything these services offer.
- **Obsessing over rankings** — Rankings fluctuate daily. Focus on creating useful content and making the website easy to use. If people find it helpful, search engines will too.

## Monitoring

The owner doesn't need paid SEO tools. Free options that actually help:

- **Cloudflare Analytics** — Already set up. Shows page views, top pages, referral sources, and search queries. Check monthly.
- **Google Search Console** — Free. Shows which search queries bring people to the site, click-through rates, and indexing issues. Set up during `/domain` (requires a DNS TXT record for verification — see `domain.md`). Check monthly.
- **Google Business Profile insights** — Shows how many people found the business through Maps, what they searched for, and what actions they took (called, asked for directions, visited the website). Check monthly.

During monthly `/check`, remind the owner: "Have you looked at your Cloudflare Analytics and Google Business Profile this month? Are people finding your site?"

### What to look for

- **Are people finding the site at all?** If traffic is near zero after 2–3 months, check: Is the site indexed? Is the Google Business Profile claimed and complete? Are there any blog posts?
- **What pages get traffic?** If the home page gets visits but service pages don't, the internal linking and navigation may need work.
- **Where does traffic come from?** Maps, search, social, direct? This tells the owner which channels to invest in.
- **What do people search for?** Google Search Console shows the queries. If people are finding the site for unexpected terms, that's a content opportunity.
- **Are people clicking through from search results?** If the site appears in results but nobody clicks, the title and meta description need to be more compelling.

## Google Business Profile setup

The most impactful thing a local business can do for discoverability. During `/start` or `/deploy`, ask: "Have you claimed your business on Google?"

If not, walk them through:

1. Go to business.google.com
2. Search for the business (it may already exist from Google's data)
3. Claim or create the listing
4. Verify (usually by phone or postcard)
5. Complete the profile: hours, photos, description, categories, website URL, phone, address

Emphasize: **photos matter enormously.** Listings with photos get significantly more clicks. Help them pick 5–10 good photos: storefront, interior, products/services, the team.

See also `docs/webmaster.md` → Map listings for Apple Business Connect and OpenStreetMap.
