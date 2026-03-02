@AGENTS.md

# Gemini CLI specifics

## How the owner uses the site

The owner opens this project folder in Gemini CLI or Gemini Code Assist. Commands are invoked by name (e.g., `start`, `deploy`). Command prompts live in `.claude/commands/` as Markdown files — Gemini can read them when asked.

## Shell commands

Run one command per invocation. Do not chain commands with `&&`, `||`, or `;`.

To check tool status, run `zsh scripts/check-prereqs.sh` — never write ad-hoc version/existence checks.

## Secrets

API tokens live in env vars, never in project files.

## Diagnostics

If iCloud is misbehaving, run `zsh scripts/fix-icloud.sh`.
