# Customer Management

## Approach

This scaffold recommends industry-specific tools over generic databases. The `/setup-customers` command guides the site owner through choosing the right tool for their business type.

Purpose-built tools (Square, Shopify, Clio, etc.) handle payments, inventory, scheduling, and other domain-specific needs out of the box. They cost more per month but require far less maintenance than a custom database.

Airtable is the fallback for businesses that don't fit a specific category, want to stay on a free tier, or prefer full control over their data structure.

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
