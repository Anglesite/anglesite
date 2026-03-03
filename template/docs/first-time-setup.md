# First-Time Setup

**Prerequisite:** An AI coding tool — [Claude Desktop](https://claude.ai/download) (recommended), Codex, Gemini CLI, Cursor, Windsurf, or GitHub Copilot.

The user opens the project folder in their AI coding tool and runs the `anglesite:start` command.

## Three phases

### Phase 1: `anglesite:start` — Business discovery + design + tools (~30 minutes)
Meet the owner. Learn the business name, type, and owner name. Run a design interview (guided by `docs/design-system.md`) to choose colors, typography, and page structure. Install tools (fnm, Node, mkcert, HTTPS certs, hostname resolution, port forwarding), dependencies, and iCloud symlinks. Preview the branded site at `https://DEV_HOSTNAME`.

### Phase 2: `anglesite:deploy` — Go live (~15 minutes)
Cloudflare account creation, build, security scan, deploy. Domain purchase, transfer, or DNS configuration.

### Phase 3: `anglesite:setup-customers` — Customer management (optional, ~10 minutes)
Asks what the owner already uses, then recommends tools using the SaaS criteria (tool reduction, open source, affordable, values-aligned, ease of use). Can happen anytime.

## Detection

The webmaster can detect state by checking:
- No `.site-config` or no `SITE_NAME` in it → need `anglesite:start`
- No `docs/brand.md` → need `anglesite:start` (or `anglesite:design-interview` if `.site-config` exists)
- No `CF_PROJECT_NAME` in `.site-config` → offer `anglesite:deploy`
- No `CUSTOMER_TOOL` in `.site-config` → offer `anglesite:setup-customers`
