# Airtable — CSA Membership

## MCP connection

The Airtable MCP server is stored in Julia's user config (`~/.claude.json`), NOT in the project's `.mcp.json`. This keeps her API token out of git.

The Airtable base URL is stored in `.farm-config` in the project root (committed to git — site config, not a secret). This is read by `scripts/farm.sh` so the "🗂️ Open Airtable" menu item opens the base directly.

If the connection stops working:
1. Check `/mcp` in Claude Code
2. If the Airtable server is missing, Julia needs to create a new token at https://airtable.com/create/tokens
3. Re-add with `claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server`

## Tables

### Members
Name, Email, Phone, Address, Share Type (Full/Half/Egg/Flower/Furniture), Status (Active/Paused/Waitlist/Former), Start Date, Notes, Payment Method, Preferences (linked)

### Items
Name, Category (Vegetable/Fruit/Herb/Egg/Flower/Furniture/Preserved), Season (multi-select), Year, Status (Planned/Growing/Harvesting/Done), Planting Date, Expected Harvest, Bed/Location, Notes

### Member Preferences
Member (linked), Favorites, **Allergies** (SAFETY-CRITICAL — check before packing any share), Dislikes, Household Size, Dietary Notes, Last Updated

### Shares
Date, Season, Contents, Notes

### Payments
Member (linked), Amount, Date, Method, Season, Notes

### Events
Name, Date, Time, Location, Description, RSVP Count

## Views

- **Members:** Active Members, Waitlist, Full Shares, Half Shares
- **Items:** Currently Growing, This Season, Planning
- **Payments:** Current Season
- **Member Preferences:** Allergies (critical for share packing)

## Preference form

Form view on Member Preferences table. Fields: Favorites, Allergies, Dislikes, Household Size, Dietary Notes. Member field prefilled via URL parameter:
```
https://airtable.com/appXXX/pagXXX/form?prefill_Member=recXXX
```
Each member gets a unique URL (their record ID). Included in welcome emails via `/draft-email`.

## Privacy rules

- Member data stays in Airtable, never on the website or in git
- Airtable API token is a secret — handled like a password
- Preference form URLs contain record IDs but no PII — safe to email
- Bulk emails use BCC — never expose the member list
