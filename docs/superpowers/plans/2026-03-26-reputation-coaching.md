# Reputation Coaching Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the existing reputation skill with multi-platform review coaching and connect it to the start/check workflows.

**Architecture:** Modify three existing skill files (reputation, start, check) to add platform awareness. Add `## Review platforms` sections to ~50 vertical docs in `docs/smb/`. Create one new workflow doc for non-plugin agents. No new infrastructure, APIs, or dependencies.

**Tech Stack:** Markdown (skill files, docs). No code changes — this is entirely skill/doc content.

**Spec:** `docs/superpowers/specs/2026-03-26-reputation-coaching-design.md`

---

### Task 1: Add `REVIEW_PLATFORMS` question to start skill

**Files:**
- Modify: `skills/start/SKILL.md:74` (after question 7 in business branch)

- [ ] **Step 1: Read the current start skill Step 0 business branch**

Read `skills/start/SKILL.md` lines 70-81. The new question goes after question 7 (tools/apps) and before question 8 (physical location).

- [ ] **Step 2: Add the review platforms question**

Insert after line 74 (the question 7 block), before question 8:

```markdown
7b. **Business and organization sites only:** "Where do your customers leave reviews? Google, Yelp, your booking platform?" — Save as `REVIEW_PLATFORMS=google,yelp,fresha` (comma-separated slugs) in `.site-config`. If they mention Google Business Profile and `GOOGLE_REVIEW_URL` is not already set, ask for their business name to construct the direct review link: `https://search.google.com/local/writereview?placeid=PLACE_ID`. Find the Place ID via [Google's Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) and save as `GOOGLE_REVIEW_URL` in `.site-config`. Skip this question for personal, blog, and portfolio site types.
```

- [ ] **Step 3: Verify the edit doesn't break the flow**

Read the surrounding lines (65-110) to confirm the question fits naturally between Q7 and Q8, and that the numbering/flow reads correctly.

- [ ] **Step 4: Commit**

```bash
git add skills/start/SKILL.md
git commit -m "feat(start): collect review platforms during onboarding

Adds question 7b to the business/org branch of Step 0 asking which
platforms the owner's customers use for reviews. Stores as
REVIEW_PLATFORMS in .site-config. Skipped for personal/blog/portfolio.

Refs #61"
```

---

### Task 2: Add per-platform walk-through to reputation skill

**Files:**
- Modify: `skills/reputation/SKILL.md:44-52` (Step 2)

- [ ] **Step 1: Read the current Step 2**

Read `skills/reputation/SKILL.md` lines 28-52. Understand the existing context-reading (Step 1) and review monitoring coaching (Step 2).

- [ ] **Step 2: Replace Step 2 with platform-aware version**

Replace lines 44-52 (the current Step 2) with:

```markdown
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
```

- [ ] **Step 3: Add QR code suggestion to Step 4**

In Step 4 (getting more reviews), after the existing bullet 3 about adding a review link to the website (around line 90-94), insert a new bullet:

```markdown
6. **QR code** — Invoke the `qr` skill to generate a QR code for the Google review link. The owner can print it on receipts, table tents, or business cards. (The `qr` skill is model-only — invoke it directly, do not present it as a slash command to the owner.)
```

This is an unconditional addition — the current file does not mention the qr skill at all.

- [ ] **Step 4: Add `REVIEW_PLATFORMS` to Step 1 context reading**

In Step 1, insert two new bullets into the existing `.site-config` read list (lines 30-33). Insert after the `SITE_URL` bullet (line 33). **Do not modify or remove lines 37-42** (the "Read the business type guide" and "Read competitive positioning guidance" paragraphs — those must stay).

Insert after line 33:

```markdown
- `REVIEW_PLATFORMS` — comma-separated platform slugs (google, yelp, fresha, etc.)
- `GOOGLE_REVIEW_URL` — direct link to Google review form (if available)
```

- [ ] **Step 5: Verify the full skill reads coherently**

Read the entire `skills/reputation/SKILL.md` to confirm the new Step 2 flows naturally into the unchanged Steps 3-6, and that the Step 1 updates are consistent.

- [ ] **Step 6: Commit**

```bash
git add skills/reputation/SKILL.md
git commit -m "feat(reputation): add per-platform review walk-through

Step 2 now iterates through REVIEW_PLATFORMS from .site-config, guiding
the owner to each platform individually. Falls back to generic Google
coaching when REVIEW_PLATFORMS is not set. Non-interactive context
(check skill) gets platform-specific tips instead of questions.

Refs #61"
```

---

### Task 3: Refine check skill Reputation section

**Files:**
- Modify: `skills/check/SKILL.md:122-127` (Reputation section through trailing blank line)

- [ ] **Step 1: Read the current Reputation section**

Read `skills/check/SKILL.md` lines 118-132.

- [ ] **Step 2: Replace the Reputation section**

Replace lines 122-127 (the `## Reputation` header through the trailing blank line before `## Results`) with:

