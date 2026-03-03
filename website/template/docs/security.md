# Security & Privacy

Reference for the webmaster agent. Read when building forms, adding embeds, advising the owner on account security, or handling incidents. Not user-facing documentation.

For existing security infrastructure, see "What's already in place" at the bottom.

## Contact form security

Applied when building a contact form during `/anglesite:start` or `/anglesite:design-interview`. Every business site needs a contact form — build it secure from the start.

### Spam protection

- **Honeypot field** — add to every form by default. An invisible field (hidden via CSS, not `type="hidden"`) that bots fill out but real users don't see. If the field has a value on submission, reject it silently. Zero friction, no third-party dependency, effective against most bots.
- **Cloudflare Turnstile** — add only if honeypot alone isn't enough (high-traffic sites, persistent targeted spam). Free, privacy-respecting CAPTCHA alternative. Requires a CSP update: add `challenges.cloudflare.com` to `script-src` in `public/_headers`. Get site key from the Cloudflare dashboard → Turnstile.

### Email obfuscation

Don't put raw `mailto:` links in HTML — bots scrape them within hours. Prefer a contact form over a visible email link. If the owner insists on a displayed email address, note the tradeoff: it will receive spam. Options:

- Contact form (preferred — no email exposed)
- JS-assembled email address (less accessible, screen readers may not parse it)
- Email address as an image (worst — not accessible, not copyable)

### Form submission handling

Static sites can't process form POSTs server-side. Options:

- **Cloudflare Workers** (free, 100K req/day) — recommended. The Worker receives the POST, validates inputs, and emails the owner (via MailChannels or Cloudflare Email Routing). Data stays on Cloudflare, no third party. Add rate limiting per IP in the Worker.
- **Formspree** (free tier, proprietary) — hosted form backend. Easy to set up but adds a third-party data processor. Requires CSP update for `form-action`. Disclose in privacy policy.

Whichever approach: update `public/_headers` CSP if the form submits to a different origin than `'self'`.

### Input validation

- Client-side validation for UX (required fields, email format, message length).
- Server-side validation in the Worker for security — never trust client-side alone. Validate email format, enforce message length limits (e.g., max 5000 chars), sanitize inputs before emailing.

### CSP note

`form-action 'self'` is already in `public/_headers`. Forms can only POST to the same origin by default. If using an external form backend, update this directive.

## Privacy by design

Applied whenever adding content, embeds, or data collection to the site.

### Image metadata

Photos may contain EXIF data: GPS coordinates, camera serial numbers, timestamps, even the photographer's name. Strip metadata before publishing.

- Astro's built-in image optimization strips EXIF from processed images (images imported in `.astro` or `.mdx` files).
- Images placed directly in `public/` are served as-is — EXIF intact. For these, remind the owner to strip metadata manually:
  - **macOS Preview**: Open image → Tools → Show Inspector → GPS tab → Remove Location Info
  - **ImageOptim** (free macOS app): strips metadata automatically on drag-and-drop
- During `/anglesite:check`, verify that images in `public/images/` don't contain GPS EXIF data.

### Third-party embeds

Every embed is a privacy cost. The third-party service can track visitors through the embed even if the site itself has no tracking. Document the tradeoff with the owner before adding any embed.

