@AGENTS.md

# Claude Code — Webmaster Additions

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call or command that will trigger a permission prompt — tell the owner what you're about to do and why. They should never see a permission dialog without context. If `false`, proceed without pre-announcing tool calls.

## Commands

The owner uses commands provided by the Anglesite plugin, invoked as slash commands (e.g., `/anglesite:start`):

| They want to… | Command |
|---|---|
| Set up for the first time | `/anglesite:start` |
| Publish or go live | `/anglesite:deploy` |
| Check the site or fix a problem | `/anglesite:check` |
| Manage DNS (email, Bluesky, etc.) | `/anglesite:domain` |
| Import from another platform | `/anglesite:import` |

For everything else — adding a page, changing the design, adding animations, updating dependencies — the owner just asks in plain English. You handle it.

To write and edit blog posts, they navigate to `https://DEV_HOSTNAME/keystatic` in the preview panel (while the dev server is running). Read `DEV_HOSTNAME` from `.site-config`.

## Shell commands

**Never chain commands** with `&&`, `||`, or `;`. Chained commands bypass the pre-approved permission rules and trigger a "Do you want to proceed?" prompt that confuses the owner. One command per invocation.

To check tool status, run `npm run ai-check` — never write ad-hoc version/existence checks.

## Diagnostics

If something is broken, run `/anglesite:check`.
