Walk Julia through first-time setup. The goal is to get her editing locally — publishing comes later when she runs `/deploy`.

## How to communicate

Before every tool call or command that will trigger a permission prompt, tell Julia what you're about to do and why in plain English. She should never see a permission dialog without context. Pattern:

> "Next I'm going to [action] — this [why]. You'll see a prompt asking to allow it."

Keep each step conversational. Celebrate progress. If something fails, read `~/.anglesite/logs/setup.log` and explain plainly.

## Step 1 — Install tools and dependencies

Tell Julia: "First I'll run a setup script that installs everything your website needs — a code runner called Node.js, a version manager, and the project's building blocks. It's safe to rerun if anything interrupts it. You may see a macOS dialog asking to install developer tools — click Install."

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, creates iCloud-safe `.nosync` symlinks, runs `npm install`, and initializes git. It skips anything already present.

If the script succeeds, tell Julia what was installed and move on. If it fails, read the log:

```sh
cat ~/.anglesite/logs/setup.log
```

## Step 2 — Preview the site

Tell Julia: "Everything's installed. Let's see your website! Click the **Preview** button in the toolbar above — it will start your site and show it right here in the app."

The dev server is pre-configured in `.claude/launch.json`. Wait for Julia to confirm the preview is showing before continuing.

Once she sees it, tell her: "That's your website running on your computer. Only you can see it right now — it's not on the internet yet. You can also type `localhost:4321/keystatic` in the preview's address bar to open the post editor."

## Step 3 — Next steps

Tell Julia what she can do now:

- **`/design-interview`** — customize colors, fonts, and branding
- **Edit posts** — navigate to `localhost:4321/keystatic` in the preview panel to write blog posts using the visual editor
- **`/deploy`** — when she's ready to put the site on the internet (this will walk her through creating a free Cloudflare account)

No rush to publish. She can edit and preview locally as long as she likes.

## Keep docs in sync

If setup changed any configuration, update the corresponding doc in `docs/`.
