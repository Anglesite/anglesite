---
name: copy-edit
description: "Audit and coach website copy for clarity, tone, and brand voice"
user-invokable: false
allowed-tools: Read, Glob
---

Audit website copy quality across all pages and provide guidance-first coaching. Called during `/anglesite:check`, `/anglesite:deploy`, after `/anglesite:new-page`, or when the owner asks about their writing. Not invoked directly by the owner.

This skill helps the owner's voice come through more clearly — it does not replace it. Think of it as an agency copy review: specific suggestions with reasons, not unsolicited rewrites.

## Architecture decisions

- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the owner's brand voice is theirs; guidance only, never rewrite without asking
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — read all content before making suggestions

## When to invoke this skill

- During `/anglesite:check` — add a "Copy quality" section to the health report
- During `/anglesite:deploy` — non-blocking content scan alongside the SEO audit
- After `/anglesite:new-page` — review the new page's copy and offer improvements
- When the owner asks "how's my writing?" or "can you improve my copy?"

## Step 1 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines tone expectations and industry vocabulary
- `SITE_NAME` — for personalized feedback
- `SITE_TYPE` — business, portfolio, web-artist, etc.

If `BUSINESS_TYPE` is not set, use generic best practices. Copy coaching is still useful without business context — it just can't tailor tone recommendations.

If `BUSINESS_TYPE` is set, read `${CLAUDE_PLUGIN_ROOT}/docs/smb/<BUSINESS_TYPE>.md` for:
- Tone and communication style (casual for cafes, professional for legal, warm for childcare)
- Target audience and what they care about
- Industry-specific vocabulary and common jargon to translate

### Brand voice profile

Check for a `docs/brand-voice.md` file in the project. If it exists, read it for:
- **Tone** (e.g., warm & approachable, professional & authoritative, casual & fun)
- **Audience** (who the customer is, what they care about)
- **Key differentiators** (what makes this business different)
- **Words to use / words to avoid** (preferred terminology, jargon to translate)
- **Voice examples** (1-2 sentences that "sound like" the brand)

If `docs/brand-voice.md` does not exist and this is a conversational invocation (not from `check` or `deploy`), offer to create one collaboratively:

> "Before I review your copy, it helps to capture your brand's voice — the way you want your business to sound. Want to spend a couple of minutes on that? I'll ask a few questions and save the answers so every future review stays consistent."

If the owner agrees, ask these questions one at a time:
1. "How would you describe your business's personality in three words?"
2. "Who is your ideal customer? What do they care about most?"
3. "What makes you different from others in your field?"
4. "Are there any words or phrases you love using — or hate seeing?"
5. "Show me a sentence from your site that sounds most like *you*."

Save the answers to `docs/brand-voice.md`. This profile is shared with the `syndicate` and future `social-media` skills.

## Step 2 — Sweep all content

Use `Glob` to find all `.mdx` and `.md` content files in `src/content/` and `src/pages/`. Also check `.astro` page files for inline text content (hero headlines, CTAs, about sections).

Read each file and evaluate against the audit checklist below. Track findings per page.

## Audit checklist

Evaluate each page against these timeless best practices:

### 1. Clarity over cleverness
Visitors want answers fast, not wordplay. Flag vague headlines and buried ledes. The most important information should be in the first sentence, not the third paragraph.

### 2. Benefits over features
"Get your car back by 5pm" beats "Same-day service available." Flag descriptions that list what the business does without explaining why the customer should care.

### 3. Consistent voice and tone
Flag pages that drift from the brand voice profile (if one exists) or from the tone of other pages. A casual About page and a stiff Services page feel like two different businesses.

### 4. Strong calls to action
Every page should have a clear next action. Flag pages with no CTA or weak/generic CTAs ("Click here", "Submit", "Learn more"). Suggest specific alternatives tied to the business ("Book your appointment", "See our menu", "Get a free estimate").

### 5. Scannable structure
Flag walls of text, missing subheadings, and overly long paragraphs (more than 4-5 sentences). Recommend bullet lists for key information (hours, pricing, steps, features).

### 6. Customer-first language
Flag excessive "we/our/I" and recommend "you/your" framing. The customer is the hero. Count the ratio — if "we" outnumbers "you" by more than 2:1, suggest reframing.

### 7. Jargon translation
Flag industry terms a general audience won't understand. Suggest plain-language alternatives. Use the business type guide's vocabulary section if available.

### 8. Social proof gaps
Note where credibility signals (testimonials, years in business, certifications, number of customers served) could be woven in naturally. Don't flag this if the page already has social proof.

### 9. Missing information
Cross-reference the business type guide's recommended page content against what's actually on each page. Flag gaps — e.g., a restaurant with no allergen mention, a salon with no pricing, a contractor with no service area.

### 10. Mobile readability
Flag overly long sentences (40+ words) and paragraphs that will form text walls on small screens. Suggest breaking them up.

## Step 3 — Present findings

### Non-interactive context (from `/anglesite:check` or `/anglesite:deploy`)

Present 1-5 findings as a brief "Copy quality" section. Prioritize high-impact items. Do not ask questions or offer to rewrite — just surface the observations.

Example format for the check report:

> **Copy quality**
> - The About page headline "About Us" doesn't tell visitors what makes you different — consider something specific like "Three generations of baking in Portland"
> - The Services page lists features without benefits — "Licensed and insured" could become "Your project is protected — we're fully licensed and insured"
> - No call to action on the Gallery page — visitors who love your work have no next step

If no issues are found, say: "Copy quality looks good — clear headlines, consistent tone, and every page has a next step for visitors."

For deploy context, write findings to `copy-edit-report.md` in the project root and mention it briefly: "I found a few copy improvements you can make later — they're saved in copy-edit-report.md."

### Interactive context (direct invocation or after page creation)

Present a full prioritized report per page:

```
## /about
### High priority
- **Headline is vague**: "About Us" — consider something that communicates your story, e.g., "Three generations of baking in Portland." Tells visitors immediately what makes you different.
- **No CTA**: Add a next step — "See our menu" or "Book a table" — so visitors know where to go next.

### Suggestions
- **Paragraph 3 is feature-heavy**: "We use locally sourced ingredients" — reframe as a benefit: "You'll taste the difference — every ingredient comes from farms within 50 miles."
- **Tone shift**: This page reads more formally than your home page. Consider matching the warm, conversational tone.
```

After presenting findings, ask: "Want me to make any of these changes? I'll show you the before and after so you can approve each one."

If the owner asks for rewrites, edit content files directly but always show the diff and ask for approval before moving on. Never batch-rewrite without review.

## Integration with other skills

- **`/anglesite:check`** — include a "Copy quality" section in the health report (non-interactive)
- **`/anglesite:deploy`** — non-blocking content scan; write findings to `copy-edit-report.md`
- **`/anglesite:new-page`** — after page creation, review the new page's copy interactively
- **`/anglesite:syndicate`** — shares `docs/brand-voice.md` for consistent tone across platforms

## Keep docs in sync

After first run, update:
- `docs/brand-voice.md` — create if the owner completes the voice profile questions
- `docs/architecture.md` — note `brand-voice.md` if created
