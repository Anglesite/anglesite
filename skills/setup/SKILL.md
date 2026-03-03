---
name: Setup
description: "Install or reinstall development tools and dependencies"
user-invocable: true
---

Install or reinstall the development tools and dependencies.

This command is for technical setup only — installing Node.js, npm dependencies, and local HTTPS. If this is the first time setting up the site, run `/anglesite:start` instead (it includes this step plus business discovery and design).

## Before starting

Check if `.site-config` exists with `SITE_NAME`. If not, tell the owner: "It looks like this is a fresh start. Type `/anglesite:start` to set up your business and website from scratch — it includes the tool installation."

## How to communicate

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Step 1 — Run setup script

Tell the owner: "I'm going to install the tools your website needs — a code runner called Node.js, a version manager, a local security certificate for your preview, and the project's building blocks. It's safe to rerun if anything interrupts it. You may see a macOS dialog asking to install developer tools — click Install, and you may need to enter your Mac password for the HTTPS setup."

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, mkcert (locally-trusted HTTPS certificates), hostname resolution via `/etc/hosts`, port forwarding (443 → 4321), runs `npm install`, and initializes git. It skips anything already present.

## Step 2 — Report results

If the script succeeds, tell the owner what was installed and confirm the site is ready for preview.

If it fails, read the log and explain:

```sh
cat ~/.anglesite/logs/setup.log
```

## Keep docs in sync

If setup changed any configuration, update the corresponding doc in `docs/`.
