# First-Time Setup

The user opens the `website/` folder in Claude Desktop's Code tab and types `/setup`.

## Three phases

### Phase 1: `/setup` — Business discovery + technical bootstrap (~15 minutes)
Business name, type, and owner name. Then tools (fnm, Node, Git), dependencies, scaffold personalization, local preview.

### Phase 2: `/design-interview` — Visual identity (~15–20 minutes)
Conversational intake tailored to the business type. Results saved to `docs/brand.md`. CSS updated. Pages created based on business needs. Can happen same day or later.

### Phase 3: `/setup-customers` — Customer management (optional, ~10 minutes)
Asks what the owner already uses, then recommends tools using the SaaS criteria (tool reduction, open source, affordable, values-aligned, ease of use). Can happen anytime.

## Detection

The webmaster can detect state by checking:
- No `.site-config` or no `SITE_NAME` in it → need `/setup`
- No `docs/brand.md` → need `/design-interview`
- No `CUSTOMER_TOOL` in `.site-config` → offer `/setup-customers`
