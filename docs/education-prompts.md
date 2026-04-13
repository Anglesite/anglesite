# Client Education Prompts

Proactive education prompts that surface common misconceptions at the exact moment they're most actionable. Each topic fires once per session — check `.site-config` for `EDUCATION_<KEY>=shown` before surfacing, and write the flag after.

The tone is trusted expert: "Totally makes sense to want that — here's what we've learned about how it actually plays out."

## Tracking convention

Before surfacing any education topic, read `.site-config` and check for the flag `EDUCATION_<KEY>=shown` (where `<KEY>` matches the key in the tables below). If the flag exists, skip it — the owner has already heard this one. After surfacing a topic, add `EDUCATION_<KEY>=shown` to `.site-config` using the Write tool.

Education flags use the `EDUCATION_` prefix to avoid collisions with other config keys.

---

## 1. First Run / Site Type Selection

**Trigger:** After gathering the site type in `/anglesite:start` Step 0, before moving to scaffolding.

| Key | Topic | Copy direction |
|-----|-------|----------------|
| `LAUNCH_NOT_FINISH` | A website is the start, not the end | "A website isn't a thing you finish — it's a thing you tend. Content, updates, and search visibility are ongoing. The good news: you don't need to do it all yourself. That's what I'm here for." |
| `THREE_PAGES` | Three solid pages beats a perpetual draft | "You don't need everything figured out before launching. Three solid pages — who you are, what you do, how to reach you — beats a beautiful draft that no one ever sees." |

---

## 2. Domain Setup

**Trigger:** During domain selection in `/anglesite:deploy` Step 4 or `/anglesite:domain`.

| Key | Topic | Copy direction |
|-----|-------|----------------|
| `DOMAIN_VS_WEBSITE` | Domain is not the website | "Quick thing worth knowing: a domain is like a mailing address — it tells people where to find you. The website is the building. You can have an address without a building (parked domain) or a building without a custom address (.pages.dev). We're setting up both." |
| `DOMAIN_RENEWAL` | Annual renewal and lapse risk | "Domains renew annually. If a renewal lapses, someone else can register it — that's how sites get hijacked. Cloudflare sends renewal reminders, but it's worth putting it in your calendar too." |
| `EMAIL_NOT_AUTOMATIC` | Email requires separate DNS setup | "Having a domain doesn't automatically give you email. Email needs its own setup — DNS records that point to a mail provider. We can set that up with `/anglesite:domain` whenever you're ready." |
| `TLD_AND_SEO` | TLD doesn't directly affect rankings | "There's a common belief that .com is better for search ranking — it's not, directly. Google treats all standard TLDs equally. What .com does have is brand recognition: people assume URLs end in .com. For your situation, [recommend based on domain guide]." |

---

## 3. Design Phase

**Trigger:** During the design interview when user input conflicts with a known best practice.

| Key | Topic | Trigger condition | Copy direction |
|-----|-------|-------------------|----------------|
| `MOBILE_FIRST` | 60%+ of traffic is mobile | Surface once early in the interview | "Your site is built mobile-first — the phone layout comes first, then expands for larger screens. For most small businesses, 60% or more of visitors are on phones. Everything we design will look great on both." |
| `WHITESPACE` | Whitespace is intentional | Owner asks to "fill in" gaps or says there's "too much space" | "That breathing room is intentional — it actually improves comprehension and makes the page feel more professional. Dense pages make visitors' eyes glaze over. Let's keep the space and make sure the content in it earns its place." |
| `COMPETITOR_COPY` | Copying a competitor's design | Owner asks to replicate another site's design exactly | "I can definitely draw inspiration from that — but your brand's differentiation *is* its design. Beyond copyright concerns, looking exactly like a competitor makes it harder for customers to remember which is which. Let's take what you like about it and make it yours." |

---

## 4. Content Phase

**Trigger:** During content creation in `/anglesite:start` Step 7 (iterate) or any page creation session.

