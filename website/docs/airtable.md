# Airtable — CSA Membership & Operations

## MCP connection

The Airtable MCP server is stored in Julia's user config (`~/.claude.json`), NOT in the project's `.mcp.json`. This keeps her API token out of git.

The Airtable base URL is stored in `.farm-config` in the project root (committed to git — site config, not a secret).

If the connection stops working:
1. Check `/mcp` in Claude Code
2. If the Airtable server is missing, Julia needs to create a new token at https://airtable.com/create/tokens
3. Re-add with `claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server`

## Tables

### Members
Name, Email, Phone, Address, Share Type (Full/Half/Egg/Flower/Furniture), Status (Active/Paused/Waitlist/Former), Start Date, Notes, Venmo Username, Egg Dozens Prepaid (number), Egg Dozens Delivered (number), Preferences (linked)

### Items
Name, Category (Vegetable/Fruit/Herb/Egg/Flower/Furniture/Preserved), Season (multi-select), Year, Status (Planned/Growing/Harvesting/Done), Planting Date, Expected Harvest, Bed/Location, Notes

### Member Preferences
Member (linked), Favorites, **Allergies** (SAFETY-CRITICAL — check before packing any share), Dislikes, Household Size, Dietary Notes, Last Updated

### Weekly Delivery
Date, Season, Items (text — what's in the share this week), Excess Items (text — available for requests), Recipe (text — recipe of the week), Notes

### Egg Log
Member (linked), Date, Dozens Offered, Dozens Accepted, Running Balance (formula: Prepaid - sum of Delivered), Notes

### Payments
Member (linked), Amount, Date, Method (Venmo/Cash/Check), Season, Venmo Link (formula), Notes

The Venmo Link formula field generates a payment request URL:
```
"https://venmo.com/" & {Venmo Username} & "?txn=pay&amount=" & {Amount} & "&note=Pairadocs+Farm+" & ENCODE_URL_COMPONENT({Season})
```

### Events
Name, Date, Time, Location, Description, RSVP Count

## Views

- **Members:** Active Members, Egg Subscribers, Veggie Subscribers, Waitlist
- **Items:** Currently Growing, This Season, Planning
- **Weekly Delivery:** Current Week, Recent (last 4 weeks)
- **Egg Log:** By Member, This Month, Low Balance (< 2 dozen remaining)
- **Payments:** Current Season, Outstanding (members with low egg balance)
- **Member Preferences:** Allergies (critical for share packing)

## Forms

### Preference form
Form view on Member Preferences table. Fields: Favorites, Allergies, Dislikes, Household Size, Dietary Notes. Member field prefilled via URL parameter:
```
https://airtable.com/appXXX/pagXXX/form?prefill_Member=recXXX
```
Each member gets a unique URL (their record ID). Included in welcome emails via `/draft-email`.

### Weekly order form (future)
If Julia wants members to confirm or adjust their weekly share, a form view on a new Orders table could allow per-member responses. Deferred for v1 — Julia manages manually for ~10 members.

## Venmo integration

No API needed. Venmo supports payment links with pre-filled amounts and notes:
```
https://venmo.com/USERNAME?txn=pay&amount=50&note=Pairadocs+Farm+CSA+June+2026
```

The Payments table generates these links automatically via a formula field. Julia can include Venmo links in payment reminder emails drafted with `/draft-email`.

Julia's Venmo username is stored in `.farm-config` (site config, not a secret):
```
VENMO_USERNAME=pairadocs-farm
```

## Privacy rules

- Member data stays in Airtable, never on the website or in git
- Airtable API token is a secret — handled like a password
- Preference form URLs contain record IDs but no PII — safe to email
- Venmo usernames are semi-public (visible in the app) but don't put them on the website
- Bulk emails use BCC — never expose the member list
