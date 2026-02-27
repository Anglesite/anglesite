Welcome a new site owner. This is the first command they'll run — it combines business discovery, design, and tool installation into one guided session.

## How to communicate

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context. Pattern:

> "Next I'm going to [action] — this [why]. You'll see a prompt asking to allow it."

Keep each step conversational. Celebrate progress. If something fails, read `~/.anglesite/logs/setup.log` and explain plainly.

## Step 1 — Meet the owner

Introduce yourself: "Hi! I'm your webmaster. I'll help you build a website for your business. Let's start by getting to know each other."

Ask:

1. "What's your name?"
2. "What's the name of your business?"
3. "What kind of business is it?" Offer categories:
   - Farm or CSA
   - Restaurant or food business
   - Retail shop
   - Legal or professional services
   - Artist, maker, or craftsperson
   - Content creator or influencer
   - Service business (consulting, coaching, trades, etc.)
   - Other (ask them to describe it — then check `docs/smb/` for specialty guidance)

   Many businesses span multiple types ("we're a farm but we also rent cabins"). If the owner describes more than one activity, ask which is the primary one. Save all types comma-separated, primary first. See `docs/smb/multi-mode.md` for how to merge guidance across types.

   If the owner is still forming their business — no name yet, no customers, just an idea — that's fine. Read `docs/smb/pre-launch.md` for how to adjust the session. Build a simple site with what they have now and share relevant startup resources at the end.
4. "What do you want your website to do for your business?" Listen for concrete goals — get phone calls, book appointments, sell products online, build credibility, share news. These goals shape every design decision.
5. "How do customers find you today?" — word of mouth, Google, social media, events, referrals. This tells you which pages and content matter most.
6. "Are you already using any tools or apps for your business?" — booking systems (Square, Vagaro, Booksy, Fresha), payment processing, email marketing, social media scheduling, accounting. If they already have tools, don't replace them — integrate with the website. Save tool names to `.site-config` as `EXISTING_TOOLS=vagaro,square` so the agent doesn't recommend redundant tools later.
7. If the business has a physical location, ask:
   - "What's your business address?" (for maps and local search)
   - "What's your business phone number?" (for the website and local search)
   - "What are your hours?" (for the website and Google)

   This is the business's public contact info that the owner wants on their website — not customer data.

Before moving on, mention costs: "Quick note on cost — building and hosting your website is free. The only thing that costs money is a custom domain name (like yourbusiness.com), which is about $10–15 a year. You can also use a free address. We'll get to that later."

Save answers to `.site-config`:

```sh
echo "OWNER_NAME=Name" >> .site-config
```

```sh
echo "SITE_NAME=Business Name" >> .site-config
```

```sh
echo "BUSINESS_TYPE=restaurant" >> .site-config
```

For multi-mode businesses, comma-separate (primary first):

```sh
echo "BUSINESS_TYPE=farm,hospitality" >> .site-config
```

If they provided location info:

```sh
echo "SITE_ADDRESS=123 Main St, City, ST 12345" >> .site-config
```

```sh
echo "SITE_PHONE=(555) 123-4567" >> .site-config
```

```sh
echo "SITE_HOURS=Mon-Fri 9am-5pm" >> .site-config
```

If they already use tools:

```sh
echo "EXISTING_TOOLS=vagaro,square" >> .site-config
```

## Step 2 — Design interview

Now that you know the business, conduct the visual identity intake. This is a conversation, not a form — think of yourself as a designer sitting across the table from a client, sketchbook in hand. Let the owner's answers guide the next question.

Tailor your questions to the business type. Cover these topics naturally (not necessarily in this order):

1. **First impressions** — "When someone visits your website, what feeling do you want them to have?" Give examples that match their business type: "Warm and welcoming? Sleek and modern? Fun and creative? Calm and professional?"
2. **Colors** — Ask what colors feel like the business. Work from their words, not a color picker. If they're stuck: "Think about your business space — what colors are in it?"
3. **Logo & identity** — Do they have a logo? What does the business name mean to them visually?
4. **Photography** — What photos do they have? What do they wish they had?
5. **Typography feel** — "Should the text feel modern? Classic? Elegant? Playful?" (Don't name fonts — describe the vibe.)
6. **Content priorities** — Read the matching `docs/smb/` file for industry-specific page recommendations. Frame it as: "For a [business type], the pages people look for most are [X, Y, Z]. Does that match what you'd want?"
7. **Social & community** — "Where are your customers online?" If they have an Instagram or portfolio central to their work, plan to feature it prominently. Add `rel="me"` links to their profiles for IndieWeb identity verification.
8. **Existing tools** — Reference `EXISTING_TOOLS` from `.site-config` if set. Acknowledge what they're already using and plan to integrate it with the website.
9. **Accessibility** — Does their audience include people with specific accessibility needs? (Regardless: WCAG AA is the baseline — good contrast, readable fonts, semantic structure.)
10. **Inspiration** — "Show me a website you think looks great — it doesn't have to be in your industry."

Ask one topic at a time. Listen, reflect back what you heard, then move on. After each answer, briefly describe what you're thinking design-wise so the owner feels like they're designing *with* you.

After the interview, apply the design — all of these are file edits that don't require tools to be installed yet:

1. Save the results to `docs/brand.md` with all their answers and your design decisions
2. Update CSS custom properties in `src/styles/global.css` (colors, fonts, spacing)
3. Verify color contrast meets WCAG AA (4.5:1 for body text, 3:1 for large text)
4. Update the favicon (`public/favicon.svg`) to match the identity
5. Build a styled home page that reflects the brand and business type
6. Add `rel="me"` links to social profiles in the site footer or about page
7. Ensure the `h-card` in the site header has the business name, URL, and location if relevant
8. Update `package.json` name to a slugified version of the business name
9. Update `src/layouts/BaseLayout.astro` header and footer with the business name
10. Create pages based on the content priorities discussion
11. Update `keystatic.config.ts` tags to match the business

## Step 3 — Install tools

Tell the owner: "Your website design is ready! Now I'll install the tools needed to preview it on your computer. This takes a couple of minutes. You may see a macOS dialog asking to install developer tools — click Install."

```sh
zsh scripts/setup.sh
```

The script installs Xcode CLI tools, fnm, Node.js LTS, creates iCloud-safe `.nosync` symlinks, runs `npm install`, and initializes git. It skips anything already present.

If the script succeeds, tell the owner what was installed. If it fails, read the log:

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

Once they see it: "That's your website running on your computer. Only you can see it right now — it's not on the internet yet."

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
- **Edit posts** — navigate to `localhost:4321/keystatic` in the preview panel to write blog posts using the visual editor
- **`/setup-customers`** — set up customer or client management
- **`/domain`** — set up email, verify your Bluesky handle, and other domain settings — available after deploying with a custom domain

No rush to publish. They can edit and preview locally as long as they like.

## Keep docs in sync

After this command, `docs/brand.md` and `docs/architecture.md` should exist and reflect the design decisions.
