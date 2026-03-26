# Reputation coaching skill — design spec

**Issue:** [#61 — Add competitor awareness and review monitoring skill](https://github.com/Anglesite/anglesite/issues/61)
**Scope:** V1 — guide-based coaching for third-party review management (no OAuth, no API integrations)
**Date:** 2026-03-26

## Problem

Online reputation management is critical for local businesses, but owners don't know when to check reviews, how to respond well, or which platforms matter for their business type. The existing `docs/smb/reviews.md` has comprehensive guidance, but it's passive reference material — the owner has to seek it out. Meanwhile, unanswered reviews pile up and hurt reputation.

## Solution

A model-only skill (`reputation`) that coaches owners through their third-party reviews in a structured conversation, paired with integration into `start` (collect platform profiles) and `check` (periodic nudge).

The Webmaster is a writing coach, not an integration. No API calls, no OAuth, no scraping, no storing review content. The owner reads their own reviews and posts their own responses. The Webmaster helps them do it well.

## Components

### 1. `.site-config` integration during `/anglesite:start`

During Step 4 (content discovery), after the design interview, add these questions:

- "Do you have a Google Business Profile?" — If yes, find their Place ID and store `GOOGLE_PLACE_ID` and `GOOGLE_REVIEW_URL=https://search.google.com/local/writereview?placeid=...` in `.site-config`.
- "Where else do your customers leave reviews?" — Store as `REVIEW_PLATFORMS=google,yelp,fresha` (comma-separated slugs) in `.site-config`.
- "How often do you check your reviews?" — Informs nudge tone (encouragement vs. reminder).

This wires up guidance already in `docs/smb/reviews.md` (lines 40-41) that says to ask during start but wasn't connected to the skill.

### 2. Check-in nudge in `/anglesite:check`

After automated diagnostics complete, if `REVIEW_PLATFORMS` is set in `.site-config`, the Webmaster adds one question:

> "Quick question — have you checked your [Google/Yelp/etc.] reviews recently? If there are any you haven't responded to, I can help you draft responses."

Rules:
- One question, not a diagnostic step. Doesn't block the check workflow.
- If `REVIEW_PLATFORMS` is not set, don't mention reviews — no nagging about setup they haven't opted into.
- Point the owner to the reputation skill for the full walk-through.

### 3. The `reputation` skill

**Location:** `skills/reputation/SKILL.md`
**Type:** Model-only (`user-invokable: false`)
**Invoked when:** Owner asks about reviews, responds to the check nudge, or says "help me with my reviews."

**Flow:**

1. **Read context** — Pull `REVIEW_PLATFORMS`, `GOOGLE_REVIEW_URL`, `BUSINESS_TYPE` from `.site-config`. Read the matching `docs/smb/<type>.md` for platform-specific guidance and `docs/smb/reviews.md` for universal guidance.

2. **Platform-by-platform walk-through** — For each platform in `REVIEW_PLATFORMS`:
   - Direct the owner to open their review page (provide the URL if known, e.g., `GOOGLE_REVIEW_URL`).
   - "Any new reviews since last time?"
   - If yes: "Read me the review (or paste it) and I'll help you draft a response."
   - If no: "Great — you're caught up on [platform]."

3. **Response drafting** — When the owner shares a review:
   - **Positive reviews:** Draft a short, genuine, specific response. Reference something from the review. Avoid generic templates repeated verbatim.
   - **Negative reviews:** Draft a professional, empathetic response that acknowledges the problem and takes the conversation offline. Follow the template pattern in `reviews.md`.
   - **Fake/malicious reviews:** Coach the owner through the reporting process for that platform. Draft a calm, factual public response.
   - Match the business's tone — casual for cafes, professional for legal. Read tone guidance from the vertical's `docs/smb/<type>.md`.

4. **Solicitation coaching** — After the review walk-through, if the owner has few reviews relative to their business age:
   - Suggest adding a "Leave us a review" link to the contact page (with direct URL to Google review form).
   - Offer to generate a QR code for the review link via `/anglesite:qr`.
   - Suggest printed review cards, follow-up email language, or in-person scripts from `reviews.md`.

5. **Wrap up** — Summarize: how many reviews were addressed, on which platforms, and any site changes made. Suggest when to check again.

**What it does not do:**
- No API calls to any review platform
- No OAuth or authentication to any external service
- No scraping or crawling review sites
- No storing review content in the project or git
- Never posts responses on behalf of the owner — only drafts them
- No automated monitoring or alerting

### 4. Updates to `docs/smb/<type>.md` files

Each vertical doc gets a standardized `## Review platforms` section listing:
- Which platforms matter most for that business type
- Why each platform matters (discovery vs. booking vs. reputation)
- What to watch for on each platform (e.g., Yelp's aggressive filter, booking platform reviews appearing at moment of purchase)

Content is redistributed from the existing table in `docs/smb/reviews.md` (lines 19-40) but expanded with vertical-specific context. The canonical reference remains `reviews.md` — vertical docs point to it for the full picture.

Example for salon:

```markdown
## Review platforms

- **Google Business Profile** — Primary discovery channel. Most clients search "salon near me" and pick based on stars and photos. Respond to every review.
- **Yelp** — Heavily used for beauty services, especially urban areas. Yelp's filter is aggressive — don't panic if reviews disappear; filtered reviews are still visible to users who click through.
- **Booking platform** (Fresha, Vagaro, Booksy) — Reviews here appear at the moment of booking. A provider with 50 reviews converts better than one with 5.
- **Instagram** — Not traditional reviews, but DM testimonials and comment praise are social proof. Ask permission to screenshot and feature them.
```

## Files changed

| File | Change |
|---|---|
| `skills/reputation/SKILL.md` | New model-only skill |
| `skills/start/SKILL.md` | Add review platform questions to Step 4 |
| `skills/check/SKILL.md` | Add review nudge after diagnostics |
| `docs/smb/<type>.md` (all verticals) | Add `## Review platforms` section |
| `CLAUDE.md` | Add `reputation` to model-only skills table |
| `template/docs/workflows/reputation.md` | New workflow doc for non-plugin agents |

## Files not changed

| File | Why |
|---|---|
| `docs/smb/reviews.md` | Already comprehensive — remains canonical reference |
| `skills/testimonials/SKILL.md` | First-party review collection is separate from third-party coaching |
| `template/worker/review-worker.js` | No backend changes needed |

## Out of scope (future versions)

- API integration with Google Business Profile or other platforms
- Automated review monitoring or alerts
- Sentiment analysis of reviews
- Competitive review comparison
- Review data storage or analytics
