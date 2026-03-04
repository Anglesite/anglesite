---
name: domain
description: "Manage DNS records: email, Bluesky, verification"
user-invokable: true
disable-model-invocation: true
---

Manage DNS records for the owner's domain on Cloudflare. All DNS changes are made directly via the Cloudflare API — never ask the owner to add, remove, or modify DNS records themselves. Never open the Cloudflare dashboard for DNS operations.

Before making any change, tell the owner what you're about to do and why in plain English. After each change, confirm what was done.

## Prerequisites

Read `SITE_DOMAIN` from `.site-config`. If not set, tell the owner: "You need a custom domain first. Run `/anglesite:deploy` to set one up."

Read `CF_PROJECT_NAME` from `.site-config` to identify the Cloudflare project.

## Cloudflare API access

All DNS operations use the Cloudflare API with a scoped API token.

Read `CF_API_TOKEN` from `.site-config`. If not set, the owner needs to create one (one-time setup):

Tell the owner: "To manage your domain's DNS records, I need a Cloudflare API token. I'll walk you through creating one — it takes about 30 seconds."

```sh
open "https://dash.cloudflare.com/profile/api-tokens"
```

Walk them through:
1. Click **Create Token**
2. Find the **Edit zone DNS** template and click **Use template**
3. Under Zone Resources, select **Specific zone** → their domain
4. Click **Continue to summary** → **Create Token**
5. Copy the token value shown

Save the token to `.site-config` using the **Write tool** (update the existing file, adding `CF_API_TOKEN=the-token-value`).

Then get the zone ID:

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .site-config | cut -d= -f2)
CF_ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=SITE_DOMAIN" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id')
```

Replace `SITE_DOMAIN` with the root domain (no `www.`). If the zone ID comes back null, the token may be invalid or the domain not yet active on Cloudflare.

## What do you need?

Ask: "What do you need to set up on your domain?" Common requests:

### Email

If the owner wants email at their domain (like name@yourbusiness.com), ask which email provider they use or want to use. Common options:

- **iCloud Mail** (custom domain) — Requires iCloud+ subscription. Most Mac users already have this.
- **Fastmail** — Privacy-focused, independent email provider. Paid.
- **Google Workspace** — If they already use Gmail for business.
- **Proton Mail** — Privacy-first, encrypted. Free and paid tiers.
- **Other** — Ask which provider.

Each provider publishes the DNS records they need. Look up the provider's requirements, then:

1. Tell the owner what you're adding and why:
   - **MX records** — "These tell the internet where to deliver your email."
   - **TXT record (SPF)** — "This prevents scammers from sending fake email from your domain."
   - **CNAME or TXT records (DKIM)** — "This adds a digital signature so email providers trust your messages."
   - **TXT record (DMARC)** — "This tells email providers what to do with messages that fail security checks."

2. Add each record via the API. Example for a single record:
   ```sh
   curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
     -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"type":"MX","name":"@","content":"mx1.example.com","priority":10,"ttl":1,"proxied":false}'
   ```
   Email records (MX, SPF, DKIM, DMARC) must always use `"proxied": false`.

3. After adding all records, list what you added: "I've set up your email DNS records: [list each one]. DNS changes take a few minutes to kick in — try sending yourself a test email in about 15 minutes."

Add `SITE_EMAIL=name@domain.com` to `.site-config` using the **Write tool** (update the existing file).

### Bluesky verification

To verify a custom domain as their Bluesky handle:

1. Ask the owner for their current Bluesky handle (e.g., `@user.bsky.social`)
2. Tell them: go to Bluesky Settings → Account → Handle → "I have my own domain" and read back the value shown (looks like `did=did:plc:abc123...`)
3. Tell the owner: "I'm adding a verification record to your domain so Bluesky knows it's yours."
4. Add the TXT record:
   ```sh
   curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
     -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"type":"TXT","name":"_atproto","content":"did=did:plc:VALUE","ttl":1,"proxied":false}'
   ```
5. Confirm: "Done — I added the verification record. Go back to Bluesky and click 'Verify DNS Record'. Once verified, your Bluesky handle will be your domain name — people will see @yourdomain.com instead of @user.bsky.social."

### Google site verification

For Google Search Console, Google Business Profile, or other Google services:

1. Google will provide either a TXT record or a CNAME record
2. Tell the owner: "I'm adding Google's verification record to your domain."
3. Add the record via the API (same pattern as above)
4. Confirm what was added, then tell the owner to return to Google and click verify

### Other DNS records

For any other service that needs DNS records:

1. Ask the owner what service they're connecting
2. Ask for the DNS records the service requires (they'll be in the service's setup instructions)
3. Tell the owner what you're adding and why
4. Add each record via the API
5. Confirm what was done

### View current records

If the owner wants to see what's currently set up:

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?per_page=100" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | "\(.type)\t\(.name)\t\(.content)\t(proxied: \(.proxied))"'
```

Translate the output into plain English. Example: "Your domain has 5 DNS records: your website address (www), two email routing records, a spam prevention record, and your Bluesky verification."

### Remove a record

If a record needs to be removed (e.g., switching email providers):

1. List current records to find the record ID
2. Tell the owner what you're removing and why
3. Delete it:
   ```sh
   curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/RECORD_ID" \
     -X DELETE -H "Authorization: Bearer $CF_API_TOKEN"
   ```
4. Confirm: "I removed [description]. Here's why: [reason]."

When switching email providers, always remove old MX records before adding new ones to avoid conflicts.

## After any change

Update `docs/cloudflare.md` with what was added or removed and why. Example:

```
### DNS records
- MX: iCloud Mail servers (email delivery)
- TXT (SPF): v=spf1 include:icloud.com ~all (spam prevention)
- TXT (_atproto): Bluesky domain verification
```

## Safety rules

- **Never change the CNAME record for `www`** — that points to the Pages project
- **Never change nameservers** via the API
- **When switching email providers**, remove old MX records before adding new ones
- **Email records must be DNS only** (`"proxied": false`) — MX, SPF, DKIM, DMARC should never be proxied
- **Before deleting any record**, tell the owner what you're removing and why
