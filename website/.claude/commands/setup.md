Walk the site owner through first-time setup. The goal: editing locally. Publishing comes later with `/deploy`.

## How to communicate

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context. Pattern:

> "Next I'm going to [action] — this [why]. You'll see a prompt asking to allow it."

Keep each step conversational. Celebrate progress. If something fails, read `~/.anglesite/logs/setup.log` and explain plainly.

## Step 1 — Learn about the business

Ask the owner:

1. "What's the name of your business?"
2. "What kind of business is it?" Offer categories:
   - Farm or CSA
   - Restaurant or food business
   - Retail shop
   - Legal or professional services
   - Artist, maker, or craftsperson
   - Service business (consulting, coaching, trades, etc.)
   - Other (ask them to describe it)
3. "What's your name?" (so you know who you're talking to)

Save answers to `.site-config`:

```sh
echo "SITE_NAME=Business Name" >> .site-config
```

```sh
echo "BUSINESS_TYPE=restaurant" >> .site-config
```

```sh
echo "OWNER_NAME=Name" >> .site-config
```

## Step 2 — Install tools and dependencies

Tell the owner: "First I'll run a setup script that installs everything your website needs — a code runner called Node.js, a version manager, and the project's building blocks. It's safe to rerun if anything interrupts it. You may see a macOS dialog asking to install developer tools — click Install."

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, creates iCloud-safe `.nosync` symlinks, runs `npm install`, and initializes git. It skips anything already present.

If the script succeeds, tell the owner what was installed and move on. If it fails, read the log:

```sh
cat ~/.anglesite/logs/setup.log
```

## Step 3 — Personalize the scaffold

Using the business name from Step 1, update these files:

1. `package.json` — set `name` to a slugified version of the business name
2. `src/pages/index.astro` — replace placeholder title and heading with the business name
3. `src/layouts/BaseLayout.astro` — replace header and footer text with the business name

Commit these changes:

```sh
git add -A
```

```sh
git commit -m "Setup: configure for BUSINESS_NAME"
```

(Replace BUSINESS_NAME with the actual name.)

## Step 4 — Preview the site

Tell the owner: "Everything's installed. Let's see your website! Click the **Preview** button in the toolbar above — it will start your site and show it right here in the app."

The dev server is pre-configured in `.claude/launch.json`. Wait for them to confirm the preview is showing before continuing.

Once they see it: "That's your website running on your computer. Only you can see it right now — it's not on the internet yet."

## Step 5 — Next steps

Tell the owner what they can do now:

- **`/design-interview`** — customize colors, fonts, and layout for their business
- **Edit posts** — navigate to `localhost:4321/keystatic` in the preview panel to write blog posts using the visual editor
- **`/deploy`** — when ready to put the site on the internet (walks through creating a free Cloudflare account)
- **`/setup-customers`** — set up customer or client management (recommends industry-specific tools first)

No rush to publish. They can edit and preview locally as long as they like.

## Keep docs in sync

If setup changed any configuration, update the corresponding doc in `docs/`.
