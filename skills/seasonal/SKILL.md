---
name: seasonal
description: "Surface seasonal content suggestions based on business type and current date"
user-invokable: false
allowed-tools: Bash(date *), Read, Glob
---

Surface timely content suggestions from the seasonal marketing calendar. Called during session start, after blog post creation, or by the check skill — not invoked directly by the owner.

## When to invoke this skill

- At the start of a session (if `BUSINESS_TYPE` is set in `.site-config`)
- When the owner asks "what should I post?" or "any content ideas?"
- After `/anglesite:check` as a "while you're here" suggestion

Present suggestions gently — they're ideas, not tasks. The owner should feel inspired, not pressured.

## Step 1 — Get the current date from the system

**Do not guess the date.** Read it from the system:

```sh
date +%Y-%m-%d
```

Parse the output to get the year, month, and day. All date logic depends on this value.

## Step 2 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines which hooks are relevant
- `SITE_NAME` — for personalized suggestions

If `BUSINESS_TYPE` is not set, skip seasonal suggestions entirely. Universal ("types: all") hooks are too generic to be useful without business context.

## Step 3 — Read the seasonal calendar

Determine which quarter files to read. Always read the current quarter. If it's the last two weeks of a quarter, also read the next quarter (for lead-time events).

| Month | Current quarter | Also read next? |
|---|---|---|
| Jan–Feb, early Mar | `q1.md` | No |
| Late Mar | `q1.md` | `q2.md` |
| Apr–May, early Jun | `q2.md` | No |
| Late Jun | `q2.md` | `q3.md` |
| Jul–Aug, early Sep | `q3.md` | No |
| Late Sep | `q3.md` | `q4.md` |
| Oct–Nov, early Dec | `q4.md` | No |
| Late Dec | `q4.md` | `q1.md` |

Read the file(s) from `${CLAUDE_PLUGIN_ROOT}/docs/smb/seasonal-calendar/`.

Also read the owner's business type file from `${CLAUDE_PLUGIN_ROOT}/docs/smb/BUSINESS_TYPE.md` for the "Key dates" section with industry-specific awareness days.

## Step 4 — Filter and present

From the calendar entries, select events that:
1. Match the owner's `BUSINESS_TYPE` or are `types: all`
2. Fall within the next 3 weeks (or have lead times that start now)

Present 3–5 suggestions maximum. More than that feels overwhelming.

### Visual effect suggestions

For seasonal moments that could benefit from a visual effect, suggest invoking the `creative-canvas` skill (`${CLAUDE_PLUGIN_ROOT}/skills/creative-canvas/SKILL.md`). These work for any business type:

- **Winter holidays** (Dec) — falling snow effect on homepage
- **Autumn** (Sep–Nov) — falling leaves
- **New Year** (Dec 31–Jan 1) — fireworks or confetti
- **Celebrations** (any) — confetti burst on form submission or booking confirmation
- **Valentine's Day** (Feb 14) — floating hearts

Frame these as optional embellishments: "Want to add a little holiday magic to your homepage? I can add falling snow that disappears after the season." Always note that effects respect `prefers-reduced-motion` and won't slow down the site.

Format each suggestion conversationally:

> "**Valentine's Day** is in 20 days — florists often see great engagement from posts about arrangement previews and order deadlines. Want to create one?"

> "It's **tax season** — a good time for a post about your document checklist or appointment availability."

> "**Spring cleaning** season is starting — this is peak booking time for cleaning services. A 'book your spring deep clean' post could help fill your schedule."

If the owner has recently published a post on a topic that matches an upcoming hook, acknowledge it: "You already posted about spring cleaning — nice timing!"

To check recent posts:

```sh
date +%Y-%m-%d
```

Then look at files in `src/content/posts/` and read their frontmatter for `publishDate` and `title`.

## Frequency

Don't repeat the same suggestion in the same session. If the owner dismisses a suggestion ("not interested," "maybe later," "skip"), don't bring it up again.

Limit to one suggestion batch per session unless the owner asks for more.
