# Anglesite

An AI webmaster for independent websites — a [Claude plugin](https://docs.anthropic.com/en/docs/claude-code/plugins) that scaffolds, designs, and deploys Astro sites on Cloudflare Workers.

Anglesite works with [Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-cowork) (for non-technical site owners) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (for developers). Both use the same plugin — the experience adapts to the environment.

## Install

### Claude Cowork (recommended for site owners)

Plugins in Cowork require a paid plan (Pro, Max, Team, or Enterprise).

1. Open [Claude](https://claude.ai) and start a Cowork session
2. Open the **Code** tab
3. Press **+** > **Plugins** > **Add Plugin**
4. Select the **Personal** tab, press **+**
5. Select **Add Marketplace from GitHub**
6. Enter `Anglesite/anglesite` and press **Sync**
7. Enable the **anglesite** plugin
8. Create a new folder for your site and open it in the **Code** tab
9. Type `/anglesite:start`

No terminal, no installs, no prerequisites. Claude handles everything.

### Claude Code (for developers)

```sh
# Add the marketplace (one-time)
claude plugin marketplace add Anglesite/anglesite

# Install the plugin
claude plugin install anglesite

# Start a new project
mkdir my-site && cd my-site
claude
```

Then type `/anglesite:start` to begin.

---

The start command scaffolds your project, learns about your business, designs the site with you, and installs the tools to preview it. When you're ready to go live, `/anglesite:deploy` handles hosting, domains, and publishing.

## Skills

| Skill | What it does |
|---|---|
| `/anglesite:start` | First-time setup: discovery, design, tools, preview |
| `/anglesite:deploy` | Build, security scan, deploy, domain setup |
| `/anglesite:check` | Health audit (build, privacy, security, accessibility) |
| `/anglesite:update` | Update dependencies safely |
| `/anglesite:domain` | Manage DNS records (email, Bluesky verification, etc.) |
| `/anglesite:import` | Import content from a website URL |
| `/anglesite:convert` | Convert an SSG project (Hugo, Jekyll, etc.) to Anglesite |
| `/anglesite:export` | Portable export for self-hosting or migration |
| `/anglesite:contact` | Set up a contact form |
| `/anglesite:forms` | Custom forms (RSVP, lead capture, survey, callback) |
| `/anglesite:inbox` | Browse, triage, and export form submissions from Keystatic |
| `/anglesite:indieweb` | Self-owned IndieAuth, Webmention, and Micropub endpoints |
| `/anglesite:backup` | Save work to GitHub |
| `/anglesite:stats` | Plain-language site analytics |
| `/anglesite:newsletter` | Set up an email newsletter |
| `/anglesite:add-store` | Add ecommerce to your site |
| `/anglesite:booking` | Embed appointment scheduling |
| `/anglesite:seo` | SEO audit, metadata, Schema.org, sitemap |
| `/anglesite:search` | Add on-site search via Pagefind |
| `/anglesite:photography` | Site-specific photo shot list with tips |
| `/anglesite:menu` | Restaurant menu import, creation, and editing |
| `/anglesite:podcast` | Podcast episodes, RSS feed, transcripts, audio player |
| `/anglesite:donations` | Donation button or page (Stripe, Liberapay, GitHub Sponsors) |
| `/anglesite:redirects` | Manage Cloudflare redirects (add, remove, list, bulk-import) |
| `/anglesite:design-import` | Import design tokens from Canva or Figma |
| `/anglesite:giscus` | Blog comments via GitHub Discussions |
| `/anglesite:consent` | GDPR/CCPA cookie consent banner |
| `/anglesite:membership` | Paywall and content gating (free newsletter + paid Stripe) |
| `/anglesite:tracking` | Analytics pixels (Meta, Google, LinkedIn, etc.) via Partytown |
| `/anglesite:pwa` | Make the site installable as a Progressive Web App |
| `/anglesite:share` | Native sharing via Web Share API |

## Who this is for

Small businesses — farms, restaurants, legal firms, retailers, makers, artists, content creators, service providers — who want a fast, private, professional website without learning to code.

## Philosophy

- **The website is the center** — Publish here first, syndicate elsewhere (POSSE)
- **IndieWeb first** — Microformats, Webmention, IndieAuth. The owner controls their identity and content.
- **Accessible by design** — WCAG AA minimum. Not an afterthought.
- **No external runtime dependencies** — Zero third-party JavaScript in production
- **Privacy by default** — No tracking, no cookies, no third-party scripts (Cloudflare Web Analytics only)

## Stack

| Component | Technology |
|---|---|
| Site generator | [Astro 5](https://astro.build) |
| Content editor | [Keystatic](https://keystatic.com) |
| Hosting | [Cloudflare Workers](https://workers.cloudflare.com) (Static Assets) |
| Analytics | Cloudflare Web Analytics |
| Language | TypeScript (strict) |
| Styling | Vanilla CSS with custom properties |

## Plugin development

See [CLAUDE.md](CLAUDE.md) for plugin structure, editing guidelines, and testing instructions.

<!-- token-efficiency-start -->
## Token Efficiency

Estimated cost per `/anglesite:start` session (~30 turns):

| Model | Cached input | New input | Output | Est. cost |
|---|---|---|---|---|
| Opus | 727k | 420k | 25k | $9.54 |
| Sonnet | 727k | 420k | 25k | $1.91 |

<details>
<summary>Context budget breakdown</summary>

### Always-loaded context (every turn)

| File | Tokens |
|---|---|
| System prompt (est.) | 2,000 |
| CLAUDE.md | 5,217 |
| **Subtotal** | **7,217** |

### Skill + on-demand reads

| File | Tokens | Loaded after |
|---|---|---|
| start/SKILL.md | 6,860 | Skill invocation |
| smb/README.md | 2,606 | Step 1 |
| Avg SMB type (1 of 58 files) | 1,915 | Step 1 |
| design-interview/SKILL.md | 3,118 | Step 2 |
| design-system.md | 3,347 | Step 2 |
| **Subtotal** | **17,846** | |

### Session model

| Parameter | Value |
|---|---|
| Turns | 30 |
| Context per turn (after step 2) | 25,063 |
| New content per turn | ~850 |
| Total input (all API calls) | 1.1M |
| Total output | 25k |

</details>

*Generated by `bin/average-tokens.ts` — do not edit manually.*
<!-- token-efficiency-end -->

## License

Code is [ISC](LICENSE). Documentation is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
