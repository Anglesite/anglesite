@AGENTS.md

# Gemini CLI specifics

## How the owner uses the site

The owner opens this project folder in Gemini CLI or Gemini Code Assist. Commands are provided by the Anglesite plugin and invoked by name (e.g., `anglesite:start`, `anglesite:deploy`).

## Shell commands

Run one command per invocation. Do not chain commands with `&&`, `||`, or `;`.

To check tool status, run `zsh scripts/check-prereqs.sh` — never write ad-hoc version/existence checks.

## Secrets

API tokens live in env vars, never in project files.

## Diagnostics

If iCloud is misbehaving, run the `anglesite:fix` command.
