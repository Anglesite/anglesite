# Giscus — comments on GitHub Discussions

[Giscus](https://giscus.app) is a comments system that stores threads as GitHub Discussions on a repository the owner controls. It's open source, free, ad-free, and adds no third-party trackers to the site beyond the loader script and the widget iframe.

## When to recommend it

- The owner already uses GitHub for site backup (`/anglesite:backup`) — same account, no new service to learn
- The owner wants comments on their blog and is comfortable with visitors needing a GitHub account
- The audience skews technical (developer blogs, IndieWeb, open-source projects) — most readers already have GitHub accounts
- The owner explicitly wants to avoid Disqus, Facebook Comments, ad-supported, or tracker-heavy systems

## When **not** to recommend it

- Audience is non-technical (most small business customers don't have GitHub accounts)
- Comments need to be private or invite-only (Discussions are public if the repo is public)
- Owner needs anonymous commenting (GitHub identity is required)
- Owner expects a moderation queue with approve-before-publish (Discussions don't have one — moderation is reactive: hide/delete/lock)

For non-technical audiences, suggest skipping comments entirely and routing engagement to a contact form (`/anglesite:contact`), email newsletter (`/anglesite:newsletter`), or social media reply links.

## How it works

1. Visitor opens a blog post
2. The Giscus loader script (`giscus.app/client.js`) injects an `<iframe>` from `giscus.app`
3. The iframe queries GitHub's GraphQL API to find a Discussion that matches the post (by `pathname`, `url`, `title`, or `og:title`)
4. If no match exists, the first commenter creates the Discussion automatically
5. The iframe handles login, posting, and rendering — the parent site never sees the visitor's GitHub credentials

The owner moderates by managing Discussions on github.com (or via the GitHub API/CLI). Hidden, deleted, or locked Discussions stop showing comments on the site.

## Repo requirements

- **Must be public** — Giscus reads Discussions via the GitHub API, which requires repo visibility
- **Discussions enabled** — Settings → Features → Discussions
- **Giscus app installed** — `https://github.com/apps/giscus`, scoped to the comments repo only
- **Comments category** — preferably an "Announcement" category so only maintainers can start threads (visitors reply, they don't open new ones)

If the owner's site repo is private, create a separate public repo just for comments (e.g., `myname/site-comments`).

## Cost

Free. No usage limits beyond GitHub's rate limits and Discussion size limits.

## Privacy

- No cookies set on the parent site
- No tracking pixels, analytics beacons, or fingerprinting
- The Giscus iframe loads from `giscus.app`; GitHub identity flow happens inside the iframe
- Privacy policy must mention Giscus and GitHub as data processors (visitors authenticate with GitHub when commenting)

## Configuration knobs

| Knob | Values | Notes |
|---|---|---|
| `mapping` | `pathname`, `url`, `title`, `og:title`, `specific`, `number` | `pathname` is the most stable — survives title and domain changes |
| `theme` | `preferred_color_scheme`, `light`, `dark`, `dark_dimmed`, `noborder_light`, `noborder_dark`, `transparent_dark`, custom URL | `preferred_color_scheme` follows OS setting |
| `reactionsEnabled` | `0`, `1` | Show 👍 ❤️ 🎉 reactions on the parent post |
| `inputPosition` | `top`, `bottom` | Where the comment box appears relative to the thread |
| `lang` | BCP-47 codes | UI language for the widget itself, not comment content |
| `loading` | `lazy`, `eager` | Anglesite uses `lazy` to avoid loading the iframe above the fold |

## Reactions-only mode

To accept reactions but no comment thread, set `data-term="specific"` and don't auto-create a Discussion. In Anglesite this is exposed as the `GISCUS_REACTIONS_ONLY=true` config flag, which renders the widget without the comment input. Useful for high-traffic sites where moderation overhead would be heavy.

## CSP impact

Giscus needs:

- `script-src giscus.app` — for the loader
- `frame-src giscus.app` — for the iframe

Both are added automatically by `template/scripts/csp.ts` when `COMMENTS_PROVIDER=giscus` is in `.site-config`. The pre-deploy third-party script scan (which blocks unauthorized external JS by default) reads the same config and allowlists `giscus.app`.

## Setup walkthrough

The `/anglesite:giscus` skill is the canonical setup wizard — it handles repo selection, ID retrieval, theme picking, and CSP wiring. Don't ask the owner to follow these steps manually unless the skill is unavailable.

## Migrating off Giscus

Comments are GitHub Discussions, owned by the owner. Export options:

- **GitHub API** — fetch all discussions in a category as JSON
- **`gh` CLI** — `gh api repos/owner/repo/discussions` returns paginated JSON
- **Migration to another provider** — most comment systems (Disqus, Discourse, Cactus, isso) accept JSON imports; the owner can map Discussion → comment thread by URL

The site itself can be reverted by removing `COMMENTS_PROVIDER` from `.site-config` and rebuilding — no orphaned code remains because the blog post template only renders the widget when the config key is present.

## Alternatives considered

| Alternative | Why not the default |
|---|---|
| **Disqus** | Loads heavy tracker scripts, shows ads on free tier, owns the comment data |
| **Cactus Comments** | Matrix-based, requires visitors to have a Matrix account (rarer than GitHub) |
| **Commento / Remark42** | Self-hosted — more ops than the owner should take on |
| **utterances** | Same idea as Giscus but stores in GitHub Issues, not Discussions. Discussions is the newer, recommended pattern |
| **Facebook Comments** | Tracker-heavy, requires a Facebook account, antithetical to ADR-0008 |
| **No comments** | Default for most small business sites — engagement happens via contact form or email |
