Set up the Airtable base for CSA membership and farm operations. Read `docs/airtable.md` for full schema details.

Before every step that requires Julia to do something, explain what she's doing and why in plain English.

## Step 1 — Create Airtable account

Ask Julia: "Do you already have an Airtable account, or should we create one?"

If she needs one:

```sh
open https://airtable.com/signup
```

Walk her through sign-up. Wait for her to confirm she's in.

## Step 2 — Connect Airtable MCP

Walk Julia through creating a personal access token:

1. Tell her you're opening the token creation page:

```sh
open https://airtable.com/create/tokens
```

2. Walk her through:
   - Click "Create new token"
   - Name it "Pairadocs Farm"
   - Add scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`
   - Under Access, add "All current and future bases"
   - Click "Create token" and copy it

3. Tell Julia: "Now I need to save this token so I can talk to Airtable. You'll see a prompt to allow this."

```sh
claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server
```

Replace TOKEN with the actual token. This stores the token in `~/.claude.json` (user-local, not in git). The token is a secret — never display it, log it, or commit it.

## Step 3 — Create the CSA base

Using the Airtable MCP, create a base called "Pairadocs Farm CSA" with these tables:

**Members:** Name, Email, Phone, Address, Share Type (Single select: Full/Half/Egg/Flower/Furniture), Status (Single select: Active/Paused/Waitlist/Former), Start Date, Notes, Venmo Username, Egg Dozens Prepaid (Number), Egg Dozens Delivered (Number), Preferences (linked to Member Preferences)

**Items:** Name, Category (Single select: Vegetable/Fruit/Herb/Egg/Flower/Furniture/Preserved), Season (Multi-select: Spring/Summer/Fall/Winter), Year (Number), Status (Single select: Planned/Growing/Harvesting/Done), Planting Date, Expected Harvest, Bed/Location, Notes

**Member Preferences:** Member (linked to Members), Favorites, Allergies (SAFETY-CRITICAL), Dislikes, Household Size, Dietary Notes, Last Updated

**Weekly Delivery:** Date, Season, Items (Long text — what's in the share), Excess Items (Long text — available for requests), Recipe (Long text), Notes

**Egg Log:** Member (linked to Members), Date, Dozens Offered (Number), Dozens Accepted (Number), Notes

**Payments:** Member (linked to Members), Amount (Currency), Date, Method (Single select: Venmo/Cash/Check), Season, Notes

**Events:** Name, Date, Time, Location, Description, RSVP Count

## Step 4 — Add formula fields

After creating the tables, add these computed fields:

**Members table:**
- Egg Balance (Rollup from Egg Log: SUM of Dozens Offered - SUM of Dozens Accepted, or simpler: Prepaid - Delivered)

**Payments table:**
- Venmo Link (Formula): generates a payment link using the member's Venmo username

## Step 5 — Create views

- **Members:** Active Members, Egg Subscribers (filter: Share Type contains Egg), Veggie Subscribers, Waitlist
- **Items:** Currently Growing, This Season, Planning
- **Weekly Delivery:** Current Week, Recent (last 4 weeks)
- **Egg Log:** By Member, This Month, Low Balance
- **Payments:** Current Season, Outstanding
- **Member Preferences:** Allergies (critical view for share packing)

## Step 6 — Create the preferences form

Create a Form view on the Member Preferences table with fields: Favorites, Allergies, Dislikes, Household Size, Dietary Notes. The Member field should be prefilled via URL parameter:
```
https://airtable.com/appXXX/pagXXX/form?prefill_Member=recXXX
```
Each member gets a unique URL (their record ID). This goes in their welcome email via `/draft-email`.

## Step 7 — Save config

Save the Airtable base URL and Julia's Venmo username to `.farm-config`:

```sh
grep -q '^AIRTABLE_BASE_URL=' .farm-config 2>/dev/null
```

If not present:
```sh
echo "AIRTABLE_BASE_URL=https://airtable.com/BASE_ID" >> .farm-config
```

Ask Julia for her Venmo username and save it:
```sh
echo "VENMO_USERNAME=USERNAME" >> .farm-config
```

```sh
git add .farm-config
```

```sh
git commit -m "Add Airtable and Venmo config"
```

## Step 8 — Walk Julia through it

Show Julia:
- The Members table and how to add people
- The Weekly Delivery table and how to update it each week
- The Egg Log and how to track egg deliveries
- The Preferences form and how members fill it out
- The Allergies view and why it matters for safety

## Step 9 — Populate

Ask Julia: "What are you growing this season?" Add her current crops to the Items table.

Ask: "Can you tell me about your current members?" Add them to the Members table.

## Step 10 — Test the full flow

1. Pick a member (or create a test one)
2. Generate a preference form URL for them
3. Fill it out together in the preview panel
4. Show the response in Airtable
5. Walk through packing a share: "Show me who's allergic to tomatoes" → check the Allergies view
6. Draft a test payment reminder with `/draft-email` — show the Venmo link
7. Clean up test data if needed

## Keep docs in sync

Update `docs/airtable.md` with the actual base ID, table IDs, and form URLs.
