# Website Handoff

How to transfer the website to another person — a new developer, a new owner, or a different platform. Reference for the webmaster agent. Applied when the owner asks about transferring, selling the business, or sunsetting the site.

## What the owner controls

The owner owns everything. There is no platform lock-in, no proprietary code, no vendor dependency. The full inventory:

| Asset | Where it lives | How to transfer |
|---|---|---|
| Website code and content | Local project folder and GitHub (private repo) | Copy the folder or clone from GitHub |
| Git history | `.git/` directory and GitHub | Included when copying the folder or cloning |
| GitHub repository | Owner's GitHub account | Add the developer as a collaborator, or transfer the repo |
| Domain name | Cloudflare Registrar (or owner's registrar) | Domain transfer or nameserver change |
| Cloudflare Pages project | Owner's Cloudflare account | Add the new person as a Cloudflare member, or redeploy from their own account |
| DNS records | Cloudflare DNS | Export/recreate in new DNS provider |
| Email routing | Cloudflare or email provider (iCloud+, Fastmail, etc.) | Reconfigure with new provider |
| Cloudflare Analytics | Owner's Cloudflare account | Not transferable (historical data stays with the account) |
| Google Business Profile | Owner's Google account | Transfer ownership in Google Business Profile settings |
| Apple Business Connect | Owner's Apple account | Transfer in Apple Business Connect settings |
| Content in Keystatic | `.mdoc` files in `src/content/` | Included in the website folder |
| Blog images | `public/images/` | Included in the website folder |
| Site configuration | `.site-config` | Included in the website folder |
| Airtable data (if used) | Owner's Airtable account | Export to CSV, or transfer Airtable workspace |

## Transferring to another developer

The most common scenario — the owner wants someone else to manage the site.

### What to give them

1. **The website folder** — The entire project directory. This contains everything needed to build, run, and deploy the site. Copy it via AirDrop, USB drive, or zip and email.
2. **Cloudflare access** — Add the developer as a member on the Cloudflare account with appropriate permissions (not Super Administrator). Go to: Cloudflare dashboard → Manage Account → Members → Invite.
3. **GitHub access** — Add the developer as a collaborator on the GitHub repository (Settings → Collaborators → Add people). They can clone it directly.
4. **Domain registrar access** — If the domain is on Cloudflare, the Cloudflare member invitation covers it. If it's on a separate registrar, add the developer as an authorized contact.
5. **`.site-config` contents** — This file contains project name, domain, email, and API keys (if any). It's in the website folder already.

### What they need to know

The new developer needs to understand:

- **How to run locally:** `npm install && npm run ai-setup && npm run dev` — runs with HTTPS at the hostname configured in `.site-config`. The setup script installs mkcert, generates a locally-trusted certificate, updates the hosts file, and configures port forwarding (443 → 4321). Works on macOS, Linux, and Windows. See `docs/local-https.md`.
- **How to build:** `npm run build`
- **How to deploy:** merge `draft` into `main` and `git push origin main` (Cloudflare auto-deploys via Git integration)
- **How to edit content:** Keystatic at `https://DEV_HOSTNAME/keystatic` while the dev server is running (read `DEV_HOSTNAME` from `.site-config`)
- **Where the docs are:** `docs/` contains all architecture and reference documentation
- **Where the commands are:** Commands are provided by the Anglesite plugin (skills like `/anglesite:start`, `/anglesite:deploy`, etc.)

### What NOT to share

- **Owner's Cloudflare password** — Use member invitations instead
- **Owner's email password** — The developer doesn't need email access
- **Owner's personal Apple ID or Google account** — Transfer Google Business Profile ownership separately

## Transferring to a new business owner

If the business is sold, the website usually goes with it.

### Step 1: Domain transfer

The new owner needs their own Cloudflare account. Transfer the domain:

1. New owner creates a free Cloudflare account
2. Current owner: unlock the domain at the registrar and get the EPP/transfer code
3. New owner: initiate transfer at Cloudflare dashboard → Domains → Transfer
4. Current owner: approve the transfer confirmation email
5. Transfer completes (usually hours, can take up to 5 days)

### Step 2: Cloudflare Pages project

Option A (simplest): Add the new owner to the existing Cloudflare account, then remove the old owner.

Option B (clean break): New owner creates a new Cloudflare Pages project and deploys from their own copy of the website folder.

### Step 3: Other accounts

Transfer ownership of:
- Google Business Profile (Settings → Managers → Transfer primary ownership)
- Apple Business Connect
- Social media accounts
- Email service (if using custom domain email)
- Booking platform, payment processor, etc.
- Airtable workspace (if used)

### Step 4: Website folder

Give the new owner:
- The complete project folder
- Instructions for running it (the README in the folder covers this)
- Any passwords or API keys stored in `.env` or `.site-config`

### Step 5: Update the site

The new owner should update:
- Business name, address, phone (if changed) — see `docs/smb/info-changes.md`
- About page with new ownership story
- Privacy policy with new contact info
- Copyright notice

## Migrating to a different platform

If the owner wants to move to WordPress, Squarespace, or another platform:

### What they keep

- **Domain** — Transfer the domain to whatever DNS/registrar the new platform requires
- **Content** — All blog posts are `.mdoc` files in `src/content/posts/`. The content is plain text with simple formatting — easy to copy into any CMS
- **Images** — All in `public/images/`. Copy to the new platform
- **Structured data** — The JSON-LD can be copied to any platform
- **Google Business Profile, Apple Maps, social media** — These are independent of the website platform

### What they lose

- **Site design** — The CSS and layout are custom. A new platform means a new design.
- **Zero-cost hosting** — Most platforms charge monthly fees
- **Privacy-first defaults** — Most platforms inject tracking scripts, third-party fonts, and cookies
- **Cloudflare security headers** — Would need to be reconfigured on the new platform
- **Git version history** — Meaningful only for developers

### Redirect plan

If the URL structure changes on the new platform, set up redirects so existing links don't break:

- Old blog post URLs should redirect to new ones (301 redirect)
- Old page URLs should redirect to their equivalents
- Google Search Console should be updated with the new sitemap

## Sunsetting a website

If the owner is closing the business and doesn't need the website anymore:

### Option A: Keep it up as an archive

- Leave the site running on Cloudflare Pages (free, no maintenance required)
- Update the home page: "Thank you for [X] years. [Business name] is now closed."
- Keep the domain active so the URL doesn't go to a squatter
- Cost: ~$10/year for the domain

### Option B: Take it down

1. **Cancel the domain auto-renewal** — Let it expire (or actively delete it at the registrar). Warning: the domain will become available for anyone to buy. Domain squatters buy expired business domains and put spam or scam sites on them.
2. **Delete the Cloudflare Pages project** — Dashboard → Pages → Project → Settings → Delete
3. **Update Google Business Profile** — Mark the business as "permanently closed"
4. **Update Apple Business Connect** — Same
5. **Keep a local backup** — The project folder is a complete archive. The owner can rebuild the site from it at any time.

### Option C: Redirect to social media

If the owner is closing but maintains a social media presence:
- Set up a redirect from the domain to their social profile
- This keeps the domain active (no squatters) and directs any remaining traffic

## Backup strategy

Regardless of handoff scenario, the owner should always have:

1. **GitHub repository** — The website is automatically backed up to a private GitHub repo on every deploy. The owner can access it at `github.com/OWNER/REPO` (check `GITHUB_REPO` in `.site-config`).
2. **A copy of the project folder** — On their computer (GitHub serves as the second copy)
3. **Access credentials written down** — Cloudflare login, GitHub login, domain registrar, 2FA recovery codes (see `docs/security.md` → Recovery plan)
4. **A recent successful build** — Run `npm run build` before any handoff to verify the site builds correctly

The project folder is the complete source of truth. If the owner has that folder (or can clone from GitHub), they can recreate everything.
