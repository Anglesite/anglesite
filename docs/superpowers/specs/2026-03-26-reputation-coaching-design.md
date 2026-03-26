# Reputation coaching enhancements — design spec

**Issue:** [#61 — Add competitor awareness and review monitoring skill](https://github.com/Anglesite/anglesite/issues/61)
**Scope:** V1 — enhance existing reputation skill with multi-platform coaching and better onboarding
**Date:** 2026-03-26

## Problem

The `skills/reputation/SKILL.md` skill already exists and provides review coaching, response drafting, and competitive context. However, it has two gaps:

1. **Platform awareness** — The skill assumes Google is the only review platform. It doesn't know which platforms the owner uses (Yelp, booking platforms, industry-specific sites) and can't coach per-platform.
2. **Onboarding** — The `/anglesite:start` skill doesn't collect review platform information, so the reputation skill lacks context about where the owner's reviews live.

The `docs/smb/reviews.md` reference doc already has comprehensive platform-by-vertical guidance (lines 19-40), but this knowledge isn't connected to the skill or the vertical docs where the Webmaster looks for business-specific advice.

## Existing state

**`skills/reputation/SKILL.md`** — Already has:
- Review coaching flow (Steps 2-4)
- Response drafting with tone-by-vertical templates (Step 3)
- Review solicitation coaching (Step 4)
- Competitive context with `COMPETITORS` in `.site-config` (Step 5)
- Action item summary (Step 6)
- Integration with check, testimonials, seasonal, and business-info skills
- Privacy rule: never store review content locally
- Guard: skips if `BUSINESS_TYPE` is not set

**`skills/check/SKILL.md`** — Already has a "Reputation" section (line 122-126) that invokes the reputation skill when `BUSINESS_TYPE` is set.

**`docs/smb/reviews.md`** — Comprehensive reference covering platforms by vertical, solicitation strategies, response templates, and monitoring cadence. Already directs the start and design-interview skills to ask about review platforms.

## Changes

### 1. Add `REVIEW_PLATFORMS` to `.site-config` during `/anglesite:start`

**Where:** In `/anglesite:start` Step 0, question 7 ("Are you already using any tools or apps for your business?") in the `SITE_TYPE=business` branch. Add to this existing question flow. **Only for business and organization site types** — personal, blog, and portfolio sites don't have review platforms.

- "Where do your customers leave reviews? Google, Yelp, your booking platform?" — Store as `REVIEW_PLATFORMS=google,yelp,fresha` (comma-separated slugs) in `.site-config`.
- If they mention Google Business Profile and `GOOGLE_REVIEW_URL` isn't already set, construct the direct review link (`https://search.google.com/local/writereview?placeid=PLACE_ID`) and store it. Don't store `GOOGLE_PLACE_ID` separately — it's embedded in the URL and a redundant key adds confusion.

This connects the guidance in `docs/smb/reviews.md` (line 41: "ask: Where have your customers left reviews?") to the actual start flow.

### 2. Enhance the reputation skill with per-platform walk-through

**File:** `skills/reputation/SKILL.md`
**Nature:** Modify existing Step 2 (review monitoring coaching), not replace the skill.

Current Step 2 asks three generic questions. Replace with a structured per-platform flow:

**If `REVIEW_PLATFORMS` is set in `.site-config`:**
- Walk through each platform in order
- For each: direct the owner to open their review page (provide `GOOGLE_REVIEW_URL` if available for Google)
- "Any new reviews on [platform] since last time?"
- If yes: proceed to existing Step 3 (response drafting) for each review
- If no: "You're caught up on [platform]."

**If `REVIEW_PLATFORMS` is not set but `BUSINESS_TYPE` is:**
- Fall back to current behavior (generic "Have you checked your Google reviews?")
- Additionally ask which platforms they use and offer to save to `.site-config` for next time

This preserves the existing guard (`BUSINESS_TYPE` required) and adds `REVIEW_PLATFORMS` as an enhancement, not a replacement.

Also add to Step 4 (getting more reviews): when suggesting a QR code for the review link, invoke the `qr` skill directly (it's model-only, not user-invokable — don't present it as `/anglesite:qr`).

### 3. Refine the check nudge

**File:** `skills/check/SKILL.md`
**Nature:** Modify existing "Reputation" section (lines 122-126).

Current behavior: invokes the full reputation skill when `BUSINESS_TYPE` is set.

Change to: the check skill still invokes the reputation skill (same `Read ... and follow it` pattern), but passes context that this is a check-in. The reputation skill handles the lighter touch internally — its Step 2 already distinguishes interactive vs. non-interactive contexts. The change in the check skill is to pass `REVIEW_PLATFORMS` context so the reputation skill can name specific platforms:

- If `REVIEW_PLATFORMS` is set: the check skill's Reputation section notes the specific platforms before invoking the reputation skill, so it can say "Have you checked your Google and Yelp reviews recently?" instead of generic "Google reviews"
- If only `BUSINESS_TYPE` is set: current behavior (invoke reputation skill with generic context)
- Keep it to 1-3 action items max (already specified in the reputation skill's Step 6)

### 4. Add `## Review platforms` sections to `docs/smb/<type>.md` files

Each vertical doc gets a standardized section listing which platforms matter and why. Content sourced from the existing table in `docs/smb/reviews.md` (lines 19-40) but expanded with vertical-specific context.

**For verticals that already mention reviews** (e.g., `salon.md` line 39 mentions reviews on Google, Yelp, and booking platforms): consolidate existing review mentions into the new `## Review platforms` section. Don't duplicate — move and expand.

**For verticals that don't mention reviews yet:** Add the section based on the `reviews.md` platform table and the vertical's characteristics.

**Structure per vertical:**

```markdown
## Review platforms

- **[Platform]** — [Why it matters for this vertical]. [What to watch for.]
```

Example for salon:

```markdown
## Review platforms

- **Google Business Profile** — Primary discovery channel. Most clients search "salon near me" and pick based on stars and photos. Respond to every review.
- **Yelp** — Heavily used for beauty services, especially urban areas. Yelp's filter is aggressive — don't panic if reviews disappear; filtered reviews are still visible to users who click through.
- **Booking platform** (Fresha, Vagaro, Booksy) — Reviews here appear at the moment of booking. A provider with 50 reviews converts better than one with 5.
- **Instagram** — Not traditional reviews, but DM testimonials and comment praise are social proof. Ask permission to screenshot and feature them.

See `docs/smb/reviews.md` for full review management guidance.
```

### 5. Add workflow doc for non-plugin agents

**File:** `template/docs/workflows/reputation.md`

A step-by-step guide for agents that don't have access to the plugin skill system. Covers:
- Which platforms to check (read from `.site-config` or ask the owner)
- How to coach the owner through reviewing and responding
- Response drafting guidelines (reference `docs/smb/reviews.md`)
- When to suggest this workflow (quarterly, after seasonal peaks)

## Files changed

| File | Change |
|---|---|
| `skills/reputation/SKILL.md` | Add per-platform walk-through to Step 2; reference `REVIEW_PLATFORMS` config key |
| `skills/start/SKILL.md` | Add review platform question to tool/service discovery |
| `skills/check/SKILL.md` | Refine Reputation section to name specific platforms when known |
| `docs/smb/<type>.md` (all verticals) | Add or consolidate `## Review platforms` section |
| `template/docs/workflows/reputation.md` | New workflow doc for non-plugin agents |

## Files not changed

| File | Why |
|---|---|
| `docs/smb/reviews.md` | Already comprehensive — remains canonical reference |
| `skills/testimonials/SKILL.md` | First-party review collection stays separate |
| `CLAUDE.md` | `reputation` skill already listed in model-only skills table |

## Out of scope (future versions)

- API integration with Google Business Profile or other platforms
- Automated review monitoring or alerts
- Sentiment analysis of reviews
- Competitive review comparison
- Review data storage or analytics
