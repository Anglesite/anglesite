# First-Time Setup

The user opens the `website/` folder in Claude Desktop's Code tab and types `/start`.

## Three phases

### Phase 1: `/start` — Business discovery + design + tools (~30 minutes)
Meet the owner. Learn the business name, type, and owner name. Run a design interview to choose colors, typography, and page structure. Install tools (fnm, Node, Git), dependencies, and iCloud symlinks. Preview the branded site.

### Phase 2: `/deploy` — Go live (~15 minutes)
Cloudflare account creation, build, security scan, deploy. Domain purchase, transfer, or DNS configuration.

### Phase 3: `/setup-customers` — Customer management (optional, ~10 minutes)
Asks what the owner already uses, then recommends tools using the SaaS criteria (tool reduction, open source, affordable, values-aligned, ease of use). Can happen anytime.

## Detection

The webmaster can detect state by checking:
- No `.site-config` or no `SITE_NAME` in it → need `/start`
- No `docs/brand.md` → need `/start` (or `/design-interview` if `.site-config` exists)
- No `CF_PROJECT_NAME` in `.site-config` → offer `/deploy`
- No `CUSTOMER_TOOL` in `.site-config` → offer `/setup-customers`
