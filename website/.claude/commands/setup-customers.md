Help the site owner set up customer or client management.

Read `.site-config` for `BUSINESS_TYPE` and `SITE_NAME` before starting.

## How to communicate

Before every step that requires the owner to do something, explain what they're doing and why in plain English.

## Step 1 — Recommend industry-specific tools

Based on `BUSINESS_TYPE`, recommend purpose-built tools first. These are almost always better than a generic database — they're designed for the business, handle payments, and require less maintenance.

### Restaurant / food business
- **Square** (free POS, online ordering, marketing) — square.com
- **Toast** (restaurant-specific POS) — toasttab.com
- **OpenTable** (reservations) — restaurant.opentable.com

Typical setup: Square for payments + online ordering. OpenTable if reservations matter. Cost: Square is free (2.6% per transaction). Toast starts at $0/month.

### Retail shop
- **Square** (free POS, inventory, online store) — square.com
- **Shopify** (online store + POS) — shopify.com ($39/month)
- **Etsy** (marketplace, good for handmade/vintage) — etsy.com

Typical setup: Square if mostly in-person. Shopify if online sales matter. Cost: Square is free; Shopify starts at $39/mo.

### Legal / professional services
- **Clio** (practice management, billing, client portal) — clio.com
- **MyCase** (case management + payments) — mycase.com
- **LawPay** (legal payment processing) — lawpay.com

Typical setup: Clio Manage + Clio Grow. Cost: starts ~$49/user/mo.

### Farm / CSA
- **Local Line** (online farm store, CSA management) — localline.ca
- **Harvie** (CSA share customization) — harvie.farm
- **Farmigo** (CSA + farmers market management) — farmigo.com

Typical setup: Local Line for online sales and CSA subscriptions. Cost: starts ~$75/mo. Airtable is a good free/cheap fallback for small operations (<30 members).

### Artist / maker / craftsperson
- **Etsy** (marketplace) — etsy.com
- **Big Cartel** (simple online store) — bigcartel.com (free for 5 products)
- **Ko-fi** (commissions, memberships) — ko-fi.com

Typical setup: Etsy for discovery + own website for brand. Cost: Etsy listing fee $0.20 + 6.5% transaction fee.

### Service business (consulting, coaching, trades)
- **HoneyBook** (proposals, contracts, invoicing) — honeybook.com
- **Dubsado** (CRM, workflows, scheduling) — dubsado.com
- **Calendly** (scheduling) — calendly.com (free tier available)

Typical setup: HoneyBook or Dubsado for client management. Calendly for scheduling. Cost: ~$19–35/mo.

### Generic / other
- **Google Workspace** (email, contacts, docs) — workspace.google.com
- **Airtable** (flexible database) — airtable.com (free tier)
- **Notion** (docs + light database) — notion.so (free tier)

Present the recommendations for their business type. Explain the tradeoffs: cost per month, ease of use, what it handles that a spreadsheet doesn't. Ask: "Would any of these work for you, or would you rather we set up something simple ourselves?"

## Step 2 — If they choose an external tool

Help them sign up and note it in `.site-config`:

```sh
echo "CUSTOMER_TOOL=square" >> .site-config
```

Add relevant links to their website (e.g., online ordering page links to Square, booking page links to Calendly).

Update `docs/customers.md` noting which tool they chose and how it integrates with the website.

Done. No Airtable needed.

## Step 3 — If they want Airtable (fallback)

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

**Restaurant adds:**
- **Events:** Name, Date, Type, Guest Count, Notes
- **Catering:** Client (linked), Date, Menu, Guest Count, Status

### Save config

```sh
echo "AIRTABLE_BASE_URL=https://airtable.com/BASE_ID" >> .site-config
```

```sh
echo "CUSTOMER_TOOL=airtable" >> .site-config
```

```sh
git add .site-config
```

```sh
git commit -m "Add customer management config"
```

### Walk through the base

Show the owner their tables and how to add/edit records.

## Keep docs in sync

Update `docs/customers.md` with the chosen tool, any table schemas, and integration details.