```markdown
## Reputation

If `BUSINESS_TYPE` is set in `.site-config`, invoke the reputation skill for review coaching and competitive awareness.

Read `REVIEW_PLATFORMS` from `.site-config` if available. When invoking the reputation skill, note that this is a non-interactive check context so it should present tips, not questions.

If `REVIEW_PLATFORMS` is set, include the platform names in the nudge: "Reminder: check your [Google, Yelp] reviews — responding within a few days helps your reputation." If not set, use the generic nudge.

Read `${CLAUDE_PLUGIN_ROOT}/skills/reputation/SKILL.md` and follow it. Include the output as a "Reputation" section in the health report. Keep it brief — 1-3 action items max. If `BUSINESS_TYPE` is not set, skip this section.
```

- [ ] **Step 3: Verify surrounding context**

Read lines 112-135 to confirm the section fits between "Social preview" and "Results."

- [ ] **Step 4: Commit**

```bash
git add skills/check/SKILL.md
git commit -m "feat(check): name specific review platforms in reputation nudge

The Reputation section now reads REVIEW_PLATFORMS from .site-config and
names specific platforms in the coaching nudge instead of defaulting to
generic Google-only messaging.

Refs #61"
```

---

### Task 4: Create workflow doc for non-plugin agents

**Files:**
- Create: `template/docs/workflows/reputation.md`
- Modify: `template/AGENTS.md:42-57` (workflows table)

- [ ] **Step 1: Write the workflow doc**

Create `template/docs/workflows/reputation.md`:

```markdown
# Review reputation coaching

Help the site owner manage their online reviews across third-party platforms.

## When to use

- The owner asks about reviews, reputation, or "how do I respond to this review?"
- During a quarterly check-in
- After a seasonal peak (holidays, events) when review volume increases

## Before you start

Read `.site-config` for:
- `REVIEW_PLATFORMS` — which platforms the owner uses (e.g., `google,yelp,fresha`)
- `GOOGLE_REVIEW_URL` — direct link to their Google review form
- `BUSINESS_TYPE` — determines tone and platform relevance

If `REVIEW_PLATFORMS` is not set, ask the owner which platforms their customers use and save it.

## Steps

### 1. Walk through each platform

For each platform in `REVIEW_PLATFORMS`:

1. Direct the owner to open their review page
   - **Google:** Search for their business on Google Maps → Reviews tab
   - **Yelp:** Search on yelp.com → Reviews tab
   - **Booking platforms:** Check the reviews dashboard in their booking tool
2. Ask: "Any new reviews since last time?"
3. If yes: help draft a response (see below)
4. If no: move to the next platform

### 2. Draft review responses

**Positive reviews (4-5 stars):**
- Thank the reviewer by name
- Reference something specific they mentioned
- Keep it warm and brief (2-3 sentences)
- Match the business's tone (casual for cafes, professional for legal)

**Negative reviews (1-3 stars):**
- Acknowledge the problem — never dismiss or argue
- Apologize for the specific issue
- Take it offline: "Please call us at [phone] so we can make this right"
- Stay professional — future customers read the response more than the review

**Fake or malicious reviews:**
- Coach the owner through the platform's reporting process
- Draft a calm, factual public response

### 3. Encourage more reviews

If the owner has few reviews:
- Add a "Leave us a review" link to the contact page
- Suggest asking customers right after a positive experience
- Consider a QR code for the Google review link on printed materials

### 4. Wrap up

Summarize what was addressed: how many reviews responded to, on which platforms, and any site changes made. Suggest checking again in 2-4 weeks.

## Reference

Full review management guidance: `docs/smb/reviews.md`
```

- [ ] **Step 2: Add to the AGENTS.md workflows table**

In `template/AGENTS.md`, insert a new row after line 61 (the `testimonials.md` row):

```markdown
| Review reputation coaching | `docs/workflows/reputation.md` |
```

- [ ] **Step 3: Verify the table renders correctly**

Read `template/AGENTS.md` lines 38-65 to confirm the new row is present, aligned, and the table is well-formed.

- [ ] **Step 4: Commit**

```bash
git add template/docs/workflows/reputation.md template/AGENTS.md
git commit -m "docs: add reputation coaching workflow for non-plugin agents

Step-by-step guide for any AI agent to coach site owners through
third-party review management. Added to the AGENTS.md workflows table.

Refs #61"
```

---

### Task 5: Add `## Review platforms` to vertical docs (batch 1 — verticals with existing review content)

**Files:**
- Modify: ~15 vertical docs in `docs/smb/` that already mention reviews

These verticals already reference reviews somewhere in their content. Consolidate into a standardized `## Review platforms` section.