| Key | Topic | Trigger condition | Copy direction |
|-----|-------|-------------------|----------------|
| `COPY_LATER` | Content is the hard part | Owner says "I'll write the copy later" or defers on content | "Content is actually the hardest part of a website — the design wraps around it, not the other way around. Want me to draft something based on what you've told me? You can edit it later, and having *something* there is way better than a blank page." |
| `HOMEPAGE_OVERLOAD` | One page, one job | Homepage scope expands to cover every aspect of the business | "A homepage has one job: make visitors confident they're in the right place, and show them where to go next. Right now this is trying to do a lot — let's move some of this to dedicated pages where it can breathe." |
| `PAGE_COUNT_SEO` | Thin pages hurt more than they help | Owner asks to create pages "for SEO" with thin content | "More pages doesn't mean better search ranking. Thin pages — ones with a paragraph or two and no real substance — actually hurt. Search engines reward depth. Let's focus on making fewer pages genuinely useful." |

---

## 5. Pre-Publish Checklist

**Trigger:** During `/anglesite:deploy` Step 2.5 (preview) on first deploy.

Surface this as a quick structured check-in before going live:

| Key | Check |
|-----|-------|
| `PREPUB_PURPOSE` | "Does every page have a single clear purpose? If you can't say what a page is *for* in one sentence, visitors won't know either." |
| `PREPUB_CONTACT` | "Is your contact information accurate and consistent across every page?" |
| `PREPUB_FAVICON` | "Do you have a favicon? It's the tiny icon in the browser tab — without one, the site looks unfinished." |
| `PREPUB_READALOUD` | "Have you read the homepage out loud? It's the fastest way to catch awkward copy." |
| `PREPUB_GAPS` | "Content gaps are much easier to fix before search engines start indexing. Anything you're still waiting on?" |

---

## 6. Post-Publish Success Message

**Trigger:** After a successful first deploy in `/anglesite:deploy` Step 7 (or after Step 5 domain connection on first deploy).

| Key | Topic | Copy direction |
|-----|-------|----------------|
| `SEO_TIMELINE` | Ranking takes 3-6 months | "Your sitemap has been submitted to search engines, but ranking is a 3-6 month investment. If you search for your business and don't see it yet, that's normal — not a sign something is wrong." |
| `INDEXING_DELAY` | Indexing takes days to weeks | "Your site won't appear in Google search results immediately. It typically takes a few days to a few weeks for new sites to be indexed. In the meantime, sharing your URL directly is the fastest way to get visitors." |
| `DISTRIBUTION` | A published site needs active sharing | "A published website is a business card in a drawer until it's shared. Next steps that make a real difference: claim your Google Business Profile, add the URL to your email signature, share it on social media, and add it to any directories for your industry." |

---

## 7. Migration Flow

**Trigger:** At the start of `/anglesite:import`, before migration begins. Frame as "a few things worth knowing before we start."

| Key | Topic | Copy direction |
|-----|-------|----------------|
| `THEME_OWNERSHIP` | You own your content, not the theme | "One thing worth knowing: you own all your content — posts, pages, images. But the theme and plugins from [platform] don't transfer. That's actually a feature, not a limitation: we'll rebuild the design fresh, tailored to you, instead of carrying over someone else's template." |
| `PRUNING` | Migration is a pruning opportunity | "Before we import everything, this is a great time to do a quick content audit. Pages that are outdated, thin, or no longer relevant can actually hurt your search rankings. Want to review what's there and decide what's worth bringing over?" |
| `PLATFORM_DESIGN` | The visual design belongs to the platform | "The visual look of your [Squarespace/Wix/etc.] site was built by their design team — it doesn't come with you. But that means we get a fresh start. I'll design something that's distinctly yours." |

---

## Phrase-matching reference

These phrases signal underlying misconceptions. When heard anywhere in conversation, surface the matching education topic (if not already shown).

| Phrase heard | Key | Reframe |
|---|---|---|
| "I want to be #1 on Google" | `SEO_TIMELINE` | Explain organic SEO timeline; offer what Anglesite handles at launch (sitemap, meta tags, semantic HTML) |
| "Just a quick change" | — | Acknowledge, then surface any downstream effects before executing (no flag — this is a behavioral pattern, not a one-time education) |
| "My nephew said..." / "Someone told me..." | — | Validate the curiosity, then clarify with specifics (no flag — respond in context each time) |
| "I want it to look exactly like [X]" | `COMPETITOR_COPY` | Gently note IP considerations and the value of distinct branding |
| "I'll add the content later" | `COPY_LATER` | Reframe content as the hardest part; offer to help now |
| "I need more pages for SEO" | `PAGE_COUNT_SEO` | Depth over breadth; thin pages hurt rankings |
| "Why isn't my site on Google yet?" | `INDEXING_DELAY` | Explain indexing timeline; suggest direct sharing in the meantime |
