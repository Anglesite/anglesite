---
name: reputation
description: "Review monitoring, response coaching, and competitive awareness for local reputation management"
user-invokable: false
allowed-tools: Bash(date *), Read, Glob, WebFetch
---

Coach the owner on online reputation management — review responses, competitive awareness, and local visibility. Called when the owner asks about reviews, reputation, competitors, or Google Business Profile — not invoked directly.

## Architecture decisions

- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the owner decides how to respond to reviews; this skill coaches, never acts on their behalf
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — no third-party review widgets or scripts on the deployed site

## When to invoke this skill

- When the owner mentions reviews, reputation, competitors, or Google Business Profile
- During `/anglesite:check` as a "while you're here" suggestion (once per session, gently)
- When the owner asks "what are my competitors doing?" or "how do I get more reviews?"

This skill is advisory. It does not access external APIs or post anything on the owner's behalf. Present guidance conversationally — no jargon, no checklists shown to the owner.

## Step 1 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines tone and industry-specific advice
- `SITE_NAME` — for personalized suggestions
- `SITE_DOMAIN` — for linking to the review page if one exists

If `BUSINESS_TYPE` is not set, provide general advice only. Skip industry-specific guidance.

Read the business type doc from `${CLAUDE_PLUGIN_ROOT}/docs/smb/BUSINESS_TYPE.md` if it exists — look for tone, communication style, and customer relationship patterns.

Read `${CLAUDE_PLUGIN_ROOT}/docs/smb/competitor-awareness.md` for competitive positioning guidance.

## Step 2 — Get the current date

**Do not guess the date.** Read it from the system:

```sh
date +%Y-%m-%d
```

Use this to contextualize advice (e.g., seasonal review patterns, holiday rush periods).

## Step 3 — Review response coaching

If the owner shares a review (positive or negative) or asks for help responding, draft a response following these principles:

### Positive reviews
- Thank the reviewer by name if provided
- Reference something specific they mentioned (shows the response isn't generic)
- Keep it warm but brief — 2-3 sentences
- Invite them back naturally, not with marketing language

Example tone: "Thanks so much, [Name]! We're glad the [specific thing] worked out well. Looking forward to seeing you again."

### Negative reviews
- Acknowledge the experience — never dismiss or argue
- Apologize for the specific issue, not generically ("sorry you had a bad experience" feels hollow)
- Offer to make it right — provide a way to continue the conversation offline (phone or email)
- Keep it professional and brief — long defensive responses look worse than the review itself
- Never reveal private details about the customer or transaction

Example tone: "I'm sorry about the wait time on Saturday, [Name]. That's not the experience we want for anyone. I'd like to make this right — could you call us at [phone] so we can take care of it?"

### Industry-specific tone adjustments

Adjust response tone based on `BUSINESS_TYPE`:

| Business type | Tone |
|---|---|
| restaurant, cafe, brewery | Warm, casual, food-focused ("glad you enjoyed the...") |
| legal, accounting, financial | Professional, measured, confidentiality-aware |
| healthcare, dental, veterinary | Empathetic, HIPAA-aware (never confirm treatment details) |
| salon, spa, fitness | Friendly, personal, relationship-oriented |
| contractor, trades | Straightforward, solution-focused, workmanship pride |
| childcare, education | Caring, safety-conscious, community-oriented |
| (other) | Friendly and professional — match the owner's natural voice |

**Privacy rule:** Never include details in a review response that the reviewer didn't already make public. For healthcare businesses especially, do not confirm or deny that someone is a patient/client.

## Step 4 — Competitive awareness

If the owner asks about competitors or the conversation naturally leads there, follow the guidance in `${CLAUDE_PLUGIN_ROOT}/docs/smb/competitor-awareness.md`. Key points:

1. **Ask who their competitors are** — the owner usually knows 3-5 by name
2. **Note what competitors do well** — online booking, good photos, clear pricing, active reviews
3. **Find the gap** — what nobody in the market is doing well (transparency, real photos, accessibility, content)
4. **Play to strengths** — help the owner articulate their differentiator

Keep it brief — a 5-minute scan, not an hour-long analysis. The owner should spend their time on their own business.

### What NOT to do
- Don't mention competitors on the owner's website
- Don't copy competitor content or strategies verbatim
- Don't recommend expensive monitoring tools (SEMrush, Ahrefs) — manual quarterly checks are sufficient
- Don't create anxiety — this is about awareness, not obsession

## Step 5 — Review generation guidance

Help the owner get more reviews through ethical, sustainable methods:

### When to ask for reviews
- Right after a positive interaction (same day or next day)
- After completing a project or service successfully
- When a customer spontaneously compliments the business

### How to ask
- In person: "If you're happy with the work, a Google review would really help us out"
- Via email/text: Short, personal, with a direct link to the Google review page
- On the website: Add a gentle prompt on the testimonials or thank-you page

### What NOT to do
- Never offer incentives for reviews (violates Google's policies)
- Never ask only happy customers — selective solicitation looks suspicious
- Never fake reviews or use review generation services
- Never pressure customers — one ask is enough

### QR code integration

If the owner has set up QR codes (see the `qr` skill), suggest creating a review QR code:
- Links directly to the Google Business Profile review form
- Can be placed on receipts, business cards, table tents, or signage
- UTM parameters track how many reviews come from physical materials

Check if `src/pages/qr.astro` or similar exists — if so, mention this as an option.

## Step 6 — Testimonial page check

Check if the owner has a testimonials page set up:

Look for `src/pages/testimonials.astro` or `src/pages/reviews.astro`.

- **If it exists:** "You already have a testimonials page — are you keeping it updated with recent reviews? Fresh reviews help with both trust and search rankings."
- **If it doesn't exist:** "Would you like to add a testimonials page? It's a great way to show social proof. Customers trust other customers more than any marketing copy." (This would invoke the `testimonials` skill.)

## Step 7 — Actionable summary

End with 2-3 specific, doable action items. Not a lecture — just quick wins:

> "Here's what I'd suggest this week:"
> 1. "Respond to your two unanswered Google reviews — I've drafted responses above."
> 2. "Ask your next three happy customers for a Google review."
> 3. "Take a quick look at [competitor]'s website — they just added online booking, which might be worth considering."

Adjust the number and scope based on what came up in the conversation. If the owner only asked about responding to one review, don't pile on competitive analysis and review generation advice. Match the scope of the answer to the scope of the question.
