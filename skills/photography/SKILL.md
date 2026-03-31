---
name: photography
description: "Generate a prioritized, site-type-specific shot list with phone photography tips"
allowed-tools: Read, Glob, Write
disable-model-invocation: true
---

Generate a custom photography shot list based on the site type, plus practical phone photography tips. Helps owners know exactly what photos to take before filling in site content.

## When to invoke this skill

- During onboarding (after the design interview, before content collection)
- When the owner asks "what photos do I need?" or "how do I take good photos?"
- Via `/anglesite:photography` at any time

Frame it as empowering, not prescriptive. The owner should feel capable, not overwhelmed.

## Step 1 — Read context

Read `.site-config` for:
- `BUSINESS_TYPE` — determines which shots to include
- `SITE_TYPE` — fallback if `BUSINESS_TYPE` is not set
- `SITE_NAME` — for personalized output

If neither `BUSINESS_TYPE` nor `SITE_TYPE` is available, ask the owner what kind of site they have before proceeding.

## Step 2 — Read the shot list knowledge doc

Read `${CLAUDE_PLUGIN_ROOT}/docs/photography-shots.md`.

This document maps site types to prioritized shots. Each shot has:
- **Label** — what to capture
- **Priority** — must-have, high-value, or nice-to-have
- **Description** — what the shot should look like
- **Rationale** — why it matters for this site type

Universal shots apply to every site. Site-type sections have a "Covers:" line listing all business types that section applies to.

## Step 3 — Generate the shot list

Filter the shots to those relevant for the owner's business type:
1. Always include all **Universal** shots
2. Include shots from sections whose "Covers:" line includes the owner's `BUSINESS_TYPE`
3. For comma-separated business types (e.g. "restaurant,catering"), include shots matching any listed type

Group the filtered shots by priority tier:
- **Must-have** — the photos that make the biggest difference; shoot these first
- **High value** — strong additions that elevate the site
- **Nice to have** — polish shots when the owner has time

For each shot, include the label, description, and rationale ("Why: ...").

## Step 4 — Add phone photography tips

Include these five principles — brief, actionable, no jargon:

### 1. Light is everything — find a window
Soft, indirect natural light (not direct sun) flatters everything. Shoot with the light on the subject, not behind it. Cloudy days are better than sunny ones for portraits.

### 2. Clean your lens
Phone lenses collect fingerprints constantly. Wipe with a soft cloth before every session. This one habit fixes more blurry, hazy photos than any setting change.

### 3. Lock focus and exposure
Tap the subject on the screen before shooting. On iPhone, tap and hold to lock focus and exposure. On Android, most camera apps support the same tap-to-focus behavior.

### 4. Keep it still — brace or use a tripod
Camera shake is the #1 cause of soft photos. Brace elbows against the body, lean against a wall, or use a $15 phone tripod. For food and product shots, a tripod is worth it.

### 5. Shoot more than you think you need
Take 10–20 variations of every important shot: different angles, distances, slightly adjusted framing. Delete ruthlessly later. The winning shot is rarely the first.

**Bonus:** Even modest editing lifts phone photos significantly. Increase exposure slightly, boost clarity/sharpness, and lift shadows. Most phones have a built-in editor capable of this.

## Step 5 — Add external resources

Read `${CLAUDE_PLUGIN_ROOT}/docs/photography-resources.json` for curated learning resources and editing apps.

Format resources by type:
- **Guides** — learning resources with links
- **Apps** — editing tools (mention they're available on App Store / Google Play)

## Step 6 — Present and optionally save

Present the complete guide in the conversation, structured as:

```
# Your Shot List
(prioritized shots by tier)

## Getting good photos from your phone
(five tips)

## Go deeper
(external resources)
```

Then offer to save:

> "Want me to save this as a reference? I can put it in your project so you can check it off as you go."

If the owner says yes, write to `src/content/PHOTOGRAPHY.md`.

## Step 7 — Offer follow-up

Close with an encouraging offer:

> "Want me to check in after you've had a chance to shoot? I can help you pick the best ones and get them sized right for your site."

## Tone

- Encouraging, not condescending
- Practical, not academic
- Brief — the owner needs to act, not study
- The owner's phone camera is good enough. Reinforce this.
