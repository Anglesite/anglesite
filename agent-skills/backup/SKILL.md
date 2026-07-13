---
name: backup
description: "Back up site changes to GitHub, or restore an earlier snapshot"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(git status *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git log *), Bash(git diff *), Bash(git checkout *), Bash(git branch *), Bash(git tag *), Bash(git show *), Bash(git stash *), Bash(git fetch *), Bash(git rev-parse *), Bash(npx tsx *), Read
metadata:
  author: "David W. Keith"
  version: "1.5.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Save the owner's work by committing all changes and pushing to GitHub, or restore a previous snapshot if something went wrong. Never pushes to `main` — that's the deploy skill's job.

## Routing

If the owner asks to "restore", "roll back", "go back to a previous version", "undo my changes", "recover", or otherwise wants to retrieve an earlier state, jump to the **Restore flow** below. Otherwise continue with the backup steps.

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

## Restore flow

Use this when the owner wants to roll back to an earlier snapshot — for accidental deletions, a bad import, a broken design experiment, or any "I want to go back to how it was yesterday" request.

Restore touches `src/content/` and `public/` only. Code, configuration, and dependencies (`src/pages/`, `src/layouts/`, `astro.config.ts`, `package.json`, `.site-config`) are left alone, since rolling those back would usually break the build.

### Step R1 — Make sure GitHub history is current

Pull the latest from GitHub so the snapshot list reflects all backups, not just local ones:

```sh
git fetch origin
```

If fetch fails (auth expired, no network), tell the owner what happened in plain English and stop — restoring against stale local history would hide their newest backups.

### Step R2 — List available snapshots

Show the owner the most recent backups on `draft` plus any tags:

```sh
git log --format="%H%h%aI%ar%s%D" -25 origin/draft
```

Parse the output with the helper:

```ts
import { parseSnapshots, formatSnapshotList } from "./scripts/restore-snapshots.js";
```

Present the list to the owner with one line per snapshot: relative date, commit subject, and short hash. Example:

```
1. 2 hours ago — Update About page (a1b2c3d)
2. yesterday — Add 3 blog posts (e4f5g6h)
3. 3 days ago — Initial setup (i7j8k9l) [tag: v1.0]
```

Ask which snapshot they want to restore. Accept either the number from the list or the short hash. If the owner is unsure, offer to `git show --stat <hash>` for more detail.

### Step R3 — Preview the diff

Before any files change, show what the restore would do. Compare the chosen snapshot against the current working tree, scoped to content and public assets:

```sh
git diff --stat HEAD <snapshot> -- src/content/ public/
```

If the diff is empty: tell the owner the snapshot already matches their current state and stop — there's nothing to restore.

If the diff is large (more than ~30 files), summarize by category instead of dumping the full list. Always include:
- How many files will be added back, modified, or deleted
- Which content collections are affected (posts, pages, services, gallery, etc.)
- A specific warning if any current file would be **deleted** by the restore (i.e. files added since the snapshot)

### Step R4 — Get explicit confirmation

Tell the owner exactly what will happen, in plain language, and wait for a clear yes:

> "I'm about to replace your current `src/content/` and `public/` files with the versions from [date / message]. That means [N] files will change, and [M] files you've added since then will be removed. I'll save your current state to a recovery branch first so we can undo this if needed. Should I proceed?"

Do not proceed on a vague answer ("ok", "sure, but…"). Ask again until you get an unambiguous yes.

### Step R5 — Safe-stash current state

Make sure the owner is on `draft`. If they're on `main`, switch first (same rule as backup — never restore over `main` directly):

```sh
git checkout draft
```

If the working tree has uncommitted changes, commit them so they're recoverable:

```sh
git add -A
git commit -m "Pre-restore snapshot — YYYY-MM-DD"
```

Create a recovery branch pointing at the current `draft` tip so the owner can return to "now" if the restore looks wrong. Use the helper to generate the branch name:

```ts
import { recoveryBranchName } from "./scripts/restore-snapshots.js";
```

```sh
git branch <recovery-branch> draft
```

Tell the owner the recovery branch name. They will need it if they want to undo.

### Step R6 — Apply the restore

Replace `src/content/` and `public/` with the snapshot versions:

```sh
git checkout <snapshot> -- src/content/ public/
```

Stage and commit so the restore is itself a backup-able event:

```sh
git add -A src/content/ public/
git commit -m "Restore src/content/ and public/ from <short-hash> (<snapshot subject>)"
```

Push to `draft` so the restore is mirrored to GitHub:

```sh
git push origin draft
```

### Step R7 — Confirm and offer next steps

Tell the owner:

- Which snapshot was restored (date and message)
- That a recovery branch (`<recovery-branch>`) was created in case they want to undo
- How to undo: "Run `/anglesite:backup` and ask me to restore the recovery branch — I'll know what to do."
- That they should run `npm run dev` (or open the preview) to confirm the site looks right before deploying

Remind them that the restore only changed content and public assets — code and configuration are untouched.

### Undoing a restore

If the owner asks to undo a recent restore, treat the recovery branch like any other snapshot: list it, preview the diff against the current tree, confirm, and apply. The recovery branch is a regular git branch — `git log <recovery-branch>` shows its history.

### Restore safety rules

- **Never restore over `main`.** Always operate on `draft`.
- **Never skip the recovery branch.** It's the owner's only undo path if the restore looks wrong.
- **Never restore code or config** (`src/pages/`, `src/layouts/`, `astro.config.ts`, `keystatic.config.ts`, `package.json`, `.site-config`). If the owner specifically wants those rolled back, treat it as a separate request and confirm each path explicitly — these can break the build.
- **Never force-push** when mirroring the restore to GitHub. If `git push` is rejected, stop and ask the owner before doing anything destructive.
