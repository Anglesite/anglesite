# GitHub

The website source is backed up to a private GitHub repository. This provides offsite backup, version history accessible from any device, and issue tracking for bugs and maintenance tasks.

## Configuration

- `GITHUB_REPO` in `.site-config` — the `owner/repo` identifier
- Authentication managed by `gh auth` (OAuth, token stored locally by `gh`)
- Repository is private by default

## Setup

Configured during `/anglesite:start` (Step 5). The setup:
1. Installs `gh` CLI (via `npm run ai-setup`)
2. Authenticates via browser OAuth (`gh auth login --web`)
3. Creates a private repo (`gh repo create --private`)
4. Pushes the initial commit
5. Creates issue labels (bug, accessibility, security, content, build)

## Branches

- **`draft`** — Default working branch. All changes happen here.
- **`main`** — Production branch. Only updated by merging `draft` during `/anglesite:deploy`.

Push to `draft` creates a preview deploy at `draft.CF_PROJECT_NAME.pages.dev`. Push to `main` triggers production deploy via Cloudflare Pages Git integration.

Never commit directly to `main`. Always work on `draft` and merge via the deploy workflow.

## Backup

Every `/anglesite:deploy` pushes `draft` to GitHub before merging to `main`. Push failures are non-blocking — the deploy still succeeds, and the push will be retried on the next deploy.

The owner's entire website — code, content, configuration, images — is stored in the repository. The only things NOT in the repo are `.env` files, `node_modules`, build output, and local HTTPS certificates (all in `.gitignore`).

## Issue tracking

The webmaster agent files GitHub issues when it encounters bugs. See `CLAUDE.md` for the filing workflow.

### Labels

| Label | Color | When to use |
|---|---|---|
| bug | #d73a4a | Something is broken |
| accessibility | #0075ca | WCAG or usability issue |
| security | #e4e669 | Security or privacy concern |
| content | #0e8a16 | Content error or missing content |
| build | #fbca04 | Build or deploy failure |

### Duplicate detection

Before creating an issue, the agent searches existing open issues with `gh issue list --search`. If a match is found, a comment is added to the existing issue instead of creating a duplicate.

## Troubleshooting

- **`gh` not found:** Run `npm run ai-setup` to install it.
- **Auth expired:** Run `gh auth login --web` to re-authenticate.
- **Push rejected:** Run `git pull --rebase origin draft` then retry push.
- **Repo not found:** Check `GITHUB_REPO` in `.site-config` matches the actual GitHub repository name.