- [ ] **Step 1: Identify verticals with existing review mentions**

Search `docs/smb/` for files mentioning "review", "Yelp", "Google Business Profile", or "testimonial" (excluding `reviews.md`, `competitor-awareness.md`, `legal-checklist.md`, `README.md`, `pre-launch.md`, `info-changes.md`, `multi-mode.md`, and the `seasonal-calendar/` directory — these are reference docs, not verticals).

- [ ] **Step 2: Cross-reference with the platform table in reviews.md**

Read `docs/smb/reviews.md` lines 19-40 for the platform-by-business-type table. This is the source of truth for which platforms matter per vertical.

- [ ] **Step 3: For each vertical with existing review content, add `## Review platforms`**

For each file, add a `## Review platforms` section after the `## Tools` section (or after `## Design` if no Tools section). If the file already mentions reviews inline (e.g., salon.md line 39), move that content into the new section and expand it.

Pattern per vertical:

```markdown
## Review platforms

- **[Platform 1]** — [Why it matters for this vertical]. [What to watch for.]
- **[Platform 2]** — [Why it matters]. [Platform-specific note.]

See `docs/smb/reviews.md` for full review management guidance.
```

Use the `reviews.md` platform table for the platform list. Add vertical-specific context from the vertical doc's existing content and the design spec's examples.

- [ ] **Step 4: Verify no duplicate review content**

For each modified file, search for remaining review mentions outside the new section. If any exist, either move them into the section or confirm they serve a different purpose (e.g., "Testimonials page" in a Pages section is about site structure, not review platforms).

- [ ] **Step 5: Commit**

```bash
git add docs/smb/
git commit -m "docs(smb): add Review platforms section to verticals with existing review content

Consolidates scattered review mentions into a standardized section
per vertical. Platforms sourced from reviews.md table, expanded with
vertical-specific context.

Refs #61"
```

---

### Task 6: Add `## Review platforms` to vertical docs (batch 2 — verticals without review content)

**Files:**
- Modify: remaining vertical docs in `docs/smb/` (~35 files)

- [ ] **Step 1: Identify remaining verticals**

List all `docs/smb/*.md` files that are actual business verticals (not reference docs) and don't yet have a `## Review platforms` section after Task 5.

- [ ] **Step 2: For each, add `## Review platforms` based on business type**

Use the `reviews.md` platform table. If the vertical isn't in the table, default to:

```markdown
## Review platforms

- **Google Business Profile** — Primary discovery channel for local search. Claim the listing, keep hours current, and respond to every review.

See `docs/smb/reviews.md` for full review management guidance.
```

For verticals that have a clear match in the table (e.g., `hospitality.md` → TripAdvisor), add the relevant platforms. For verticals where review platforms are less obvious (e.g., `government.md`, `food-bank.md`), use only Google or skip the section entirely with a note: "Review platforms are less relevant for [type] — focus on community engagement instead."

Place the section after `## Tools` (or `## Design` if no Tools section), consistent with Task 5.

- [ ] **Step 3: Commit**

```bash
git add docs/smb/
git commit -m "docs(smb): add Review platforms section to remaining verticals

Adds standardized review platform guidance to verticals that didn't
previously mention reviews. Defaults to Google Business Profile for
verticals without industry-specific platforms.

Refs #61"
```

---

### Task 7: Final verification and cleanup

**Files:**
- Read: all modified files

- [ ] **Step 1: Verify reputation skill reads coherently end-to-end**

Read the full `skills/reputation/SKILL.md` and confirm the flow from Step 1 through Step 6 is logical and consistent.

- [ ] **Step 2: Verify start skill question flow**

Read `skills/start/SKILL.md` Step 0 and confirm question 7b fits naturally.

- [ ] **Step 3: Verify check skill Reputation section**

Read `skills/check/SKILL.md` lines 118-135 and confirm the section works.

- [ ] **Step 4: Verify workflow doc is discoverable**

Read `template/AGENTS.md` workflows table and confirm the new row is present and the path is correct.

- [ ] **Step 5: Spot-check 3-5 vertical docs**

Read `docs/smb/salon.md`, `docs/smb/restaurant.md`, `docs/smb/trades.md`, `docs/smb/accounting.md`, and one vertical that previously had no review content. Confirm the `## Review platforms` section is present, well-placed, and accurate.

- [ ] **Step 6: Run tests**

```bash
npm test
```

No new tests needed — this is all doc/skill content. But verify existing tests still pass since some tests validate skill structure. Note: if `tests/themes.test.ts` (an untracked file from parallel work) causes a failure, assess it separately — it is not a regression from this plan's changes.

- [ ] **Step 7: Final commit if any cleanup was needed**

Only if Steps 1-6 revealed issues that needed fixing.
