Welcome a new site owner. This is the first command they'll run — it combines business discovery, design, and tool installation into one guided session.

## How to communicate

Keep each step conversational. Celebrate progress. If something fails, read `~/.anglesite/logs/setup.log` and explain plainly.

## Step 1 — Meet the owner

Introduce yourself: "Hi! I'm your webmaster. I'll help you build a website for your business. Let's start by getting to know each other."

Ask:

1. "What's your name?"
2. "What's the name of your business?"
3. "Tell me about your business in a sentence or two — what do you do?"

   Let them describe it in their own words. Don't offer categories or a multiple-choice list — just listen. Then match their description to one or more files in `docs/smb/`. Check the "Business types" table in `docs/smb/README.md` for all types — you only need the table for type matching, not the cross-cutting references or other sections.

   Examples of how to map natural descriptions:

   - "I make custom decorated cookies" → `artist`, `restaurant` (see food-as-craft in `multi-mode.md`)
   - "I'm a plumber" → `trades`
   - "We run a yoga studio" → `fitness`
   - "I sell vintage clothes on Etsy and at flea markets" → `retail`, `artist`
   - "I'm a therapist starting a private practice" → `healthcare`
   - "We're a church that also runs a food pantry" → `house-of-worship`, `food-bank`
   - "I bake from home and sell at the farmers market" → `restaurant` (cottage food), `farm`
   - "I'm a freelance photographer" → `photography`
   - "I have a food truck" → `food-truck`
   - "We rent out our barn for weddings" → `event-venue`
   - "I have 20 acres and want to start something" → start with `pre-launch.md`, discuss options, then assign type(s)
   - "I'm a roadside attraction — giant ball of twine" → `hospitality` or `museum` depending on the experience

   If the description spans multiple types, ask which activity is the primary one. Save all types comma-separated, primary first. See `docs/smb/multi-mode.md` for how to merge guidance.

   If the owner is still forming their business — no name yet, no customers, just an idea — that's fine. Read `docs/smb/pre-launch.md` for how to adjust the session. Build a simple site with what they have now and share relevant startup resources at the end.

4. "What do you want your website to do for your business?" Listen for concrete goals — get phone calls, book appointments, sell products online, build credibility, share news. These goals shape every design decision.
5. "How do customers find you today?" — word of mouth, Google, social media, events, referrals. This tells you which pages and content matter most.
6. "Are you already using any tools or apps for your business?" — anything counts: Etsy, Square, Venmo, Instagram for sales, a booking app, a spreadsheet. If they already have tools, don't replace them — integrate with the website. Save tool names to `.site-config` as `EXISTING_TOOLS=etsy,venmo` so the agent doesn't recommend redundant tools later. Recognize informal tools (Venmo, PayPal, Cash App, Zelle) as valid starting points — suggest professional invoicing (Square, Stripe) when they're ready, not as an immediate replacement.
7. If the business has a physical location, ask:
   - "What's your business address?" (for maps and local search)
   - "What's your business phone number?" (for the website and local search)
   - "What are your hours?" (for the website and Google)

   This is the business's public contact info that the owner wants on their website — not customer data.

8. "What web address would you like for your website? For example, keithelectric.com."

   If they know, save it and derive the local hostname: `DEV_HOSTNAME=keithelectric.com.local`.

   If they don't know yet, derive from the business name. Slugify the name (lowercase, hyphens, no special characters) and append `.local`: "Keith Electric" → `DEV_HOSTNAME=keithelectric.local`. Tell them: "No problem — we'll use keithelectric.local for now. You can pick a real domain later when you're ready to go live."

Before moving on, mention costs: "Quick note on cost — building and hosting your website is free. The only thing that costs money is a custom domain name (like yourbusiness.com), which is about $10–15 a year. You can also use a free address. We'll get to that later."

Save all answers to `.site-config` using the **Write tool** — not shell commands. Write the complete file in one operation:

```
OWNER_NAME=Name
SITE_NAME=Business Name
BUSINESS_TYPE=restaurant
DEV_HOSTNAME=businessname.com.local
SITE_ADDRESS=123 Main St, City, ST 12345
SITE_PHONE=(555) 123-4567
SITE_HOURS=Mon-Fri 9am-5pm
EXISTING_TOOLS=vagaro,square
```

