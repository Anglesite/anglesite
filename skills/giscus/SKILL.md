---
name: giscus
description: "Add blog comments via Giscus (uses GitHub Discussions as the storage backend)"
allowed-tools: Bash(npm run build), Bash(npx astro check), Bash(grep *), Write, Read, Edit, Glob
disable-model-invocation: true
---

Add comment threads to blog posts using [Giscus](https://giscus.app), which stores comments as GitHub Discussions on a repository the owner controls. No third-party tracker, no ads, no monthly fee, no separate moderation dashboard — moderation happens in the GitHub UI.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Giscus is a sanctioned exception; the loader script and iframe are added to the CSP allowlist and pre-deploy scan via `template/scripts/csp.ts`. Only loaded on blog post pages.
- [ADR-0009 Industry tools first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — use GitHub Discussions for storage rather than running our own database.
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — comments live in the owner's GitHub repo. They can export, delete, or migrate them at any time.
- [ADR-0013 GitHub backup](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0013-github-backup.md) — the site is already backed up to GitHub, so adding Discussions reuses an account the owner has.

Read the platform reference: `${CLAUDE_PLUGIN_ROOT}/docs/platforms/giscus.md`

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config` for `COMMENTS_PROVIDER`. If it's already `giscus`, this is an update — tell the owner: "You already have Giscus comments set up. I can change the theme, switch to reactions-only mode, or move the comments to a different repo. What would you like to do?"

The site must have a blog (`src/content/posts/`). If there's no blog, tell the owner: "Comments are added to blog posts, but I don't see a blog set up yet. Want me to add one first? You can run `/anglesite:start` and ask for a blog, or I can add it now."

The owner needs a GitHub repository. Read `GITHUB_REPO` from `.site-config`. If it's missing, suggest running `/anglesite:backup` first so the site is already on GitHub — Giscus uses the same repo.

## Step 1 — Choose the comments repository

Ask the owner: "Where do you want comments to live? I recommend the same repo your site is already backed up to ({GITHUB_REPO}) — that way everything is in one place. You can also use a separate public repo if you want comments visible without exposing site source."

Two valid choices:

- **Same repo** — easy, but the repo must be public for Giscus to read Discussions (private repos won't work)
- **Separate public repo** — keep your site source private, host comments in a public companion repo (e.g., `myname/site-comments`)

Save the choice as `GISCUS_REPO` in `.site-config` (format: `owner/repo`).

If the chosen repo doesn't exist yet, walk the owner through creating it on github.com — public, no description needed, no template.

## Step 2 — Enable Discussions and install the Giscus app

Tell the owner exactly what to do, in order:

1. Open `https://github.com/{GISCUS_REPO}/settings`
2. Scroll to **Features** → check **Discussions**
3. Open `https://github.com/{GISCUS_REPO}/discussions/categories`
4. Create a new category called **Comments**, type **Announcement** (so only maintainers can start threads — comments-as-replies)
5. Install the Giscus GitHub App: `https://github.com/apps/giscus` → click **Install** → select the comments repo only

Pause here. Ask: "All set? Reply 'yes' once Discussions is on, the Comments category exists, and the Giscus app is installed."

## Step 3 — Get the repo and category IDs

Tell the owner: "I'll fetch the IDs Giscus needs. Open the Giscus configurator at `https://giscus.app` and fill in:"

1. **Repository**: `{GISCUS_REPO}` — the page should show a green check
2. **Page ↔ Discussions Mapping**: select **Discussion title contains page pathname** (this is the `pathname` mapping)
3. **Discussion Category**: select **Comments**
4. **Features**: leave defaults (or check **Enable reactions for the main post** if the owner wants reactions on posts themselves)
5. **Theme**: pick **Preferred color scheme** (recommended) or any specific theme

Scroll to the **Enable giscus** section. Inside the generated `<script>` tag, find:

- `data-repo-id="..."` — copy this value, save as `GISCUS_REPO_ID`
- `data-category-id="..."` — copy this value, save as `GISCUS_CATEGORY_ID`

Ask the owner to paste both IDs. They look like `R_kgDOxxxxxx` and `DIC_kwDOxxxxxx`.

## Step 4 — Pick the mapping and theme

### Mapping

Ask: "How should comments be tied to each post? `pathname` (default) is most stable — comments stay tied to the URL even if you change the post title. Alternatives are `url` (full URL — breaks if you change domains), `title` (post title — breaks if you rename) or `og:title` (Open Graph title)."

Default to `pathname`. Save as `GISCUS_MAPPING`.

### Theme

Ask: "Which theme matches your site?"

- **Preferred color scheme** (recommended) — follows the visitor's OS light/dark setting
- **Light** — always light
- **Dark** — always dark
- **Custom** — point at a CSS file in your repo (advanced)

Save as `GISCUS_THEME` using one of: `preferred_color_scheme`, `light`, `dark`, `dark_dimmed`, `noborder_light`, `noborder_dark`, `transparent_dark`, `light_protanopia`, `light_tritanopia`, `dark_protanopia`, `dark_tritanopia`, or a fully-qualified URL.

### Reactions-only mode

Ask: "Do you want full comment threads, or just reactions (👍 ❤️ 🎉)? Reactions are lighter-weight and require less moderation."

Save as `GISCUS_REACTIONS_ONLY=true|false`. If `true`, the comment box is hidden — visitors can only react.

## Step 5 — Save configuration

Append to `.site-config`:

```
COMMENTS_PROVIDER=giscus
GISCUS_REPO=owner/repo
GISCUS_REPO_ID=R_kgDOxxxxxx
GISCUS_CATEGORY=Comments
GISCUS_CATEGORY_ID=DIC_kwDOxxxxxx
GISCUS_MAPPING=pathname
GISCUS_THEME=preferred_color_scheme
GISCUS_REACTIONS_ONLY=false
```

The blog post template (`src/pages/blog/[slug].astro`) already reads these keys and renders the `Comments.astro` component when `COMMENTS_PROVIDER=giscus` is set and the post hasn't opted out via `comments: false` in its frontmatter. No code changes needed here unless the owner customized the blog layout.

## Step 6 — Update CSP and pre-deploy scan

The CSP builder (`template/scripts/csp.ts`) reads `COMMENTS_PROVIDER` from `.site-config` and automatically adds `giscus.app` to `script-src` and `frame-src`. The pre-deploy third-party script scan picks up the same allowlist.

Regenerate `public/_headers` from the updated config so the new CSP is in place. Use whichever helper the site uses to render headers (the deploy skill regenerates them on every build), or manually update `public/_headers` so its `Content-Security-Policy` line includes `giscus.app` in `script-src` and `frame-src`.

## Step 7 — Verify

```
npm run build
```

Check that:

1. The build succeeds
2. `dist/blog/<some-post>/index.html` contains a `<script src="https://giscus.app/client.js"` tag (only on blog posts that haven't opted out)
3. `dist/index.html` does **not** contain that script (Giscus loads only on blog posts, never the homepage or other pages)
4. `public/_headers` includes `giscus.app` in the `Content-Security-Policy`

If the build or any check fails, diagnose and fix before presenting to the owner.

Tell the owner: "Comments are live! Each blog post now has a comments section that posts to GitHub Discussions in `{GISCUS_REPO}`. Visitors sign in with GitHub to comment. You moderate by editing or deleting Discussions on GitHub. Want to preview a post?"

## Per-post control

Mention to the owner: "If you want to disable comments on a specific post — like an announcement you don't want discussion on — open it in Keystatic and uncheck **Allow Comments**. The default is on."

Editorially in Markdoc, this is `comments: false` in the post frontmatter.

## Re-running the command

If `/anglesite:giscus` is run again on a site that already has comments:

1. Read existing config from `.site-config`
2. Ask what the owner wants to change (theme, mapping, reactions-only, repository)
3. Update the relevant `GISCUS_*` keys
4. Regenerate `public/_headers` if the repo changed (no CSP change needed — the domain is the same)
5. Rebuild to verify

To remove comments entirely:

1. Delete `COMMENTS_PROVIDER` and the `GISCUS_*` keys from `.site-config`
2. Rebuild — the blog post template will skip the widget when `COMMENTS_PROVIDER` is unset
3. Regenerate `public/_headers` so `giscus.app` drops out of the CSP

## Privacy notes for the owner

When you add Giscus, mention these privacy considerations:

- Visitors must have a GitHub account to comment
- Their GitHub username and avatar are public on the comment thread
- GitHub's privacy policy applies — add Giscus / GitHub to your site's privacy policy as a data processor
- No third-party tracking — Giscus does not set cookies on your domain
- The owner sees the same comments anywhere they manage Discussions (web, mobile, GitHub CLI, GitHub API)
