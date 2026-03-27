---
name: add-store
description: "Add ecommerce to your site — sells physical goods, digital downloads, services, or software"
allowed-tools: Write, Read, Edit, Glob
disable-model-invocation: true
---

Add ecommerce to the owner's site. This skill runs a short conversational intake, determines the right solution, and hands off to the appropriate sub-skill or explains what's coming next.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Check prerequisites

Read `.site-config` and verify:
- `CF_PROJECT_NAME` is set (site has been deployed at least once)

If missing, tell the owner: "Before adding a store, your site needs to be deployed at least once. Run `/anglesite:deploy` to get set up, then come back here."

If `ECOMMERCE_PROVIDER` is already set in `.site-config`, the owner has already configured ecommerce. Ask: "You already have [provider] set up. Do you want to add another product, change providers, or do you need help with something else?"

## Step 1 — What are you selling?

Ask the owner in natural conversation (not a numbered list):

> "What are you selling? For example — a physical product like clothing or art, a digital download like templates or presets, a service like consulting, or software?"

Listen for these categories:
- **Physical goods** — clothing, art, food, handmade items, merchandise
- **Digital downloads** — files, templates, presets, ebooks, courses, memberships
- **Service or single offering** — consulting, design packages, bookings, donations
- **Software, plugin, or subscription** — SaaS, apps, license-based products

If unclear, ask a follow-up. Don't force them into a category — let their words guide you.

## Step 2 — How many products?

Ask:

> "How many products or offerings do you have — just one or a handful, or more like a full catalog?"

- **Few** — 1 to roughly 10 items
- **Catalog** — 10+ items, likely growing

Skip this step if the answer is obviously "one" from Step 1 (e.g., "I want to sell my ebook").

## Step 3 — Dashboard needed? (conditional)

Ask **only if** the owner is selling physical goods with a full catalog:

> "Do you need a dashboard to manage orders, inventory, and shipping? Or would you prefer to keep things simple?"

Skip for all other paths — digital goods, services, and software don't need this question.

## Routing

Based on the answers, route to the correct solution:

| What | How many | Dashboard | Solution | Status |
|---|---|---|---|---|
| Service / single offering | Few | — | **Stripe Payment Links** | Ready |
| Digital downloads | Any | — | **Polar** | Ready |
| Physical goods | Few | No | **Snipcart** | Ready |
| Physical goods | Catalog | Yes | **Shopify Buy Button** | Ready |
| Software / SaaS | Any | — | **Paddle** | Coming soon (#119) |

### Ready paths — hand off to buy-button skill

For **Stripe** and **Polar** routes, save the provider to `.site-config` and invoke the buy-button skill:

- **Service / single offering**: Write `ECOMMERCE_PROVIDER=stripe` to `.site-config`, then follow the buy-button skill's **Path A** (Stripe Payment Links). Read `${CLAUDE_PLUGIN_ROOT}/skills/buy-button/SKILL.md` and execute Path A.

- **Digital downloads**: Write `ECOMMERCE_PROVIDER=polar` to `.site-config`, then follow the buy-button skill's **Path B** (Polar checkout overlay). Read `${CLAUDE_PLUGIN_ROOT}/skills/buy-button/SKILL.md` and execute Path B.

### Snipcart path — hand off to snipcart skill

For **Snipcart** route (physical goods, few products, no dashboard), save the provider and invoke the snipcart skill:

Write `ECOMMERCE_PROVIDER=snipcart` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/snipcart/SKILL.md` and execute it.

### Shopify Buy Button path — hand off to shopify-buy-button skill

For **Shopify Buy Button** route (physical goods, full catalog, dashboard), save the provider and invoke the shopify-buy-button skill:

Write `ECOMMERCE_PROVIDER=shopify` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/shopify-buy-button/SKILL.md` and execute it.

### Coming soon paths — explain and offer Stripe fallback

For **Paddle** route, the integration isn't available yet. Respond warmly and offer a workaround:

**Paddle (software/SaaS):**

> "For software licensing and subscriptions, you'll want Paddle — it handles license keys, subscription billing, and international tax as a Merchant of Record. That integration is coming soon to Anglesite.
>
> In the meantime, I can set up a Stripe Payment Link for one-time purchases, or if you're selling downloadable software, Polar handles file delivery and license keys today. Which sounds better?"

If they choose Stripe, write `ECOMMERCE_PROVIDER=stripe` to `.site-config` and follow buy-button Path A.
If they choose Polar, write `ECOMMERCE_PROVIDER=polar` to `.site-config` and follow buy-button Path B.

## Config persistence

After routing, ensure `.site-config` has:

```
ECOMMERCE_PROVIDER=stripe|polar|snipcart|shopify|paddle
```

Write the value that matches the solution the owner chose (or accepted as a fallback). This lets other skills know ecommerce is configured and which provider is in use.
