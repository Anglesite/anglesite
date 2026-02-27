Walk Julia through first-time setup.

## How to communicate

Before every tool call or command that will trigger a permission prompt, tell Julia what you're about to do and why in plain English. She should never see a permission dialog without context. Pattern:

> "Next I'm going to [action] — this [why]. You'll see a prompt asking to allow it."

Keep each step conversational. Celebrate progress. If something fails, read `~/.pairadocs/logs/setup.log` and explain plainly.

## Step 1 — Install tools and dependencies

Tell Julia: "First I'll run a setup script that installs everything your website needs — a code runner called Node.js, a version manager, and the project's building blocks. It's safe to rerun if anything interrupts it. You may see a macOS dialog asking to install developer tools — click Install."

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, creates iCloud-safe `.nosync` symlinks, runs `npm install`, and initializes git. It skips anything already present.

If the script succeeds, tell Julia what was installed and move on. If it fails, read the log:

```sh
cat ~/.pairadocs/logs/setup.log
```

## Step 2 — Create Cloudflare account

Julia needs a free Cloudflare account to publish her website. Tell her: "Your website needs a home on the internet. Cloudflare hosts it for free and makes it fast. Let's create an account."

Ask Julia: "Do you already have a Cloudflare account, or should we create one?"

If she needs one, tell her you're opening the sign-up page, then:

```sh
open https://dash.cloudflare.com/sign-up
```

Walk her through: click "Sign in with Apple", approve, done. Wait for her to confirm she's signed in before continuing.

## Step 3 — First deploy

Tell Julia: "Now I'll build your website and put it online. This has three parts: building the site, connecting to Cloudflare, and uploading. The first time, your browser will open asking you to authorize the connection — just click Authorize."

Build first:

```sh
npm run build
```

Then deploy. Tell Julia a browser window will open for authorization:

```sh
npx wrangler pages deploy dist/ --project-name pairadocs-farm
```

After deploy succeeds, open the live site together:

```sh
open https://pairadocs-farm.pages.dev
```

Celebrate: "Your website is live!"

## Step 4 — Add to Dock

Tell Julia: "You can drag **Pairadocs Farm** from your Applications folder to the Dock for quick access. Click it anytime to see your task menu."

Test it together: click the app icon, choose **🌐 View Live Website** — it should open the site she just deployed.

## Step 5 — First blog post together

Walk Julia through the full workflow:
1. Click **Pairadocs Farm** → **✏️ Edit Posts** → create a test post → save
2. Click **Pairadocs Farm** → **📤 Publish to Farm**
3. Visit the live site together to confirm the post appears
4. Click **Pairadocs Farm** → **📊 View Analytics** to show her the dashboard
5. Explain POSSE: publish on your site first, share on social media, then add the share links back in Keystatic

Then she's ready. Suggest next steps: `/design-interview` for visual identity, `/setup-airtable` for CSA membership.

## Keep docs in sync

If setup changed any configuration, update the corresponding doc in `docs/`.
