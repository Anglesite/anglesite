# Customer Management

## Approach

The `/setup-customers` command first asks what the owner already uses. If an existing tool is working, we integrate it with the website rather than replacing it.

When recommending new tools, we apply the SaaS selection criteria:
1. **Tool reduction** — Use what they already have before adding vendors
2. **Open source** — Prefer open-source solutions (Monica CRM, CiviCRM, Cal.com, Open Food Network)
3. **Free or affordable** — Free tiers and low-cost plans over expensive subscriptions
4. **Values-aligned** — Co-ops, B-Corps, nonprofits preferred (e.g., Clio is a certified B-Corp)
5. **Ease of use** — A tool the owner will actually use beats a philosophically perfect one they won't

Airtable is the general-purpose fallback — not open source, but free tier is generous and it's flexible enough for any business type.

## Configuration

The chosen tool is stored in `.site-config`:
```
CUSTOMER_TOOL=square    # or: airtable, shopify, honeybook, etc.
AIRTABLE_BASE_URL=...   # only if Airtable was chosen
```

## If using Airtable

The Airtable MCP server is stored in the user's config (`~/.claude.json`), NOT in the project's `.mcp.json`. This keeps the API token out of git.

If the connection stops working:
1. Check `/mcp` in Claude Code
2. If missing, create a new token at https://airtable.com/create/tokens
3. Re-add with `claude mcp add --scope user --env AIRTABLE_API_KEY=TOKEN airtable -- npx -y airtable-mcp-server`

Table schemas depend on the business type. They're created during `/setup-customers` and documented here after setup.

## Privacy rules

- Customer data stays in the management tool, never on the website or in git
- API tokens are secrets — handled like passwords
- Bulk emails use BCC — never expose the customer list
- Form URLs with record IDs are safe to email (no PII in URL)
