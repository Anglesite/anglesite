# Backup

Save all site changes to GitHub for safekeeping.

## What it does

1. Detects all changes since the last backup
2. Commits with a descriptive message (e.g., "Add 2 blog posts, update About page")
3. Pushes to the `draft` branch on GitHub
4. Confirms success with a plain-language summary

## When to use it

- After making changes you want to keep
- Before stepping away from your site for a while
- Anytime you want peace of mind that your work is saved

## What it doesn't do

- Does not publish your site (use `/anglesite:deploy` for that)
- Does not push to `main` — backups go to the `draft` branch only
- Does not change any files on your site

## Backup history

Ask to see your backup history to review past saves. Recent backups are shown with dates and descriptions of what changed.

All backups are stored on GitHub at `https://github.com/GITHUB_REPO` (your private repository).
