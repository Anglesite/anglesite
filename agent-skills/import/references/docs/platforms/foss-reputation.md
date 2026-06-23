# FOSS Reputation & Review Tools

**Used by:** Owners who ask about open-source or self-hosted alternatives for managing reviews, collecting feedback, or displaying social proof — especially those wary of third-party tracking scripts or platform lock-in.

Per the [SaaS selection criteria](../decisions/0009-industry-tools-over-custom-code.md), prefer open source when a viable alternative exists. For reputation management, centralized platforms (Google, Yelp) remain essential because that's where customers search. These FOSS tools complement — not replace — platform presence.

## The honest tradeoff

No open-source tool replaces Google Business Profile or Yelp. Customers search on those platforms, and reviews there drive discovery. FOSS tools are useful for:

1. **Collecting first-party feedback** on the owner's own site
2. **Displaying testimonials** without third-party tracking scripts
3. **Analyzing sentiment** from reviews the owner already has

They are not useful for:
- Monitoring reviews across platforms (requires proprietary APIs with rate limits and API keys)
- Replacing the need to claim and maintain Google/Yelp listings
- Automated review response or alerts

## First-party feedback collection

These tools let the owner collect feedback directly on their site, independent of any platform.

### Fider

- **What:** Open-source feedback and feature voting platform
- **Self-hosted:** Yes (Docker). Go backend, PostgreSQL
- **GitHub:** `getfider/fider` (~4K stars, actively maintained)
- **Best for:** Service businesses that want structured customer input — "What should we improve?"
- **Static site integration:** Query the REST API at build time to generate a static page of top feedback. Link to the hosted Fider instance for submissions. Do not embed.
- **Limitations:** Designed for product feedback and feature requests, not traditional star-rating reviews. Overkill for most small businesses.

### Astuto

- **What:** Self-hosted customer feedback tool with moderation, voting, and labels
- **Self-hosted:** Yes (Docker). Ruby on Rails backend
- **GitHub:** `astuto/astuto` (~2K stars)
- **Best for:** Similar to Fider but simpler. Good if the owner wants a lightweight feedback board.
- **Static site integration:** Same pattern — REST API at build time, link for submissions.
- **Limitations:** Smaller community than Fider. Previously attempted commercial SaaS; now open-source only.

### When to recommend

Most small businesses don't need a self-hosted feedback tool. Recommend these only when:

- The owner specifically asks about open-source options
- The owner has privacy concerns about third-party review platforms
- The business serves a technical audience that values open-source tooling
- The owner already self-hosts other tools and has the capacity to maintain one more

For everyone else, the `/anglesite:testimonials` skill (Keystatic collection + Turnstile) is simpler and requires no additional hosting.

## Displaying reviews without third-party scripts

### Static testimonials (default recommendation)

The simplest and most privacy-respecting approach: the owner manually selects reviews and adds them as Keystatic content. No external scripts, no API calls, no tracking. This is what `/anglesite:testimonials` sets up.

### Build-time review fetch

For owners who want to display Google reviews without a client-side widget:

1. Fetch reviews from the Google Places API during `astro build` using a build script
2. Save as static JSON in `src/data/`
3. Render at build time — no client-side JavaScript
4. Rebuild periodically (daily or weekly via CI) to pick up new reviews

This requires a Google Places API key (free tier: enough for a small business). The key stays in the build environment, never shipped to the client.

**Do not use client-side review widgets.** They add tracking scripts, slow the page, and violate the third-party script policy in `/anglesite:deploy`. The build-time pattern achieves the same result with zero client-side cost.

### Open Reviews Widget

- **What:** Embeddable review widget from the Open Reviews Association
- **Website:** open-reviews.net
- **Note:** This is a community-driven project promoting open review data. The widget adds a third-party script, so it would need to be added to the deploy allowlist. Only recommend if the owner specifically wants federated/open review infrastructure.

## Sentiment analysis (offline)

These tools analyze review text the owner already has — useful during quarterly reviews to spot trends.

### VADER

- **What:** Valence Aware Dictionary and sEntiment Reasoner — sentiment scoring optimized for social media and review text
- **Language:** Python
- **GitHub:** `cjhutto/vaderSentiment` (~4.5K stars)
- **Best for:** Quick positive/negative/neutral classification of reviews. Handles slang, emoji, and emphasis ("GREAT!!!" scores higher than "great").
- **Use case:** Owner pastes 20 reviews into a text file, a script scores each one, the agent summarizes: "15 positive, 3 neutral, 2 negative. The negative reviews both mention wait times."

### TextBlob

- **What:** Simple NLP library with sentiment analysis
- **Language:** Python
- **GitHub:** `sloria/TextBlob` (~9K stars)
- **Best for:** Lightweight alternative to VADER. Slightly less accurate on informal text but easier API.

### When to recommend

Almost never proactively. These are tools for the webmaster agent to use internally if the owner has a large number of reviews and wants a summary. Don't suggest the owner install Python and run sentiment analysis — summarize the findings in plain language during `/anglesite:check`.

## Lightweight on-site comment systems

These are comment systems that could be adapted for on-site reviews, but they're designed for blog comments, not structured reviews with star ratings.

### Schnack

- **What:** Self-hosted Disqus alternative (~8 KB client-side)
- **Self-hosted:** Yes. Node.js + SQLite
- **GitHub:** `schn4ck/schnack` — privacy-focused, no tracking, moderation dashboard
- **Limitation:** No star ratings, no structured review data. Would need modification to serve as a review system.

### Statique

- **What:** Serverless comment system (~3 KB client-side) using cloud storage
- **GitHub:** `LeeHolmes/statique`
- **Limitation:** Same as Schnack — comments, not reviews. Requires Azure Storage.

### When to recommend

Don't. The `/anglesite:testimonials` skill with Keystatic content is purpose-built for this and doesn't require the owner to host a separate service. These tools are documented here for completeness, not as recommendations.

## NPS collection

### nps-widget

- **What:** Open-source Net Promoter Score collection widget
- **GitHub:** `satismeter/nps-widget`
- **Best for:** Service businesses that want to track customer satisfaction over time with a single-question survey ("How likely are you to recommend us?")
- **Static site integration:** Embeddable widget. Data storage would need a separate backend (Cloudflare Worker + KV, or a form endpoint).
- **Limitation:** NPS is a corporate metric. Most small business owners don't know what it is and don't need it. A simple "How was your experience?" on the `/review` page is more natural.

## Recommendation summary

| Owner says | Recommend |
|---|---|
| "I want reviews on my website" | `/anglesite:testimonials` — Keystatic collection, no hosting needed |
| "I want to show my Google reviews" | Build-time fetch from Google Places API, rendered statically |
| "I don't trust Yelp/Google" | Testimonials on-site + still claim the listings (customers search there) |
| "I want open-source everything" | Fider for feedback collection, static testimonials for display |
| "How are my reviews doing?" | `/anglesite:reputation` coaching — help them check platforms manually |
| "I want automated review monitoring" | No FOSS option exists. Suggest manual quarterly checks during `/anglesite:check` |

## Related docs

- `docs/smb/reviews.md` — Review strategy, response templates, platform-by-type table
- `docs/platforms/google-business-profile.md` — GBP setup and maintenance
- `docs/platforms/yelp.md` — Yelp setup and the review filter
- `skills/reputation/SKILL.md` — Coaching skill for review monitoring
- `skills/testimonials/SKILL.md` — First-party testimonial collection and display
