# DNS Management Workflow

Manage DNS records for the site's domain on Cloudflare.

## Prerequisites

- `SITE_DOMAIN` set in `.site-config`
- Cloudflare API token with "Edit zone DNS" permission for the domain
- Save the token as `CF_API_TOKEN` in `.site-config`

### Create an API token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use the "Edit zone DNS" template
4. Scope to the specific zone (domain)
5. Save the token to `.site-config`

### Get zone ID

```sh
curl -s "https://api.cloudflare.com/client/v4/zones?name=DOMAIN" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id'
```

## Common DNS tasks

### Email setup

Add records for your email provider (iCloud Mail, Fastmail, Google Workspace, Proton Mail, etc.):

- **MX records** — where to deliver email
- **TXT (SPF)** — prevents email spoofing
- **CNAME/TXT (DKIM)** — digital signature for email
- **TXT (DMARC)** — policy for failed authentication

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"MX","name":"@","content":"mx1.example.com","priority":10,"ttl":1,"proxied":false}'
```

Email records must always use `"proxied": false`.

### Bluesky verification

1. In Bluesky: Settings → Account → Handle → "I have my own domain"
2. Copy the `did=did:plc:...` value
3. Add TXT record:
   ```sh
   curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
     -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"type":"TXT","name":"_atproto","content":"did=did:plc:VALUE","ttl":1,"proxied":false}'
   ```
4. Return to Bluesky and verify

### Google site verification

Add the TXT or CNAME record Google provides, then verify in Google Search Console.

### View current records

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=100" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | "\(.type)\t\(.name)\t\(.content)"'
```

### Remove a record

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/RECORD_ID" \
  -X DELETE -H "Authorization: Bearer $CF_API_TOKEN"
```

## Safety rules

- Never change the CNAME record for `www` (points to Pages project)
- Never change nameservers via the API
- Remove old MX records before adding new ones when switching email providers
- Email records (MX, SPF, DKIM, DMARC) must never be proxied
- Update `docs/cloudflare.md` after any DNS change
