---
name: email
description: "Set up business email: Apple-first provider recommendation, DNS pre-fill, tier routing"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(curl *), Write, Read
metadata:
  author: "David W. Keith"
  version: "1.5.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "model-only"
---

Set up business email for the owner's domain. This skill is invoked by the domain skill when the owner asks for email. It handles provider recommendation, DNS record setup, and setup walkthroughs.

The Cloudflare API context (`CF_API_TOKEN`, `CF_ZONE_ID`) is already established by the domain skill before this skill is invoked. Read them from the environment or `.env` as needed.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, tell the owner what you're about to do and why in plain English before making any change.

## Returning users

Read `EMAIL_PROVIDER` from `.site-config`. If already set, skip the recommendation flow. Instead offer contextual actions:

"Your email is set up with [provider]. Need to add another mailbox, update records, or switch providers?"

If switching providers, warn: "I'll remove the old email records before adding new ones. Your email will be interrupted during the switch." Then remove old MX/SPF/DKIM records and restart the appropriate setup path.

## First-time setup

### Step 1 — Education

Read `.site-config` for `EDUCATION_EMAIL_NOT_AUTOMATIC`. If not set to `shown`, surface this:

"Having a domain doesn't automatically give you email. Email needs its own setup — DNS records that point to a mail provider. Let's get that set up now."

Write `EDUCATION_EMAIL_NOT_AUTOMATIC=shown` to `.site-config` using the **Write tool**.

### Step 2 — Provider recommendation

Ask:

> "Do you use Apple devices (iPhone, Mac) for your business?"
> - Yes
> - No / mixed
> - I already have a provider I want to use

| Answer | Action |
|--------|--------|
| Yes | Write `EMAIL_PROVIDER=apple` to `.site-config`. Continue to **Apple path** below. |
| No / mixed | Write `EMAIL_PROVIDER=other` to `.site-config`. Read `references/docs/email-setup.md`. Recommend **Fastmail** as the simplest cross-platform option. Show the other providers (Google Workspace, Proton Mail, Zoho Mail) as alternatives. Once the owner picks one, proceed to **Other provider path** below. |
| Already have a provider | Write `EMAIL_PROVIDER=other` to `.site-config`. Ask which provider. If it's in the reference doc, use those records. If not, ask the owner for the DNS records from their provider's setup instructions. Proceed to **Other provider path** below. |

## Apple path

### Tier routing

Ask:

> "Is this for you personally, or for a registered business?"
> - Personal
> - Registered business

| Answer | Tier | What to tell the owner |
|--------|------|----------------------|
| Personal | `icloud-plus` | "Great — iCloud+ includes custom domain email. You'll set it up in your iCloud settings and I'll add the DNS records here." Confirm they have an iCloud+ subscription. If not, they need to subscribe first ($0.99/month for 50 GB). |
| Registered business | `apple-business` | "Apple Business gives you email, calendar, and a company directory for free — up to 500 employees. You'll create your organization at business.apple.com and I'll add the DNS records here." |

Write `EMAIL_TIER=icloud-plus` or `EMAIL_TIER=apple-business` to `.site-config`.

### Verify domain ownership with Apple (iCloud+ tier)

**Do this before changing any DNS records.** For the `icloud-plus` tier, Apple verifies that the owner controls the domain by sending a verification email to addresses that already exist on it. If the MX records are switched to iCloud first, those verification emails can't be delivered and verification fails. Walk the owner through this step **before** the SPF conflict check and MX pre-fill below.

> Skip this section for the `apple-business` tier — Apple Business verifies ownership through the DNS-based `apple-domain-verification` TXT record (added in "Collect DKIM and verification values"), not an email flow.

Walk the owner through it:

1. Go to **iCloud.com** and sign in.
2. Open **iCloud+ features** > **Custom Email Domain** (or Account Settings > Custom Email Domain).
3. Choose **Add a domain you already own**.
4. Choose who will use the domain — **Only you** or **You and other people**.
5. Enter the domain name (the root domain from `.site-config`).
6. Enter the existing email addresses you already use at this domain (for example, `hello@yourdomain.com`). If the domain has never had email, see the note below.
7. Apple sends a **verification email to each address you entered**. Open each one and click the verification link.
8. Back in iCloud, confirm each address shows as **Verified**. If an email didn't arrive, select **Resend Verification Emails**.

> **No email at this domain yet?** If the owner has never received mail at this domain, there's no existing mailbox to receive Apple's verification email. In that case, tell them to skip entering existing addresses — Apple instead verifies ownership through the DNS records (including the `apple-domain-verification` TXT record) added in the next steps.

Only continue to the DNS steps below once Apple shows the domain (and any existing addresses) as **Verified**, **or** the owner has confirmed there are no existing addresses to verify.

