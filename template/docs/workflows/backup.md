# Backup

Save all site changes to GitHub for safekeeping, or roll back to a previous snapshot.

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
- Does not change any files on your site (unless you ask to restore — see below)

## Backup history

Ask to see your backup history to review past saves. Recent backups are shown with dates and descriptions of what changed.

All backups are stored on GitHub at `https://github.com/GITHUB_REPO` (your private repository).

## Restore from a previous backup

If something went wrong — accidental deletion, a bad import, or a design experiment you want to undo — ask to restore. The flow is:

1. **Pick a snapshot.** You'll see a numbered list of recent backups with dates and descriptions.
2. **Preview the diff.** Before anything changes, you'll see exactly which files would be added, modified, or removed.
3. **Confirm.** Nothing happens until you say yes.
4. **Safe-stash.** Your current state is saved to a `recovery/<date>` branch so you can undo the restore.
5. **Apply.** `src/content/` and `public/` are replaced with the snapshot versions, then mirrored to GitHub.

Only content and public assets are restored. Code, layouts, configuration, and dependencies are left alone — rolling those back can break the build.

### Common restore scenarios

- **Accidental content deletion** — restore from a backup before the deletion
- **Bad import** — roll back to the snapshot taken before the import
- **Experimental design you don't want to keep** — return to the version you liked

### Undoing a restore

If a restore turns out wrong, ask to restore again — this time pick the `recovery/<date>` branch that was created during the previous restore.
