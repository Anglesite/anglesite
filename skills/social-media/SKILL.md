---
name: social-media
description: "Proactive social media strategy, content calendars, and profile optimization"
user-invokable: false
allowed-tools: Write, Read, Glob
---

Provide proactive social media strategy, content planning, and profile optimization for small business owners. Called during `/anglesite:start` (initial setup), `/anglesite:check` (periodic review), by the `seasonal` skill, or when the owner asks about social media. Complements the `syndicate` skill, which handles reactive blog-to-social POSSE — this skill covers the full social media presence.

## Architecture decisions

- [ADR-0006 IndieWeb POSSE](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0006-indieweb-posse.md) — the website is the canonical source; social profiles funnel back to it
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — strategy is collaborative; never post on the owner's behalf

## When to invoke this skill

- During `/anglesite:start` — after the site is live, offer an initial social strategy
- During `/anglesite:check` — include a brief "Social presence" section in the health report
- When the `seasonal` skill surfaces content hooks — feed them into the content calendar
- When the owner asks "what should I post?", "help with social media", "set up my Instagram", or similar

Present strategy as guidance, not directives. The owner decides which platforms to use and how often to post.

## Step 1 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines platform recommendations and content themes
- `SITE_DOMAIN` — for profile link recommendations
- `SITE_NAME` — for personalized guidance
- `SITE_TYPE` — business, portfolio, web-artist, etc.

If `BUSINESS_TYPE` is set, read `${CLAUDE_PLUGIN_ROOT}/docs/smb/<BUSINESS_TYPE>.md` for:
- Recommended platforms (under social media or marketing sections)
- Tone and communication style
- Content ideas and key dates
- Target audience

### Brand voice profile

Check for `docs/brand-voice.md` in the project. If it exists, read it to align all social content with the established brand tone, audience, and vocabulary. This file is shared with the `copy-edit` and `syndicate` skills.

If `docs/brand-voice.md` does not exist and this is a conversational invocation (not from `check`), mention it: "If you'd like your social content to have a consistent voice, I can help you define one — just ask me to review your copy and we'll start there." Do not run the brand voice interview yourself — that belongs to the `copy-edit` skill.

## Step 2 — Platform selection and profile setup

### Recommend platforms

Use the business type guide to suggest 2-3 primary platforms. Defaults by category:

| Business type | Primary platforms |
|---|---|
| Restaurant, cafe, bakery, food truck | Instagram, Google Business Profile, Facebook |
| Salon, spa, beauty | Instagram, Google Business Profile, booking platform |
| Contractor, trades, home services | Google Business Profile, Nextdoor, Facebook |
| Professional services (legal, accounting, consulting) | LinkedIn, Google Business Profile |
| Retail, boutique | Instagram, Facebook, Google Business Profile |
| Creative, portfolio, web-artist | Instagram, X/Bluesky, Reddit (r/creativecoding) |
| Health, fitness, wellness | Instagram, Google Business Profile, Facebook |

Ask the owner: "I'd recommend **[platforms]** for a [business type]. Are you active on any of these? Any others you use?" Meet them where they are — don't push platforms they won't maintain.

### Optimize each profile

For each platform the owner uses, generate copy-paste-ready profile content:

```
## [Platform] (@handle or business name)

**Bio** ([char limit] chars):
[Drafted bio matching brand voice, ending with location or CTA]

**Link**: [site domain] (or link-in-bio pointing to key pages)
**Profile photo**: [Recommendation — logo on brand color, or signature product/service photo]
**Cover/header**: [Recommendation matching brand imagery]
```

Platform-specific guidance:

- **Instagram** (150 char bio): Lead with what you do, add location, end with CTA arrow pointing to link. Suggest Highlights categories relevant to the business.
- **Facebook**: Full business details (hours, phone, address). Category and subcategory selection. CTA button recommendation (Book Now, Order Food, Contact Us, etc.).
- **Google Business Profile**: Verify the listing. Complete every field — hours, services, attributes, description (750 chars). Posts as "What's New" updates.
- **LinkedIn**: Professional headline format. About section framing expertise and who you serve. Featured section linking to key site pages.
- **X/Bluesky**: Short punchy bio. Pin a tweet/post that best represents the business.
- **Nextdoor**: Claim the business page. Neighborhood-first tone. Respond to local recommendations.

Every profile should funnel back to the website. Social profiles are outposts — the website is home base.

## Step 3 — Content pillars

Help the owner define 3-5 recurring content themes. Start with these defaults, then tailor based on the business type guide's "Content ideas" section:

| Pillar | What it covers | Example |
|---|---|---|
| **Educate** | Tips, how-tos, industry knowledge | "3 signs your AC needs service before summer" |
| **Behind the scenes** | Process, team, workspace | "Watch us decorate 200 cupcakes for a wedding" |
| **Social proof** | Testimonials, reviews, transformations | "Before/after: Sarah's kitchen remodel" |
| **Promote** | Offers, new products/services, availability | "Now booking holiday party catering" |
| **Connect** | Community involvement, local events, personal touches | "Proud sponsor of [Local] Little League" |

