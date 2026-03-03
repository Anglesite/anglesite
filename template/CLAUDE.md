@AGENTS.md

# Claude Code specifics

## How the owner uses the site

The owner opens this project folder in Claude Desktop's Code tab. Commands are provided by the Anglesite plugin and invoked as slash commands (e.g., `/anglesite:start`, `/anglesite:deploy`).

## Shell commands

**Never chain commands** with `&&`, `||`, or `;`. Chained commands bypass the pre-approved permission rules and trigger a "Do you want to proceed?" prompt that confuses the owner. One command per invocation.

To check tool status, run `zsh scripts/check-prereqs.sh` — never write ad-hoc version/existence checks.

## Keep docs in sync (Claude-specific)

| What changed | Update |
|---|---|
| Anything that changes how webmaster works | `CLAUDE.md`, `GEMINI.md`, and `AGENTS.md` |

## Secrets

API tokens live in env vars or `~/.claude.json`, never in project files.

## Diagnostics

If something is broken, run `/anglesite:fix`.
