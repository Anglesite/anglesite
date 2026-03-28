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

If `ECOMMERCE_PROVIDER` is already set in `.site-config`, check for upgrade opportunities before proceeding:

1. If the provider is `snipcart`, count `.mdoc` files in `src/content/products/`. If there are 10 or more, tell the owner:

   > "You have [N] products in your store now. Shopify gives you a dashboard to manage orders, track inventory, and handle shipping — which makes a real difference at this catalog size. Want me to help you migrate to Shopify, or would you prefer to keep using Snipcart?"

   If they want to migrate, write `ECOMMERCE_PROVIDER=shopify` to `.site-config` and hand off to `${CLAUDE_PLUGIN_ROOT}/skills/shopify-buy-button/SKILL.md`.

2. If the provider is `stripe`, count product-related content files. If there are 3 or more, tell the owner:

   > "With [N] products, your customers might want a shopping cart so they can buy multiple items at once. I can set that up with Snipcart — no monthly fee, just 2% per sale. Interested?"

   If they want a cart, route to Snipcart or Shopify based on the standard routing table below.

3. Otherwise, ask: "You already have [provider] set up. Do you want to add another product, change providers, or do you need help with something else?"

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
| Digital downloads | Any | — | **Polar** or **Lemon Squeezy** | Ready |
| Physical goods | Few | No | **Snipcart** | Ready |
| Physical goods | Catalog | Yes | **Shopify Buy Button** | Ready |
| Software / SaaS | Any | — | **Paddle** | Ready |

### Ready paths — hand off to buy-button skill

For **Stripe** and **Polar** routes, save the provider to `.site-config` and invoke the buy-button skill:

- **Service / single offering**: Write `ECOMMERCE_PROVIDER=stripe` to `.site-config`, then follow the buy-button skill's **Path A** (Stripe Payment Links). Read `${CLAUDE_PLUGIN_ROOT}/skills/buy-button/SKILL.md` and execute Path A.

- **Digital downloads**: Ask the owner which platform they prefer:

  > "For digital products, I recommend either **Polar** or **Lemon Squeezy** — both handle payment processing, file delivery, and international sales tax automatically. Polar charges 4% + processing fees. Lemon Squeezy charges 5% + 50¢ per transaction. Do you have a preference, or should I go with Polar?"

  - If the owner chooses **Polar** (or has no preference): Write `ECOMMERCE_PROVIDER=polar` to `.site-config`, then follow the buy-button skill's **Path B** (Polar checkout overlay). Read `${CLAUDE_PLUGIN_ROOT}/skills/buy-button/SKILL.md` and execute Path B.
  - If the owner chooses **Lemon Squeezy**: Write `ECOMMERCE_PROVIDER=lemonsqueezy` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/lemon-squeezy/SKILL.md` and execute it.

### Snipcart path — hand off to snipcart skill

For **Snipcart** route (physical goods, few products, no dashboard), save the provider and invoke the snipcart skill:

Write `ECOMMERCE_PROVIDER=snipcart` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/snipcart/SKILL.md` and execute it.

### Shopify Buy Button path — hand off to shopify-buy-button skill

For **Shopify Buy Button** route (physical goods, full catalog, dashboard), save the provider and invoke the shopify-buy-button skill:

Write `ECOMMERCE_PROVIDER=shopify` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/shopify-buy-button/SKILL.md` and execute it.

### Paddle path — hand off to paddle skill

For **Paddle** route (software, plugins, SaaS, subscriptions), save the provider and invoke the paddle skill:

Write `ECOMMERCE_PROVIDER=paddle` to `.site-config`, then read `${CLAUDE_PLUGIN_ROOT}/skills/paddle/SKILL.md` and execute it.

## Webhook setup — revenue tracking

After the ecommerce sub-skill completes, set up the webhook worker so the site can track revenue for upgrade path assessment. This uses the worker at `worker/ecommerce-webhook-worker.js`.

1. **Deploy the webhook worker** (if not already deployed):

   ```sh
   npx wrangler deploy --config worker/wrangler-ecommerce.toml
   ```

2. **Set the webhook secret** for the chosen provider. Only set the secret for the provider in use:

   | Provider | Secret command |
   |---|---|
   | Snipcart | `npx wrangler secret put SNIPCART_SECRET_KEY --config worker/wrangler-ecommerce.toml` |
   | Stripe | `npx wrangler secret put STRIPE_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml` |
   | Shopify | `npx wrangler secret put SHOPIFY_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml` |
   | Polar | `npx wrangler secret put POLAR_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml` |
   | Lemon Squeezy | `npx wrangler secret put LS_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml` |
   | Paddle | `npx wrangler secret put PADDLE_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml` |

3. **Register the webhook URL** with the provider. The URL is `https://ecommerce-webhooks.<CF_ACCOUNT_SUBDOMAIN>.workers.dev/webhook/<provider>`. Guide the owner to their platform's webhook settings:

   | Provider | Where to register |
   |---|---|
   | Snipcart | https://app.snipcart.com/dashboard/webhooks |
   | Stripe | https://dashboard.stripe.com/webhooks |
   | Shopify | Shopify admin → Settings → Notifications → Webhooks |
   | Polar | https://polar.sh/settings/webhooks |
   | Lemon Squeezy | https://app.lemonsqueezy.com/settings/webhooks |
   | Paddle | https://vendors.paddle.com/notifications |

4. **Save the webhook URL** to `.site-config`:

   ```
   ECOMMERCE_WEBHOOK_URL=https://ecommerce-webhooks.<subdomain>.workers.dev
   ```

Tell the owner: "I've set up revenue tracking for your store. This lets me give you accurate cost comparisons if your business grows and a different platform would save you money."

## Config persistence

After routing, ensure `.site-config` has:

```
ECOMMERCE_PROVIDER=stripe|polar|lemonsqueezy|snipcart|shopify|paddle
```

Write the value that matches the solution the owner chose (or accepted as a fallback). This lets other skills know ecommerce is configured and which provider is in use.