### SPF conflict check

Before adding any records, check for an existing SPF TXT record:

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=TXT&name=SITE_DOMAIN" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | select(.content | startswith("v=spf1")) | .content'
```

Replace `SITE_DOMAIN` with the root domain from `.site-config`.

- **If no SPF record exists:** Create a new one: `v=spf1 include:icloud.com ~all`
- **If an SPF record exists:** Merge `include:icloud.com` into it. For example, if the existing record is `v=spf1 include:_spf.mx.cloudflare.net ~all`, update it to `v=spf1 include:icloud.com include:_spf.mx.cloudflare.net ~all`. Use a PUT request to update the existing record rather than creating a duplicate. Multiple SPF records break email delivery.

### Pre-fill MX and SPF records

Add the MX records and the SPF record (new or merged) via the Cloudflare API. These are the same for both iCloud+ and Apple Business:

```sh
# MX record 1
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"MX","name":"@","content":"mx01.mail.icloud.com","priority":10,"ttl":1,"proxied":false}'

# MX record 2
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"MX","name":"@","content":"mx02.mail.icloud.com","priority":10,"ttl":1,"proxied":false}'

# SPF (new record — if merging, use PUT with the record ID instead)
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"@","content":"v=spf1 include:icloud.com ~all","ttl":1,"proxied":false}'
```

Tell the owner: "I've added the mail routing and spam prevention records. Now I need two values from Apple."

### Collect DKIM and verification values

Walk the owner through finding the values:

**iCloud+ tier:**
1. Go to iCloud.com
2. Click **Custom Email Domain** (or Account Settings > Custom Email Domain)
3. Select your domain
4. Look for the DNS settings — you need:
   - The **DKIM CNAME record** — a hostname (like `sig1._domainkey`) and a target value
   - The **verification TXT record** — starts with `apple-domain-verification=`

**Apple Business tier:**
1. Go to business.apple.com
2. Navigate to **Domains** > your domain
3. Look for the DNS settings — you need the same two values:
   - The **DKIM CNAME record** — a hostname and a target value
   - The **verification TXT record** — starts with `apple-domain-verification=`

Ask the owner to paste each value. Then add them:

```sh
# DKIM CNAME
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"DKIM_HOSTNAME","content":"DKIM_TARGET","ttl":1,"proxied":false}'

# Verification TXT
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"@","content":"apple-domain-verification=VERIFICATION_VALUE","ttl":1,"proxied":false}'
```

Replace `DKIM_HOSTNAME`, `DKIM_TARGET`, and `VERIFICATION_VALUE` with the values the owner provided.

### Confirm and persist

Tell the owner:

"All done — here's what I set up:
- **Mail routing:** Two MX records pointing to Apple's mail servers
- **Spam prevention (SPF):** Tells other servers your domain's email is legitimate
- **Digital signature (DKIM):** Adds a cryptographic signature to outgoing mail
- **Domain verification:** Proves to Apple that you own this domain

DNS changes take a few minutes to propagate. Try sending yourself a test email in about 15 minutes."

Ask the owner for their new email address (e.g., `hello@yourdomain.com`).

Write to `.site-config` using the **Write tool**:
- `SITE_EMAIL=hello@yourdomain.com`

Update `docs/cloudflare.md` with the records that were added.

## Other provider path

Read `references/docs/email-setup.md` for the provider's DNS records.

Follow the same pattern as the Apple path:
1. Check for SPF conflicts and merge if needed
2. Add MX records via the Cloudflare API
3. Add SPF record (new or merged)
4. For DKIM: if the reference doc lists exact CNAME values (e.g., Fastmail), add them directly. If the provider generates unique values (e.g., Google Workspace, Proton Mail), walk the owner through copying them from the provider's admin interface.
5. Add DMARC record from the reference doc
6. Confirm all records, suggest test email in 15 minutes
7. Ask for the new email address and write `SITE_EMAIL` to `.site-config`
8. Update `docs/cloudflare.md`

## DNS record explanations

When `EXPLAIN_STEPS` is `true` or not set, use these plain-English explanations:

- **MX records** — "These tell the internet where to deliver your email."
- **TXT record (SPF)** — "This prevents scammers from sending fake email from your domain."
- **CNAME or TXT records (DKIM)** — "This adds a digital signature so email providers trust your messages."
- **TXT record (DMARC)** — "This tells email providers what to do with messages that fail security checks."

## Safety rules

- Email records (MX, SPF, DKIM, DMARC) must always use `"proxied": false`
- Never create duplicate SPF TXT records — merge into existing
- When switching providers, remove old MX records before adding new ones
- Never modify the CNAME record for `www` — that points to the Workers project