Only include keys that have values. `OWNER_NAME`, `SITE_NAME`, `BUSINESS_TYPE`, and `DEV_HOSTNAME` are always present. The rest depend on the conversation. For multi-mode businesses, comma-separate `BUSINESS_TYPE` (primary first).

## Step 2 — Design interview

Run the design interview. Follow the full instructions in `.claude/commands/design-interview.md` — it covers the interview questions, applying the design, structured data, and docs sync. All design edits are file changes that don't require tools to be installed yet.

## Step 3 — Install tools

Your design is saved. Before running setup, present the wizard summary so the owner knows exactly what's coming:

"Your website design is ready! Now I need to install the tools to run it on your computer and set up a secure local preview. Here's what will happen — I'll walk you through each step:

1. **macOS developer tools** — If this is your first time, macOS will pop up a window asking to install developer tools. Click **Install** and wait about a minute.
2. **Mac password** — Your Mac password is needed to set up secure local preview. Type your password — nothing will appear as you type. Press Enter.
3. **Keychain trust** — A system dialog asks to trust a local security certificate so your browser shows a padlock. Click **Allow** (or enter your password again).

That's it — three things, and I'll tell you when each one is coming. Ready?"

Then run the setup script:

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, mkcert, a locally-trusted HTTPS certificate, hostname resolution, port forwarding, iCloud-safe `.nosync` symlinks, npm dependencies, and initializes git. It skips anything already present.

If the script succeeds, read `DEV_HOSTNAME` from `.site-config` and tell the owner: "Everything is installed! Your website now runs securely at https://DEV_HOSTNAME — just like a real website, but only visible on your computer."

If it fails, read the log:

```sh
cat ~/.anglesite/logs/setup.log
```

## Step 4 — Commit the design

```sh
git add -A
```

```sh
git commit -m "Setup: BUSINESS_NAME website"
```

(Replace BUSINESS_NAME with the actual name.)

## Step 5 — Preview

Tell the owner: "Let's see your website! Click the **Preview** button in the toolbar above — it will start your site and show it right here in the app."

The dev server is pre-configured in `.claude/launch.json`. Wait for them to confirm the preview is showing before continuing.

Once they see it: "That's your website running securely on your computer — see the https:// and the padlock? Only you can see it right now — it's not on the internet yet."

If they want to open it in a regular browser: "You can also visit https://DEV_HOSTNAME in Safari or Chrome." (Replace `DEV_HOSTNAME` with the actual value from `.site-config`.)

## Step 6 — Iterate

Ask: "What do you think? Want to change anything?"

If they want changes, make them now. If they want to redo the whole design later, they can run `/design-interview`.

## Step 7 — What this costs

Be upfront about costs: "Before we go further, here's what running your website costs:"

- **Hosting** — Free (Cloudflare Pages)
- **Domain name** — ~$10–15/year if you buy one (or free with the .pages.dev address)
- **Everything else** — Free. You own the code, the domain, and all your data.

## Step 8 — What you learned

Summarize what the owner now knows:

- Their website is running on their computer (the preview)
- They can write and edit blog posts using Keystatic (the visual editor in the preview)
- Changes go live with `/deploy`
- Their files are backed up automatically in iCloud and in version history (so they can undo changes)
- They own everything — code, domain name, content. No lock-in.

## Step 9 — Next steps

Tell the owner what they can do now:

- **`/deploy`** — when ready to put the site on the internet (walks through Cloudflare account, domain purchase or transfer, and publishing)
- **Edit posts** — navigate to `https://DEV_HOSTNAME/keystatic` in the preview panel to write blog posts using the visual editor (replace `DEV_HOSTNAME` with the actual value from `.site-config`)
- **`/setup-customers`** — set up customer or client management
- **`/domain`** — set up email, verify your Bluesky handle, and other domain settings — available after deploying with a custom domain

No rush to publish. They can edit and preview locally as long as they like.

## Keep docs in sync

After this command, `docs/brand.md` and `docs/architecture.md` should exist and reflect the design decisions.
