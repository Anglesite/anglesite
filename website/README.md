# Your Website

This is the source code for your website. It lives in iCloud Drive so it's backed up automatically.

## Getting started

Choose the AI tool you'd like to use as your webmaster:

### Claude Desktop (recommended)

1. **Install Claude Desktop** — Download it free from [claude.ai/download](https://claude.ai/download). You'll need to create an Anthropic account if you don't have one.
2. **Open this folder** — Click the **Code** tab, then open this `website/` folder.
3. **Type `/start`** — Your webmaster will introduce themselves, learn about your business, design the site with you, and get everything running.

### Gemini CLI

1. **Install Gemini CLI** — Follow the instructions at [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli).
2. **Open this folder** — Run `cd` into this `website/` directory.
3. **Type `start`** — Ask your webmaster to run the `start` command. Command prompts live in `.claude/commands/` as Markdown files that Gemini can read.

### Other AI coding tools

This project uses the `AGENTS.md` standard. Any AI coding tool that reads `AGENTS.md` (Cursor, Windsurf, Cline, etc.) can act as your webmaster. Open this `website/` folder and ask it to run the `start` command from `.claude/commands/start.md`.

---

The setup process takes about 30 minutes regardless of which tool you use.

## What you can do

| I want to… | What to do |
| --- | --- |
| Write a blog post | Click **Preview** in the toolbar, then go to `https://yourbusiness.com.local/keystatic` (your webmaster will tell you the exact address) |
| Publish changes | Run `deploy` |
| Redesign the site | Run `design-interview` |
| Check the site for problems | Run `check` |
| Fix something | Run `fix` |

In Claude Desktop, prefix commands with `/` (e.g., `/deploy`). In other tools, ask the webmaster to run the command by name.

## Getting help

Type anything in the chat — describe what you need in plain English. Your webmaster can write new pages, fix problems, update the design, and more.
