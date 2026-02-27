Set up the Airtable base for CSA membership management. Read `docs/airtable.md` for full schema details.

## Step 1 — Connect Airtable MCP

Walk Julia through creating a personal access token:

1. Open https://airtable.com/create/tokens
2. Click "Create new token"
3. Name it "Pairadocs Farm"
4. Add scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`
5. Under Access, add "All current and future bases"
6. Click "Create token" and copy it

Then run:
```sh
claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server
```

Replace TOKEN with the actual token. This stores the token in `~/.claude.json` (user-local, not in git). The token is a secret — never display it, log it, or commit it.

## Step 2 — Create the CSA base

Using the Airtable MCP, create a base called "Pairadocs Farm CSA" with these tables:

**Members:** Name, Email, Phone, Address, Share Type (Single select: Full/Half/Egg/Flower/Furniture), Status (Single select: Active/Paused/Waitlist/Former), Start Date, Notes, Payment Method, Preferences (linked to Member Preferences)

**Items:** Name, Category (Single select: Vegetable/Fruit/Herb/Egg/Flower/Furniture/Preserved), Season (Multi-select: Spring/Summer/Fall/Winter), Year (Number), Status (Single select: Planned/Growing/Harvesting/Done), Planting Date, Expected Harvest, Bed/Location, Notes

**Member Preferences:** Member (linked to Members), Favorites, Allergies (SAFETY-CRITICAL), Dislikes, Household Size, Dietary Notes, Last Updated

**Shares:** Date, Season, Contents, Notes

**Payments:** Member (linked to Members), Amount, Date, Method, Season, Notes

**Events:** Name, Date, Time, Location, Description, RSVP Count

## Step 3 — Save the Airtable URL to config

After creating the base, save the URL so the app menu can open it directly:

```sh
grep -q '^AIRTABLE_BASE_URL=' .farm-config 2>/dev/null \
  && sed -i '' "s|^AIRTABLE_BASE_URL=.*|AIRTABLE_BASE_URL=https://airtable.com/BASE_ID|" .farm-config \
  || echo "AIRTABLE_BASE_URL=https://airtable.com/BASE_ID" >> .farm-config
```

Replace `BASE_ID` with the actual base ID (starts with "app"). Once this line exists, the "🗂️ Open Airtable" menu item opens the base directly.

Commit: `git add .farm-config && git commit -m "Add Airtable base URL"`

## Step 4 — Create views

- **Members:** Active Members, Waitlist, Full Shares, Half Shares
- **Items:** Currently Growing, This Season, Planning
- **Payments:** Current Season
- **Member Preferences:** Allergies (critical view for share packing)

## Step 5 — Create the preferences form

Create a Form view on the Member Preferences table with fields: Favorites, Allergies, Dislikes, Household Size, Dietary Notes. The Member field should be prefilled via URL parameter:
```
https://airtable.com/appXXX/pagXXX/form?prefill_Member=recXXX
```
Each member gets a unique URL (their record ID). This goes in their welcome email via `/draft-email`.

## Step 6 — Confirm with Julia

Show Julia what was created:
- The Members table and how to add people
- The Items table for tracking what's growing
- The Preferences form and how members fill it out
- The Allergies view and why it matters for safety

## Step 7 — Populate items

Ask Julia: "What are you growing this season?" Add her current crops to the Items table.

## Step 8 — Test the full flow

1. Create a test member
2. Generate a preference form URL for them
3. Fill it out together
4. Show the response in Airtable
5. Walk through packing a share: "Show me who's allergic to tomatoes" → check the Allergies view
6. Verify the app works: click **Pairadocs Farm** → **🗂️ Open Airtable** — it should open the base
7. Delete test data (or keep as examples)

## Important: Keep docs in sync

Update `docs/airtable.md` with the actual base ID, table IDs, and form URLs.
