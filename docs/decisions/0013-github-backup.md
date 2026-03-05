---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use GitHub for offsite backup and issue tracking

> **This is a default decision.** It defines where the website source is backed up and how bugs are tracked. GitHub can be replaced with another Git host if needed — tell your Webmaster.

## Context and Problem Statement

Anglesite websites are stored locally on the owner's computer. Git provides local version history, but if the computer is lost, stolen, or fails, the website is gone. There is also no way to track bugs between sessions — issues found during one check are forgotten by the next.

## Decision Drivers

* The owner is non-technical — backup should be automatic, not manual
* A single point of failure (one computer) is unacceptable for a business website
* Bug tracking needs to persist across sessions without requiring the owner to manage it
* The solution should be free and work with the existing tool chain

## Considered Options

1. **GitHub** — private repo for backup, GitHub Issues for bug tracking
2. **GitLab** — same capabilities, but less familiar to non-technical users
3. **Cloudflare R2** — object storage backup, but no version history or issue tracking
4. **iCloud / OneDrive / Google Drive** — file sync, but no version history or issue tracking
5. **No remote backup** — status quo, owner responsible for their own backup

## Decision Outcome

**GitHub**, because:

* `gh` CLI handles authentication via browser OAuth — no tokens for the owner to manage
* Private repos are free for unlimited use
* GitHub Issues provides built-in bug tracking with labels, search, and duplicate detection
* `gh` CLI works on macOS, Linux, and Windows
* Most widely recognized Git host — easier for handoff to another developer
* Every deploy automatically pushes to GitHub, making backup invisible to the owner

### Consequences

* **Requires a GitHub account** — the owner must create one during `/anglesite:start`
* **Requires internet** — pushes fail offline, but deploys are not blocked
* **`gh` CLI is a new dependency** — installed automatically by the setup script
* **Issue tracking is agent-managed** — the owner doesn't need to interact with GitHub Issues directly

## More Information

* [GitHub CLI documentation](https://cli.github.com/manual/)
* Setup happens during `/anglesite:start` Step 5
* Bug filing workflow is documented in `AGENTS.md`
* Full reference in `docs/github.md`
