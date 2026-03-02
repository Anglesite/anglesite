Manage DNS records for the owner's domain on Cloudflare. This covers email setup, domain verification (Bluesky, Google, etc.), and any other DNS needs.

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Prerequisites

Read `SITE_DOMAIN` from `.site-config`. If not set, tell the owner: "You need a custom domain first. Run `/deploy` to set one up."

Read `CF_PROJECT_NAME` from `.site-config` to identify the Cloudflare project.

## What do you need?

Ask: "What do you need to set up on your domain?" Common requests:

### Email

If the owner wants email at their domain (like name@yourbusiness.com), ask which email provider they use or want to use. Common options:

- **iCloud Mail** (custom domain) — Requires iCloud+ subscription. Most Mac users already have this.
- **Fastmail** — Privacy-focused, independent email provider. Paid.
- **Google Workspace** — If they already use Gmail for business.
- **Proton Mail** — Privacy-first, encrypted. Free and paid tiers.
- **Other** — Ask which provider.

Each provider has specific DNS records. Walk the owner through:

1. Find the provider's DNS setup instructions (they all publish these)
2. Open the Cloudflare DNS dashboard:
   ```sh
   open https://dash.cloudflare.com/?to=/:account/:zone/dns/records
   ```
3. Add the required records. Typical email DNS records:
   - **MX records** — Tell the internet where to deliver mail
   - **TXT record (SPF)** — Prevents spoofing (says who can send from this domain)
   - **CNAME or TXT records (DKIM)** — Email signature verification
   - **TXT record (DMARC)** — Policy for handling failed authentication

Tell the owner what each record does in plain English. Don't just add records silently.

After adding records, tell the owner: "DNS changes can take a few minutes to kick in. Try sending yourself a test email in about 15 minutes."

Add `SITE_EMAIL=name@domain.com` to `.site-config` using the **Write tool** (update the existing file).

### Bluesky verification

To verify a custom domain as their Bluesky handle:

1. Ask the owner for their current Bluesky handle (e.g., `@user.bsky.social`)
2. In Bluesky: Settings → Account → Handle → "I have my own domain"
3. Bluesky will show a TXT record to add. It looks like: `did=did:plc:abc123...`
4. Open Cloudflare DNS:
   ```sh
   open https://dash.cloudflare.com/?to=/:account/:zone/dns/records
   ```
5. Add a TXT record:
   - **Name:** `_atproto`
   - **Content:** the `did=did:plc:...` value from Bluesky
6. Back in Bluesky, click "Verify DNS Record"

Tell the owner: "Once verified, your Bluesky handle will be your domain name — people will see @yourdomain.com instead of @user.bsky.social."

### Google site verification

For Google Search Console, Google Business Profile, or other Google services:

1. Google will provide either a TXT record or a CNAME record
2. Open Cloudflare DNS and add it
3. Return to Google and click verify

### Other DNS records

For any other service that needs DNS records:

1. Ask the owner what service they're connecting
2. Ask for the DNS records the service requires (they should be in the service's setup instructions)
3. Open Cloudflare DNS and add them
4. Explain what each record does

### View current records

If the owner wants to see what's currently set up:

Tell the owner: "I'll open your domain's DNS settings in Cloudflare so we can see what's there."

```sh
open https://dash.cloudflare.com/?to=/:account/:zone/dns/records
```

Walk through what each record does in plain English.

## After any change

Update `docs/cloudflare.md` with what was added and why. Example:

```
### DNS records added
- MX: iCloud Mail servers (email delivery)
- TXT (SPF): v=spf1 include:icloud.com ~all
- TXT (_atproto): Bluesky domain verification
```

## Common mistakes to avoid

- **Don't change the CNAME record for `www`** — that points to the Pages project
- **Don't change nameservers** — the domain is already on Cloudflare
- **Don't add conflicting MX records** — if switching email providers, remove the old MX records first
- **Proxy (orange cloud) vs DNS only (grey cloud)** — Email records (MX, SPF, DKIM) should always be DNS only (grey cloud). Web records should be proxied (orange cloud).
