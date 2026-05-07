---
name: start
description: "First-time setup: discovery, design, tools, preview"
allowed-tools: Bash(zsh *), Bash(npm install), Bash(npm run *), Bash(gh *), Bash(git remote *), Bash(git push *), Bash(git branch *), Bash(git add *), Bash(git commit *), WebFetch, Write, Read, Glob
disable-model-invocation: true
---

Welcome a new site owner. This is the first command they'll run — it combines discovery, project scaffolding, design, and tool installation into one guided session.

## Architecture decisions

These decisions shape how the site is built. Read when you need to explain *why* to the owner:

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — why the site uses Astro (zero client JS, static output)
- [ADR-0002 Keystatic](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0002-keystatic-local-cms.md) — why content is local `.mdoc` files, not a hosted CMS
- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — why hosting is on Cloudflare (free, CLI deploy, at-cost domains)
- [ADR-0009 Industry tools](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — why existing tools are integrated, not replaced
- [ADR-0010 Local HTTPS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0010-local-https-development.md) — why the dev environment uses HTTPS with a custom hostname
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — why the owner controls all code, content, domain, and hosting

## How to communicate

Keep each step conversational. Celebrate progress. If something fails, read `~/.anglesite/logs/setup.log` and explain plainly.

## On-demand owner name

Anglesite practices PII data minimization: **don't ask for the owner's name during setup.** Names are PII and there's nothing in `start` (or in design, tool install, GitHub backup, or preview) that genuinely needs one. Collect it only when a downstream skill produces an output that requires it — copyright footer, About-page byline, h-card / IndieAuth identity, print materials, handoff documentation.

When such a skill runs, it should:

1. Read `OWNER_NAME` from `.site-config`. If present, use it.
2. If absent, prompt the owner once, framed by the use case — e.g. "What name should appear on the copyright line?" or "What name should we put on your About page?" — not a generic "What's your name?"
3. Save the answer to `.site-config` with the **Write tool** so subsequent skills don't ask again.

The same principle extends to other PII (email, phone, address): collect at the moment of use, not speculatively.

## Step 0 — Meet the owner

Introduce yourself: "Hi! I'm your webmaster. I'll help you build a website. Let's start with what kind of site you need."

Don't ask for the owner's name yet. Names are PII and there's nothing in this step that needs one — ask later if and when a specific output requires it (copyright footer, About page, IndieAuth identity, print materials, handoff doc). See "On-demand owner name" below.

Ask:

1. "What kind of website are you looking for?"

   Let them describe it naturally. Map their answer to a site type:

   - Business or organization → `SITE_TYPE=business`
   - Personal homepage, resume, CV → `SITE_TYPE=personal`
   - Blog or writing-focused → `SITE_TYPE=blog`
   - Portfolio, creative showcase → `SITE_TYPE=portfolio`
   - Organization, nonprofit, club, community → `SITE_TYPE=organization`

   If unclear, ask a follow-up. Don't offer a multiple-choice list — let their words guide you.

Before branching, surface the first-run education prompts. Read `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 1 ("First Run / Site Type Selection") and share the `LAUNCH_NOT_FINISH` and `THREE_PAGES` topics — one brief aside, not a lecture. Then write both `EDUCATION_LAUNCH_NOT_FINISH=shown` and `EDUCATION_THREE_PAGES=shown` to `.site-config` after scaffolding (Step 1), alongside all other config values.

Then branch based on site type:

### Business sites (`SITE_TYPE=business`)

2. "What's the name of your business?"
3. "Tell me about your business in a sentence or two — what do you do?"

   Let them describe it in their own words. Then match their description to one or more files in `${CLAUDE_PLUGIN_ROOT}/docs/smb/`. Check the "Business types" table in `${CLAUDE_PLUGIN_ROOT}/docs/smb/README.md` for all types — you only need the table for type matching, not the cross-cutting references or other sections.

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

   If the description spans multiple types, ask which activity is the primary one. Save all types comma-separated, primary first. See `${CLAUDE_PLUGIN_ROOT}/docs/smb/multi-mode.md` for how to merge guidance.

   If the owner is still forming their business — no name yet, no customers, just an idea — that's fine. Read `${CLAUDE_PLUGIN_ROOT}/docs/smb/pre-launch.md` for how to adjust the session. Build a simple site with what they have now and share relevant startup resources at the end.

4. "What do you want your website to do for your business?" Listen for concrete goals — get phone calls, book appointments, sell products online, build credibility, share news. These goals shape every design decision.
5. "How do customers find you today?" — word of mouth, Google, social media, events, referrals. This tells you which pages and content matter most.
6. "Are you already using any tools or apps for your business?" — anything counts: Etsy, Square, Venmo, Instagram for sales, a booking app, a spreadsheet. If they already have tools, don't replace them — integrate with the website. Recognize informal tools (Venmo, PayPal, Cash App, Zelle) as valid starting points — suggest professional invoicing (Square, Stripe) when they're ready, not as an immediate replacement.

6b. **Business and organization sites only:** "Where do your customers leave reviews? Google, Yelp, your booking platform?" — Save as `REVIEW_PLATFORMS=google,yelp,fresha` (comma-separated slugs) in `.site-config`. If they mention Google Business Profile and `GOOGLE_REVIEW_URL` is not already set, ask for their business name to construct the direct review link: `https://search.google.com/local/writereview?placeid=PLACE_ID`. Find the Place ID via [Google's Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) and save as `GOOGLE_REVIEW_URL` in `.site-config`. Skip this question for personal, blog, and portfolio site types.

7. If the business has a physical location, ask:
   - "What's your business address?" (for maps and local search)
   - "What's your business phone number?" (for the website and local search)
   - "What are your hours?" (for the website and Google)

   This is the business's public contact info that the owner wants on their website — not customer data.

### Personal sites (`SITE_TYPE=personal`)

2. "What should we call your site?" — a nickname, a creative title, or their name if they want it as the title. (Treat this answer as the public site title only; don't use it as `OWNER_NAME` — that's collected later, on-demand, when a flow actually needs the legal/preferred name.)
3. "What do you want on it?" — about page, resume, links to projects, photos, contact info. Listen for what matters to them.

### Blog sites (`SITE_TYPE=blog`)

2. "What's the name of your blog?" — a title for the blog. (If they suggest using their name, treat it as `SITE_NAME` only — don't double-save it as `OWNER_NAME`.)
3. "What will you write about?" — topics, audience, tone. This shapes categories and tags.

### Portfolio sites (`SITE_TYPE=portfolio`)

2. "What's the name of your portfolio?" — studio name, brand, or their name as a title. (Treat as `SITE_NAME` only; `OWNER_NAME` is collected later if needed.)
3. "What kind of work will you showcase?" — photography, design, illustration, writing, code, music, etc.

   If their work is interactive or code-based (creative coding, generative art, web experiments, data visualization, WebGL, shaders), add `web-artist` to `BUSINESS_TYPE`. This enables the `creative-canvas` skill for full immersive setup — `ImmersiveLayout`, experiment gallery at `/lab`, and curated creative coding library support (p5.js, Three.js, GSAP, Tone.js, D3.js). Read `${CLAUDE_PLUGIN_ROOT}/docs/smb/web-artist.md` for design and structure guidance.

4. "Where else do you share your work?" — Instagram, Behance, Dribbble, GitHub, SoundCloud, OpenProcessing, Shadertoy. These become featured links on the site.

### Organization sites (`SITE_TYPE=organization`)

2. "What's the name of your organization?"
3. "What does your organization do?" — mission, community, cause. Match to `${CLAUDE_PLUGIN_ROOT}/docs/smb/` if applicable (e.g., `nonprofit`, `house-of-worship`, `youth-org`, `food-bank`). Save as `BUSINESS_TYPE`.
4. "What should the website help people do?" — donate, volunteer, find events, learn about your mission, contact you.

### All site types — wrap up

Ask everyone:

- "What web address would you like? For example, yourname.com."

  If they're unsure, help them think it through. Read `${CLAUDE_PLUGIN_ROOT}/docs/domain-guide.md` for evidence-based TLD guidance — the right domain depends on who they are. For co-ops, suggest .coop. For nonprofits, suggest .org. For environmental orgs, mention .eco. For general businesses, .com is the safe default. See the quick reference table in the domain guide.

  If they know what they want, save it and derive the local hostname: `DEV_HOSTNAME=example.com.local`.

  If they don't know yet, derive from the site name. Slugify (lowercase, hyphens, no special characters) and append `.local`: "Pairadocs Farm" → `DEV_HOSTNAME=pairadocs-farm.local`. Tell them: "No problem — we'll use that for now. You can pick a real domain later when you're ready to go live."

- "Are you on Bluesky, or interested in joining? It's a social network where your domain becomes your handle — so people see @yourdomain.com instead of a platform username. It's free and aligned with the idea that you should own your online identity."

  If yes and they have an account: save `BLUESKY_HANDLE=@current-handle` to `.site-config`. They can verify their domain as their handle later with `/anglesite:domain bluesky`.

  If yes and they want to sign up: point them to `https://bsky.app` and note it for the domain setup step.

  If not interested, that's fine — don't push.

- "One more thing — as I work on your website, I can either explain each step before I do it, or just get things done quietly. Which do you prefer?"

  Save the answer as `EXPLAIN_STEPS=true` (explain each step) or `EXPLAIN_STEPS=false` (just do it). Default to `true` if the owner seems unsure.

Before moving on, mention costs — but read the room. If the owner is clearly technical or building a developer/software site, keep it brief: "Hosting is free on Cloudflare Workers. A custom domain is ~$10–15/year, or you can use a free .workers.dev address." For everyone else, be warmer: "Quick note on cost — building and hosting your website is free. The only thing that costs money is a custom domain name (like yourname.com), which is about $10–15 a year. You can also use a free address. We'll get to that later."

Hold all answers in memory — they'll be saved to `.site-config` after the project files are set up in the next step.

## Step 1 — Scaffold the project

Tell the owner: "Great — I know enough to get started! Now I'll set up the project files for your website. You may see a prompt asking to allow this — go ahead and click Allow."

Then run:

```sh
zsh ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.sh --yes .
```

This copies the website template (source code, docs, scripts, configuration) into the current directory. All subsequent steps work with these scaffolded files.

Now save all answers from Step 0 to `.site-config` using the **Write tool** — not shell commands. Write the complete file in one operation:

```
SITE_TYPE=business
SITE_NAME=Business Name
BUSINESS_TYPE=restaurant
DEV_HOSTNAME=businessname.com.local
AI_MODEL=Claude Opus 4.6
SITE_ADDRESS=128 Pullets Dr, Central, SC 29630
SITE_PHONE=(555) 123-4567
SITE_HOURS=Mon-Fri 9am-5pm
EXISTING_TOOLS=vagaro,square
EXPLAIN_STEPS=true
ANGLESITE_VERSION=0.16.3
```

Only include keys that have values. `SITE_NAME`, `SITE_TYPE`, `DEV_HOSTNAME`, `AI_MODEL`, and `EXPLAIN_STEPS` are always present. For `AI_MODEL`, write the model name and version you are running as (e.g. `Claude Opus 4.6`). `BUSINESS_TYPE` is present for business and organization sites. `EXISTING_TOOLS` is present if the owner mentioned tools (business) or social platforms (portfolio). The rest — including `OWNER_NAME` — depend on the conversation. **Do not write `OWNER_NAME` here.** It's PII and is only collected later, on-demand, by skills that genuinely need it (see "On-demand owner name" below). For multi-mode businesses, comma-separate `BUSINESS_TYPE` (primary first).

After writing `.site-config`, prune content collections that aren't relevant to the site type. This removes unused content directories, associated pages, and updates `anglesite.config.json`:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/prune-collections.mjs .
```

The prune script reads `SITE_TYPE` and `BUSINESS_TYPE` from `.site-config` and keeps only the collections needed — for example, a portfolio site keeps `posts` and `gallery`; a restaurant business keeps `posts`, `services`, `team`, `testimonials`, `faq`, `events`, `menus`, `menuSections`, and `menuItems`. Both `content.config.ts` and `keystatic.config.ts` auto-detect which collections are active based on directory existence, so the CMS and build stay in sync.

If the design interview (Step 2) adds collections or singletons not already present, create the content directory (e.g. `mkdir -p src/content/experiments`) and regenerate `anglesite.config.json` to match.

## Step 2 — Design

Offer the owner a choice between three design paths, with the fast path first:

> Now for the look and feel. There are three ways to do this:
>
> 1. **Pick a pre-made design system** (fastest — about 30 seconds). I'll show you a few from [freedesignmd.com](https://freedesignmd.com), a free catalog of 121+ curated design systems. You pick one and we're done.
> 2. **Quick-pick from 9 built-in themes** (fast — one decision). I'd suggest one based on your business type, but you can pick whichever feels right.
> 3. **Bespoke interview** (5–10 minutes, uniquely yours). A guided conversation about your brand, voice, and audience. We build the design together.
>
> Which would you prefer? When in doubt, the pre-made catalog is a great place to start — you can always switch later.

Branch based on the choice:

- **Pre-made catalog** → read and follow `${CLAUDE_PLUGIN_ROOT}/skills/freedesignmd/SKILL.md`. After it returns, continue with the post-design tasks below.
- **Built-in quick-pick** → read and follow `${CLAUDE_PLUGIN_ROOT}/skills/themes/SKILL.md` and pick the built-in path (Step 3 of that skill). After it returns, continue with the post-design tasks below.
- **Bespoke interview** → read and follow `${CLAUDE_PLUGIN_ROOT}/skills/design-interview/SKILL.md` — it conducts a 4-stage conversational design discovery (Intent → Mood → Brand anchoring → Axis confirmation) and generates `src/design/design.json`, `src/design/tokens.css`, `src/design/DESIGN.md`, and an updated layout import. It also covers structured data and docs sync.

Post-design tasks (run for any of the three paths):

- Create `public/favicon.svg` to match the identity (the template no longer ships a placeholder — write a brand-aligned SVG here so the `<link rel="icon">` tag in `BaseLayout.astro` activates)
- Update `public/manifest.webmanifest` with brand colors (`theme_color` from `--color-primary`, `background_color` from `--color-bg`)
- Run `npm run ai-images` to regenerate `apple-touch-icon.png` and `og-image.png`
- Add JSON-LD structured data to the home page (`LocalBusiness` for physical businesses, `Organization` for online-only, `Person` for personal sites)
- Build a styled home page that reflects the brand and site type
- Add `rel="me"` links to social profiles

All design edits are file changes that don't require tools to be installed yet.

## Step 2b — Photography guidance

Before collecting content, help the owner know what photos they'll need. Frame it as:

> "Before we fill in your pages, let's make sure you have the photos you'll need. Your phone camera is all you need — I'll show you exactly what to shoot."

Read and follow the photography guidance instructions in `${CLAUDE_PLUGIN_ROOT}/skills/photography/SKILL.md`. It generates a prioritized shot list based on the site type and delivers practical phone tips.

If the owner wants to skip this ("I already have photos" / "I'll figure it out later"), that's fine — move on. The photography skill is also available on demand via `/anglesite:photography`.

## Step 3 — Install tools

Your design is saved. Before running setup, present the wizard summary so the owner knows exactly what's coming.

The setup script auto-detects whether the environment supports admin/sudo access. If it doesn't (typical for Claude Cowork, web-based shells, or sandboxed containers), HTTPS preview setup is skipped entirely and the dev server runs on `http://localhost:4321` instead. No password prompts, no certificate trust dialogs — the site still works, just without a padlock locally.

Tailor your wizard summary to the environment:

- If the owner is in **Claude Cowork** (or any non-admin environment), tell them:
  "Your website design is ready! I'll install the tools to run it on your computer. Your preview will run at http://localhost:4321 — fully functional, just without the padlock icon. Ready?"

- On **macOS** (with admin access), tell the owner:
  "Here's what will happen — I'll walk you through each step:
  1. **Developer tools** — If this is your first time, macOS will pop up a window asking to install developer tools. Click **Install** and wait about a minute.
  2. **Password** — Your Mac password is needed to set up secure local preview. Type your password — nothing will appear as you type. Press Enter.
  3. **Certificate trust** — A system dialog asks to trust a local security certificate so your browser shows a padlock. Click **Allow** (or enter your password again).
  That's it — three things, and I'll tell you when each one is coming. Ready?"

- On **Linux** (with admin access), tell the owner:
  "Here's what will happen:
  1. **Password** — Your password is needed to set up secure local preview.
  2. **Certificate trust** — I'll install a local certificate so your browser shows a padlock.
  That's it — I'll walk you through each step. Ready?"

- On **Windows**, tell the owner:
  "Here's what will happen:
  1. **Certificate trust** — A Windows dialog may ask to trust a security certificate. Click **Yes**.
  2. Some steps may need Administrator access — I'll let you know.
  Ready?"

First install project dependencies (needed to run the setup script):

```sh
npm install
```

Then run the setup script:

```sh
npm run ai-setup
```

The setup script installs Xcode CLI tools, fnm, Node.js LTS, npm dependencies, the GitHub CLI, and initializes git. When admin/sudo access is available, it also installs mkcert, generates a locally-trusted HTTPS certificate, and configures hostname resolution and port forwarding. It writes `HTTPS_AVAILABLE=true|false` to `.site-config` and skips anything already present.

After setup finishes, read `HTTPS_AVAILABLE` from `.site-config`:

- If `HTTPS_AVAILABLE=true` (admin access was available), read `DEV_HOSTNAME` and tell the owner: "Everything is installed! Your website now runs securely at https://DEV_HOSTNAME — just like a real website, but only visible on your computer."
- If `HTTPS_AVAILABLE=false` (no admin access — e.g., Claude Cowork), tell the owner: "Everything is installed! Your website previews at http://localhost:4321. The local padlock isn't available in this environment, but the site is fully functional and the live version on your real domain will be HTTPS once you deploy."

If it fails, read the log:

```sh
cat ~/.anglesite/logs/setup.log
```

## Step 4 — Save a snapshot

Tell the owner: "I'm saving a snapshot of your website so you can always get back to this point."

Run `git add -A` then `git commit -m "Setup: SITE_NAME website"` (replace SITE_NAME with the actual name from `.site-config`). Do not ask the owner to run these — just do it.

## Step 5 — Back up to GitHub

Tell the owner: "Now let's back up your website to the cloud so your work is always safe, even if something happens to your computer."

First, verify that the GitHub CLI is available:

```sh
gh --version
```

If `gh` is not found, run `npm run ai-setup` to install it. If setup fails (e.g., on Windows where manual install is needed), tell the owner: "I need the GitHub CLI installed first. On Windows, run `winget install GitHub.cli` in a terminal, then let me know when it's done." Wait for confirmation before continuing.

### GitHub account

Ask: "Do you have a GitHub account, or should we create one?"

If they need one, tell them to open `https://github.com/signup` in their browser. Walk them through: pick a username, enter email, set password. Wait for them to confirm they're signed in.

### Authenticate

Tell the owner: "I need to connect your computer to GitHub. Your browser will open asking you to authorize the connection — just click **Authorize**."

```sh
gh auth login --web --git-protocol https
```

Wait for authentication to succeed. If it fails, run `gh auth status` and try again.

### Create the repository

Derive a repo name from `SITE_NAME` in `.site-config` — slugify it (lowercase, hyphens, no special characters). Create a private repo and push:

```sh
gh repo create REPO_NAME --private --source . --remote origin --push
```

This creates the private GitHub repository, adds it as the `origin` remote, and pushes the `draft` branch. The `--private` flag ensures the website source is not publicly visible.

Now create the `main` branch (used for production deploys) and push it:

```sh
git branch main
```

```sh
git push origin main
```

Stay on `draft` — all day-to-day work happens there. The `main` branch is only updated during `/anglesite:deploy`.

Save `GITHUB_REPO=OWNER/REPO_NAME` to `.site-config` using the **Write tool** (update the existing file). Get the owner/repo value by running:

```sh
gh repo view --json nameWithOwner --jq .nameWithOwner
```

### Create issue labels

Set up labels for bug tracking:

```sh
gh label create bug --description "Something is broken" --color d73a4a
gh label create accessibility --description "WCAG or usability issue" --color 0075ca
gh label create security --description "Security or privacy concern" --color e4e669
gh label create content --description "Content error or missing content" --color 0e8a16
gh label create build --description "Build or deploy failure" --color fbca04
```

Tell the owner: "Your website is backed up to GitHub! Every time we make changes, they'll be saved there automatically. If anything ever happens to your computer, your website is safe."

## Progress updates

Throughout setup, give the owner a clear sense of where they are and what's left. After each major milestone, summarize completed steps and what comes next as a short markdown checklist:

- [x] Scaffolding
- [x] Discovery interview
- [ ] Design
- [ ] Tool installation
- [ ] GitHub backup
- [ ] Preview

Update once early and again after each major milestone. Keep it tight — a 6-line list, not a paragraph.

## Step 6 — Preview

Tell the owner: "Let's see your website! Click the **Preview** button in the toolbar above — it will start your site and show it right here in the app."

The dev server is pre-configured in `.claude/launch.json`. Wait for them to confirm the preview is showing before continuing.

Once they see it: "That's your website running securely on your computer — see the https:// and the padlock? Only you can see it right now — it's not on the internet yet."

If they want to open it in a regular browser: "You can also visit https://DEV_HOSTNAME in Safari or Chrome." (Replace `DEV_HOSTNAME` with the actual value from `.site-config`.)

## Step 7 — Iterate

Ask: "What do you think? Want to change anything?"

If they want changes, make them now. If they want to redo the whole design later, they can just ask you to redo the visual identity — say something like "I want to change the design" or "let's start the design over."

**Content education prompts:** During iteration, watch for the content misconceptions in `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 4 ("Content Phase"). If the owner says "I'll write the copy later," surface `COPY_LATER`. If the homepage scope keeps expanding, surface `HOMEPAGE_OVERLOAD`. If they ask for pages "for SEO," surface `PAGE_COUNT_SEO`. Check `.site-config` for the `EDUCATION_<KEY>=shown` flag before each — only surface once.

## Step 8 — What this costs

Be upfront about costs: "Before we go further, here's what running your website costs:"

- **Hosting** — Free (Cloudflare Workers)
- **Domain name** — ~$10–15/year if you buy one (or free with the .workers.dev address)
- **Everything else** — Free. You own the code, the domain, and all your data.

## Step 9 — What you learned

Summarize what the owner now knows:

- Their website is running on their computer (the preview)
- They can write and edit blog posts using Keystatic (the visual editor in the preview)
- Changes go live with `/anglesite:deploy`
- Their website is backed up to GitHub automatically (every deploy pushes a copy)
- They own everything — code, domain name, content. No lock-in.

## Step 10 — Next steps

Tell the owner what they can do now:

- **`/anglesite:deploy`** — when ready to put the site on the internet (walks through Cloudflare account, domain purchase or transfer, and publishing). On the first deploy, if the owner has access to more than one Cloudflare account (common for agencies and freelancers), `/anglesite:deploy` shows a picker so the site is locked to the right account — no silent deploys to the wrong place later.
- **Edit posts** — navigate to `https://DEV_HOSTNAME/keystatic` in the preview panel to write blog posts using the visual editor (replace `DEV_HOSTNAME` with the actual value from `.site-config`)
- **`/anglesite:domain`** — set up email, verify your Bluesky handle, and other domain settings — available after deploying with a custom domain

No rush to publish. They can edit and preview locally as long as they like.

## Keep docs in sync

After this command, `docs/brand.md` and `docs/architecture.md` should exist and reflect the design decisions.
