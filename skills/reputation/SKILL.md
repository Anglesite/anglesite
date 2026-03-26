---
name: reputation
description: "Surface review response suggestions and competitive insights based on business type"
user-invokable: false
allowed-tools: Bash(date *), Read, Glob
---

Coach the owner on online reputation — Google reviews, competitor activity, and review response. Called during `/anglesite:check`, quarterly reviews, or when the owner asks about reviews, reputation, or competitors. Not invoked directly by the owner.

## Architecture decisions

- [ADR-0009 Industry tools](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — recommend Google Business Profile, not custom review infrastructure
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — never store customer data locally; coaching only

## Privacy rule

**Never store review content, customer names, or reviewer information locally.** This skill is advisory — it coaches the owner on what to do, not a data pipeline. All review data stays on the platform where it was posted (Google, Yelp, etc.).

## When to invoke this skill

- During `/anglesite:check` — add a "Reputation" section to the health report
- When the owner asks "how are my reviews?" or "what are competitors doing?"
- During quarterly reviews (aligned with `/anglesite:update`)
- After `/anglesite:testimonials` setup — remind the owner to also monitor platform reviews

Present suggestions as coaching, not commands. The owner should feel supported, not overwhelmed.

## Step 1 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines which review platforms and competitive factors matter
- `SITE_NAME` — for personalized suggestions
- `SITE_URL` — to check if Google Business Profile link exists on the site
- `REVIEW_PLATFORMS` — comma-separated platform slugs (google, yelp, fresha, etc.)
- `GOOGLE_REVIEW_URL` — direct link to Google review form (if available)

If `BUSINESS_TYPE` is not set, skip this skill entirely. Generic review advice is not useful without business context.

Read the business type guide from `${CLAUDE_PLUGIN_ROOT}/docs/smb/BUSINESS_TYPE.md` for:
- Tone and communication style (casual for cafes, professional for legal)
- Key differentiators and customer expectations
- Industry-specific review platforms (Yelp for restaurants, Houzz for contractors, Avvo for lawyers, etc.)

Read competitive positioning guidance from `${CLAUDE_PLUGIN_ROOT}/docs/smb/competitor-awareness.md`.

## Step 2 — Review monitoring coaching

Read `REVIEW_PLATFORMS` from `.site-config` if available.

### If `REVIEW_PLATFORMS` is set (structured walk-through)

Walk through each platform in order. For each:

1. Direct the owner to open their review page:
   - **Google:** Use `GOOGLE_REVIEW_URL` from `.site-config` if available. Otherwise: "Open Google Maps and search for your business name, then click Reviews."
   - **Yelp:** "Open yelp.com and search for your business name, then click the Reviews tab."
   - **Booking platform** (Fresha, Vagaro, Booksy, etc.): "Open [platform] and check your reviews dashboard."
   - **Other platforms:** Direct the owner to the review section of that platform.

2. Ask: "Any new reviews on [platform] since last time?"
   - If yes: "Read me the review (or paste it) and I'll help you draft a response." → proceed to Step 3.
   - If no: "Great — you're caught up on [platform]." → move to next platform.

3. After all platforms: proceed to Step 4 (getting more reviews).

### If `REVIEW_PLATFORMS` is not set but `BUSINESS_TYPE` is (generic coaching)

Fall back to general questions:

1. **"Have you checked your Google reviews recently?"** — Most owners forget. A gentle nudge is the most valuable thing this skill does.
2. **"Any new reviews since we last talked?"** — If yes, offer to help draft a response (Step 3).
3. **"Are you getting reviews from customers?"** — If not, suggest a simple ask strategy (Step 4).

Also ask: "Which platforms do your customers use for reviews? I can save that so next time we go through them one by one." If the owner answers, save to `.site-config` as `REVIEW_PLATFORMS`.

### Non-interactive context (e.g., part of `/anglesite:check`)

Skip the questions. Present 1-3 platform-specific coaching tips based on `REVIEW_PLATFORMS` (or generic tips if not set). Example: "Reminder: check your Google and Yelp reviews this week. Responding within a few days shows customers you care."

## Step 3 — Review response drafting

When the owner shares a review (reads it aloud or pastes it), draft a response that:

### For positive reviews (4-5 stars)
- Thank the reviewer by name
- Reference something specific they mentioned (shows the response isn't generic)
- Keep it warm and brief (2-3 sentences)
- Match the business's tone from the SMB guide

### For negative reviews (1-3 stars)
- Acknowledge the experience — never dismiss or argue
- Apologize for the specific issue (not a generic "sorry for the inconvenience")
- Offer to make it right offline ("Please call us at [phone] so we can fix this")
- Keep it professional — future customers read the response more than the review
- Never reveal private details about the transaction

### Response templates by tone

**Casual** (cafes, shops, salons):
> Thanks [Name]! So glad you enjoyed [specific thing]. See you next time!

**Professional** (legal, medical, financial):
> Thank you for your kind words, [Name]. We're pleased we could help with [general reference]. We appreciate your trust.

**Warm** (childcare, pet care, community orgs):
> [Name], this made our day! [Specific reference]. Thank you for being part of our community.

Adapt the tone using the `BUSINESS_TYPE` guide. Never use emojis in professional contexts. Never fabricate details the reviewer didn't mention.

## Step 4 — Getting more reviews

If the owner has few reviews, suggest these low-effort strategies:

1. **Ask at the point of success** — right after a positive interaction, say "Would you mind leaving us a Google review? It really helps." Timing matters more than the ask.
2. **Make it easy** — add a direct review link to the website, email signature, and receipts. The Google review link format is: `https://search.google.com/local/writereview?placeid=PLACE_ID`
3. **Add a review link to the website** — a simple "Leave us a review" link in the footer or contact page. Check if this already exists.
4. **Follow up** — for service businesses, a thank-you email a day after service with a review link converts well.
5. **Never incentivize** — offering discounts for reviews violates Google's policies and erodes trust.
6. **QR code** — Invoke the `qr` skill to generate a QR code for the Google review link. The owner can print it on receipts, table tents, or business cards. (The `qr` skill is model-only — invoke it directly, do not present it as a slash command to the owner.)

Check if the site already has a Google review link by scanning `src/` for review-related URLs or text. If not, suggest adding one.

## Step 5 — Competitive context

Reference the guidance in `${CLAUDE_PLUGIN_ROOT}/docs/smb/competitor-awareness.md`. This is a light check, not a deep analysis.

If the owner named competitors during `/anglesite:design-interview` (check `.site-config` for `COMPETITORS`), briefly note:
- "Last time you mentioned [competitor]. Have they changed anything on their site?"
- "Are customers mentioning other businesses when they come to you?"

If no competitors are recorded, ask: "Who are the other [business type] businesses in your area?" and save the answer to `.site-config` as `COMPETITORS` (comma-separated names) for future sessions.

**Do not visit competitor websites during this skill.** That's a separate, intentional activity for quarterly reviews. Just surface the awareness.

## Step 6 — Action items

Summarize 1-3 concrete, low-effort actions. Never more than three — the owner is busy. Prioritize by impact:

1. **Respond to unanswered reviews** (highest impact — shows customers the owner cares)
2. **Add a review link to the website** (one-time setup, ongoing benefit)
3. **Ask one happy customer for a review this week** (small habit, compounds over time)

Present actions in plain English. No jargon, no marketing terminology. Frame each action as something that takes less than 5 minutes.

## Integration with other skills

- **`/anglesite:check`** — include a "Reputation" section with review coaching tips
- **`/anglesite:testimonials`** — if the testimonials system is set up, remind the owner that platform reviews (Google, Yelp) and on-site testimonials serve different purposes: platform reviews help new customers find the business; on-site testimonials help visitors who already found it
- **`/anglesite:seasonal`** — holiday seasons often bring more reviews; suggest monitoring more actively during peak periods
- **`/anglesite:business-info`** — ensure Google Business Profile hours, phone, and address match the website

## Keep docs in sync

After first run, update:
- `.site-config` — `COMPETITORS` value if learned
- `docs/architecture.md` — note review link if added to the site
