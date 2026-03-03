---
name: Setup Customers
description: "Set up customer or client management"
user-invocable: true
---

Help the site owner set up customer or client management

Read `.site-config` for `BUSINESS_TYPE` and `SITE_NAME` before starting.

## How to communicate

Before every step that requires the owner to do something, explain what they're doing and why in plain English.

## Step 1 — Ask what they already use

Before recommending anything, ask: "What do you currently use to keep track of customers or clients? That could be a spreadsheet, an app, a notebook — anything."

If they already have a tool that's working, don't replace it. Help them integrate it with the website (link to their booking page, online store, etc.) and skip to Step 3.

If they don't have anything or want to switch, continue to Step 2.

## Step 2 — Recommend tools using the SaaS criteria

Present options honestly with tradeoffs. Apply the SaaS criteria from the philosophy: tool reduction (use what they have), open source, free/affordable, values-aligned organizations (co-ops, B-Corps, nonprofits), ease of use.

Ask about their budget and comfort level before listing options.

### Open-source and values-aligned options (all business types)

- **Monica CRM** (open source, self-hostable, free) — Personal relationship manager. Good for service businesses and small client lists. monicahq.com
- **CiviCRM** (open source, nonprofit-backed) — Full CRM for contacts, memberships, events. More complex but very capable. civicrm.org
- **Airtable** (free tier, proprietary) — Flexible database. Good fallback when nothing else fits. Not open source but generous free tier. airtable.com

### Industry-specific options

Based on `BUSINESS_TYPE`, mention relevant tools. Be transparent about tradeoffs — note cost, whether it's open source or proprietary, whether it adds a new vendor, and how easy it is to get started:

**Restaurant / food business**
- **Square** (free POS, 2.6% per transaction, proprietary) — Payments, online ordering, marketing. Free tier is generous and easy to use.
- For reservations: consider whether the owner actually needs reservation software, or if a phone number and email work fine.

**Retail shop**
- **Square** (free POS, proprietary) — Good for in-person and simple online sales.
- **WooCommerce** (open source, self-hosted) — Full online store. More setup but no monthly fees.
- **Shopify** ($39/mo, proprietary) — Polished but expensive. Only if WooCommerce is too complex and they need a full e-commerce platform.

**Legal / professional services**
- **Monica CRM** (open source, free) — Client relationship tracking.
- **Clio** (~$49/user/mo, proprietary, certified B-Corp) — Practice management with billing. Expensive but purpose-built. B-Corp status is a plus.

**Farm / CSA**
- **Open Food Network** (open source, nonprofit) — Built for farms, food hubs, and CSAs. Community-run. openfoodnetwork.org
- **Local Line** (~$75/mo, proprietary) — Farm-specific online store and CSA management.
- Airtable is a good free fallback for small operations (<30 members).

**Artist / maker / craftsperson**
- **Big Cartel** (free for 5 products, proprietary) — Simple online store for makers.
- **Ko-fi** (free, no fees on donations) — Commissions, memberships, shop. Indie-friendly.
- **Etsy** (listing fee + 6.5% transaction fee) — Marketplace for discovery. Use alongside own website, not instead of it.

**Content creator / influencer**
- **Ko-fi** (free, no fees on donations) — Tips, memberships, commissions, and shop. Indie-friendly and creator-focused.
- **Patreon** (5–12% of income, proprietary) — Membership and subscription content. Well-known but takes a significant cut.
- **Cal.com** (open source, free tier) — For booking brand collaboration calls, podcast appearances, etc.
- The website itself is the most important tool — it's the media kit, portfolio, and owned hub that outlasts any platform.

**Service business (consulting, coaching, trades)**
- **Monica CRM** (open source, free) — Client relationship tracking.
- **Cal.com** (open source, free tier) — Scheduling. Self-hostable alternative to Calendly.
- **HoneyBook** (~$19/mo) or **Dubsado** (~$20/mo) — Full client management with contracts and invoicing. Proprietary but polished.

**Generic / other**
- Check `docs/smb/` for industry-specific tool recommendations (healthcare, real estate, nonprofit, fitness, salon, trades, photography, pet services, hospitality, education).
- **Monica CRM** (open source, free) — Contacts and relationship tracking.
- **Airtable** (free tier, proprietary) — Flexible database for anything.
- **Cal.com** (open source, free tier) — If they need scheduling.

Ask: "Would any of these work for you, or would you rather we set up something simple ourselves?"

## Step 3 — If they choose an external tool

Help them sign up and add `CUSTOMER_TOOL=square` to `.site-config` using the **Write tool** (update the existing file — don't use shell echo commands).

Add relevant links to their website (e.g., online ordering page links to Square, booking page links to Calendly).

Done. No Airtable needed.

## Step 4 — If they want Airtable (fallback)

Only proceed here if:
- They explicitly want Airtable, OR
- No good industry tool exists for their use case, OR
- Cost is a barrier and they need the free tier

### Create Airtable account

Ask: "Do you already have an Airtable account, or should we create one?"

```sh
open https://airtable.com/signup
```

### Connect Airtable MCP

Walk through creating a personal access token:

```sh
open https://airtable.com/create/tokens
```

Walk through:
- Click "Create new token"
- Name it after their business
- Add scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`
- Under Access, add "All current and future bases"
- Click "Create token" and copy it

Tell the owner: "Now I need to save this token so I can talk to Airtable. You'll see a prompt to allow this."

```sh
claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server
```

Replace TOKEN with the actual token. This stores the token in `~/.claude.json` (user-local, not in git). The token is a secret — never display it, log it, or commit it.

### Create a base tailored to the business type

Using the Airtable MCP, create a base named after `SITE_NAME`. Choose tables based on `BUSINESS_TYPE`:

**All types get:**
- **Contacts:** Name, Email, Phone, Status (Active/Inactive/Lead), Type (Customer/Vendor/Partner), Notes, Created Date
- **Notes/Log:** Date, Contact (linked), Subject, Details

**Farm/CSA adds:**
- **Products:** Name, Category, Season, Status, Notes
- **Subscriptions:** Contact (linked), Plan, Start Date, Status
- **Deliveries:** Date, Items, Notes

**Service business adds:**
- **Projects:** Name, Client (linked), Status, Start Date, End Date, Value, Notes
- **Invoices:** Client (linked), Amount, Date, Status, Notes

**Retail/maker adds:**
- **Products:** Name, Category, Price, Inventory, Status
- **Orders:** Customer (linked), Date, Items, Total, Status

**Creator/influencer adds:**
- **Collaborations:** Brand (linked to Contacts), Platform, Deliverables, Rate, Status (Pitched/Confirmed/Completed/Paid), Date, Notes
- **Content:** Title, Platform, Date Published, URL, Sponsored (checkbox), Brand (linked)

**Restaurant adds:**
- **Events:** Name, Date, Type, Guest Count, Notes
- **Catering:** Client (linked), Date, Menu, Guest Count, Status

For other business types, check the data tracking section in `docs/smb/` for the relevant type.

### Save config

Add `AIRTABLE_BASE_URL=https://airtable.com/BASE_ID` and `CUSTOMER_TOOL=airtable` to `.site-config` using the **Write tool** (update the existing file).

Then commit:

```sh
git add .site-config
```

```sh
git commit -m "Add customer management config"
```

### Walk through the base

Show the owner their tables and how to add/edit records.