- **YouTube** — use `youtube-nocookie.com` instead of `youtube.com` for embeds. This reduces (but doesn't eliminate) tracking. Add `www.youtube-nocookie.com` to CSP `frame-src` in `public/_headers` when needed.
- **Maps** — OpenStreetMap is already the recommended mapping service (see `webmaster.md`). It doesn't track users. Never embed Google Maps without discussing the privacy cost with the owner.
- **Instagram / social feeds** — embedded social widgets track every visitor. Prefer static screenshots with a link to the social profile, or a simple "Follow us on Instagram" link. No tracking, same outcome.
- **Any embed** — if added, update the privacy policy (see `legal-checklist.md`) to disclose what third-party services are embedded and what data they may collect.

### Data minimization on forms

Don't collect more than needed. A contact form needs: name, email, message. Phone is optional — don't make it required unless the business genuinely needs it. Fewer fields = more submissions and less privacy risk. Every field collected is data the owner must protect.

### Newsletter double opt-in

When setting up a mailing list signup, recommend double opt-in (subscriber receives a confirmation email and must click to confirm). Most platforms (Buttondown, Mailchimp) support this. GDPR requires it for EU audiences; it's good practice regardless — prevents abuse and builds a cleaner list.

### Font loading

The scaffold uses system fonts by default — zero external requests. If the owner wants custom fonts during `/anglesite:design-interview`:

- **Self-host**: download the font files and serve from `public/fonts/` with `@font-face` in CSS.
- **Never load from Google Fonts CDN** — it sends visitor IP addresses to Google on every page load. A German court ruled this violates GDPR. Self-hosting is trivial and eliminates the issue.

### Cloudflare Analytics

Cookieless, privacy-respecting, collects no personal data. But still disclose in the privacy policy:

> "We use Cloudflare Web Analytics to understand how visitors use this site. It does not use cookies or collect personal information."

## Data handling

### Contact form data retention

The owner should know where form submissions go and how long they're kept:

- **Cloudflare Worker → email**: submissions are emailed to the owner and not stored server-side (unless the Worker uses KV storage). Data lives in the owner's email inbox.
- **Formspree**: data is stored on Formspree's servers per their retention policy. Disclose in privacy policy.
- **Airtable** (if `/anglesite:setup-customers` is used): customer data lives on Airtable's servers (US-based). Disclose in privacy policy if used. Note for EU-audience businesses: Airtable processes data in the US.

### Right to deletion

If someone contacts through the form and requests their data be deleted, the owner needs to know where the data lives: email inbox, Airtable (if used), spreadsheets, booking platforms. The privacy policy should include:

> "To request deletion of your information, contact us at [email]."

### COPPA for child-focused sites

**types:** childcare, youth-org, education

If the site collects any data from visitors who may be under 13, COPPA applies. Don't add contact forms, signups, or any data collection to child-facing pages without discussing compliance with the owner. Parental consent is required before collecting data from children.

## Owner account security

Share with the owner during `/anglesite:deploy` (Cloudflare account creation) and `/anglesite:domain` (DNS setup). Keep it brief and non-technical.

### Passwords and authentication

- **Use a strong, unique password** for Cloudflare, the domain registrar, and email. Recommend a password manager: 1Password, Bitwarden, or Apple Keychain all work.
- **Enable two-factor authentication** on Cloudflare and the domain registrar. This is the single most important security action an owner can take. A stolen password without 2FA = a stolen website.

### Domain security

- **Registrar lock** — enable it. Prevents unauthorized domain transfers. Most registrars enable this by default; verify it's on. Look for "domain lock" or "transfer lock" in the registrar dashboard.
- **WHOIS privacy** — Cloudflare Registrar includes it for free. Other registrars may charge extra — make sure it's enabled. Without it, the owner's name, address, and phone are publicly searchable.
- **Don't let the domain expire** — a lapsed domain gets bought by squatters fast. Enable auto-renew and keep payment info current. Cloudflare sends email reminders.

### Recovery plan

Tell the owner: "Write down three things and keep them somewhere safe — not on this computer:"

1. Cloudflare login email address
2. Domain registrar name and login
3. Where your 2FA recovery codes are stored

If the owner loses access, these three things are what support teams need to help.

### Shared access

Don't share passwords. If someone else manages the site:

- **Cloudflare**: invite them as a member with appropriate permissions (not Super Administrator).
- **Domain registrar**: add an authorized contact rather than sharing the login.

## Incident response

What to do when things go wrong. Reference during `/anglesite:fix` or when the owner reports a problem.

### "My site looks wrong or shows something I didn't write"

1. Check git log for unexpected changes or deploys.
2. Verify the domain DNS is pointing to the correct Cloudflare project: `dig +short DOMAIN`
3. If genuinely defaced: redeploy from the last known good commit. Run `git log`, find the good commit, check it out, rebuild and deploy.
4. Change Cloudflare password and enable 2FA if not already on.

### "I can't log into Cloudflare"

1. Use account recovery: cloudflare.com/forgot-password
2. If 2FA is locked out: contact Cloudflare support with account verification.
3. Reassure the owner: the site continues running while access is restored. Cloudflare doesn't take sites down for account issues.

### "Someone stole my domain"

1. Contact the registrar immediately. Domain theft (unauthorized transfer) has a recovery process.
2. ICANN requires a 60-day lock on newly transferred domains — act fast.
3. File an ICANN complaint if the registrar doesn't help: icann.org/compliance
4. This is why registrar lock and 2FA prevent this scenario.

### "I'm getting spam through my contact form"

1. Add Cloudflare Turnstile if not already present (see "Contact form security" above).
2. Verify the honeypot field is working — bots may have adapted to the field name.
3. Check Cloudflare's Bot Management in the dashboard (free tier includes basic bot detection).
4. Add or tighten rate limiting in the Workers form handler.

## Dependency management

For the agent, not the owner.

- `npm audit` runs during `/anglesite:check`. Fix vulnerabilities before deploying.
- `package-lock.json` must be committed — it pins exact dependency versions and prevents supply chain substitution attacks.
- `/anglesite:update` command handles quarterly dependency updates per the maintenance schedule in `webmaster.md`.
- When adding new dependencies: prefer well-maintained packages with few transitive dependencies. Check npm download counts and last publish date. Avoid packages that haven't been updated in over a year.

## What's already in place

Existing security infrastructure — don't duplicate or weaken these:

| Feature | Location | What it does |
|---|---|---|
| Content Security Policy | `public/_headers` | Restricts scripts to self + Cloudflare Insights. Blocks inline scripts, external fonts, framing. |
| Security headers | `public/_headers` | X-Frame-Options DENY, X-Content-Type-Options nosniff, strict Referrer-Policy, Permissions-Policy |
| PII scan | the `/anglesite:deploy` skill | Blocks deploy if email addresses or phone numbers found in built HTML |
| Token scan | the `/anglesite:deploy` skill | Blocks deploy if API tokens (Airtable `pat*`, Stripe `sk-*`) found in source or build |
| Third-party script scan | the `/anglesite:deploy` skill | Blocks deploy if unauthorized external `<script>` tags found |
| Keystatic leak check | the `/anglesite:deploy` skill | Blocks deploy if `/keystatic` admin routes appear in production build |
| Health checks | the `/anglesite:check` skill | Validates headers, runs npm audit, checks privacy, verifies accessibility |
| Token isolation | `~/.claude.json` | API keys stored user-local, outside the project, never in git |
| Git exclusions | `.gitignore` | Blocks `.env` and `.env.*` from version control |
| Admin route blocking | `public/robots.txt` | Disallows `/keystatic/` from search engine crawling |
| Static output | `astro.config.ts` | Zero server-side code in production — no server attack surface |
| System fonts | `src/styles/global.css` | No external font CDN requests — zero data leakage from font loading |
| OpenStreetMap | `docs/webmaster.md` | Recommended over Google Maps — no visitor tracking |