Present these to the owner and ask which resonate. Some businesses lean naturally toward certain pillars — a bakery toward behind-the-scenes, a contractor toward social proof. Narrow to 3-4 pillars that the owner can realistically sustain.

Explain the 80/20 rule: 80% value content (educate, behind the scenes, connect), 20% promotional. Promotional fatigue drives unfollows.

## Step 4 — Content calendar

Generate a rolling content calendar (4-8 weeks) as a markdown file at `docs/social-calendar.md`.

### Calendar inputs

1. **Seasonal hooks** — read from `${CLAUDE_PLUGIN_ROOT}/docs/smb/seasonal-calendar/` for the current quarter and pull from the business type guide's "Key dates" section
2. **Industry-specific events** — business-relevant awareness days (National Hairstylist Day for salons, Small Business Saturday for all, etc.)
3. **Local events** — ask the owner: "Any local festivals, markets, sports seasons, or community events coming up?"
4. **Content pillar rotation** — balanced mix across the owner's chosen pillars

### Posting cadence

Recommend sustainable frequencies. Quality over quantity — a restaurant posting 3x/week with great food photos beats daily low-effort posts.

| Platform | Recommended frequency |
|---|---|
| Instagram (feed + stories) | 3-5x/week |
| Facebook | 2-3x/week |
| Google Business Profile | 1x/week |
| LinkedIn | 2-3x/week |
| X/Bluesky | 3-5x/week |
| Nextdoor | 1-2x/week |

Adjust down if the owner signals these feel like too much. Two great posts per week beats five mediocre ones.

### Calendar format

Write the calendar to `docs/social-calendar.md`:

```markdown
# Social Media Calendar

Generated [date]. Covers [date range].

## Week of [date]

| Day | Platform | Pillar | Idea | Format |
|-----|----------|--------|------|--------|
| Mon | Instagram | Behind the scenes | [Specific idea for this business] | Reel/video |
| Tue | Facebook | Educate | [Specific idea] | Text + photo |
| Wed | Instagram | Social proof | [Specific idea] | Carousel |
| Thu | Google | Promote | [Specific idea] | Update + photo |
| Fri | Instagram | Connect | [Specific idea] | Story |

## Week of [date]
...
```

### Post ideas

For each calendar entry, include:
- **Hook/concept** — one sentence describing the post
- **Platform** — which platform it's best suited for
- **Content pillar** — which pillar it belongs to
- **Format** — photo, carousel, video/reel, text post, story
- **Caption direction** — tone and angle, not full copy (the owner should personalize)
- **Hashtag suggestions** — from business type guide + local tags

## Step 5 — Engagement coaching

Present these as best practices, not a checklist. Frame them conversationally:

### Respond to everything
Reply to every comment within 24 hours. It's visible to future customers browsing your profile. Reply to DMs — many customers use DMs as a contact form.

### Engage locally
Comment on other local businesses' posts and community pages. Follow and interact with neighboring businesses. This builds real relationships that lead to cross-referrals.

### Encourage user-generated content
Ask happy customers to share photos and tag the business. Reshare customer posts (with permission) — it's authentic social proof and the customer feels appreciated.

### Handle negative comments professionally
Don't delete negative comments — respond professionally and take it offline. "We're sorry to hear that — please DM us so we can make it right." This shows future customers you care. For deeper guidance, see the `reputation` skill.

### Batch content creation
Suggest the owner batch-create content: shoot several photos in one session, write a week's captions in one sitting. This makes posting feel sustainable rather than a daily burden.

## Non-interactive context (from `/anglesite:check`)

When invoked from the check skill, provide a brief "Social presence" section — not the full strategy. Focus on:
- Whether social profiles link back to the website
- Whether the owner has posted recently (ask, don't check — you can't access their social accounts)
- One actionable suggestion for the next week

Example:

> **Social presence**
> - Make sure your Instagram bio links to your website — it's the #1 way visitors find you from social
> - Consider a Google Business Profile post this week about [upcoming seasonal hook]
> - If you're posting regularly, great — consistency matters more than frequency

## Integration with other skills

| Skill | Relationship |
|---|---|
| `syndicate` | Generates posts FROM blog content (reactive); `social-media` plans content proactively. When a blog post is published, syndicate handles the social posts for it. |
| `seasonal` | Surfaces seasonal content hooks; `social-media` incorporates them into the calendar. |
| `reputation` | Covers review monitoring and response in depth; `social-media` touches engagement broadly. Defer to reputation for review-specific coaching. |
| `copy-edit` | Shares `docs/brand-voice.md` for consistent tone. Copy-edit owns the brand voice interview; social-media reads the result. |
| `start` | Invokes social-media after the site is live for initial strategy. |
| `check` | Invokes social-media for the "Social presence" health report section. |

## Keep docs in sync

After first run:
- `docs/social-calendar.md` — the content calendar artifact. Update on subsequent invocations rather than creating a new file.
- `docs/architecture.md` — note `social-calendar.md` if created.
- If the owner's social handles are shared, note them in `.site-config` (e.g., `SOCIAL_INSTAGRAM=@handle`) for use by `syndicate` and profile optimization.
