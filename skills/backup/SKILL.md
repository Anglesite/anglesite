---
name: backup
description: "Back up site changes to GitHub with a descriptive summary"
allowed-tools: Bash(git status *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git log *), Bash(git diff *), Bash(git checkout *), Bash(git branch *), Bash(npx tsx *), Read
disable-model-invocation: true
---

Save the owner's work by committing all changes and pushing to GitHub. Never pushes to `main` — that's the deploy skill's job.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Check for changes

```sh
git status --porcelain
```

If the output is empty, tell the owner: "Everything is already backed up — no new changes to save."

If there are changes, continue to Step 1.

## Step 1 — Generate a summary

Run the backup summary script to categorize changes:

```sh
npx tsx scripts/backup-summary.ts
```

This is not a standalone CLI — use it as a reference for what to tell the owner. Instead, read the `git status --porcelain` output yourself and categorize the changes:

- **Blog posts** — files in `src/content/posts/`
- **Pages** — files in `src/pages/` (use the page name, not the file path)
- **Content collections** — files in `src/content/<collection>/` (services, team, testimonials, gallery, events, faq)
- **Styles** — files in `src/styles/`
- **Layout** — files in `src/layouts/`
- **Config** — `.site-config`, `astro.config.ts`, `keystatic.config.ts`
- **Other** — everything else

Tell the owner what changed in plain language before committing. For example: "You've made these changes since your last backup: 2 new blog posts, updated About page, and some style tweaks. I'll save all of this now."

## Step 2 — Commit

Stage all changes:

```sh
git add -A
```

Generate a descriptive commit message from the changes. Use a human-readable format, not generic messages like "updated files". Examples:
- "Add 2 blog posts"
- "Update About page and styles"
- "Add Services page, update contact info"
- "Add 3 team members and 5 gallery images"

Commit with the generated message:

```sh
git commit -m "MESSAGE"
```

## Step 3 — Push to GitHub

Push to the `draft` branch only:

```sh
git push origin draft
```

**Never push to `main`.** If the current branch is `main`, tell the owner: "You're on the production branch. Let me switch to the draft branch first." Then:

```sh
git checkout draft
```

If `draft` doesn't exist yet:

```sh
git checkout -b draft
```

Then retry the push.

If the push fails (auth expired), tell the owner: "I couldn't connect to GitHub — let's fix that." Run `gh auth login --web` and retry.

## Step 4 — Confirm

Read `GITHUB_REPO` from `.site-config`. Tell the owner:

"Your site is backed up! Here's what was saved: [plain-language summary of changes]."

"Your backup is on GitHub: `https://github.com/GITHUB_REPO`"

Include the date: "Last backup: [today's date and time]."

## Backup history

If the owner asks to see their backup history, show recent commits:

```sh
git log --oneline -10 --format="%h %ar — %s"
```

Present the results in plain language: "You have [N] backups. Here are the most recent ones:" followed by a readable list.

Read `GITHUB_REPO` from `.site-config` and remind them: "All your backups are safe on GitHub: `https://github.com/GITHUB_REPO`"
