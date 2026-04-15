# Email Provider Setup Reference

Reference DNS records for non-Apple email providers. The email skill reads this doc when the user picks "No / mixed" or names a specific provider, then uses the DNS records to add them via the Cloudflare API.

## Recommended: Fastmail

**What:** Privacy-focused, independent email provider. Clean interface, fast search, calendar included.
**Who it's for:** Individuals or small teams who want reliable email without the Google/Microsoft ecosystem.
**Cost:** $5/user/month (Standard) or $3/user/month (Basic)
**Setup wizard:** https://www.fastmail.com/help/receive/domains-setup-guide.html

### DNS records

| Type | Name | Value | Priority | Proxied |
|------|------|-------|----------|---------|
| MX | `@` | `in1-smtp.messagingengine.com` | 10 | false |
| MX | `@` | `in2-smtp.messagingengine.com` | 20 | false |
| TXT (SPF) | `@` | `v=spf1 include:spf.messagingengine.com ~all` | — | false |
| CNAME (DKIM) | `fm1._domainkey` | `fm1.DOMAIN.dkim.fmhosted.com` | — | false |
| CNAME (DKIM) | `fm2._domainkey` | `fm2.DOMAIN.dkim.fmhosted.com` | — | false |
| CNAME (DKIM) | `fm3._domainkey` | `fm3.DOMAIN.dkim.fmhosted.com` | — | false |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:OWNER_EMAIL` | — | false |

Replace `DOMAIN` with the owner's domain (no dots). Replace `OWNER_EMAIL` with their email address for DMARC reports.

---

## Google Workspace

**What:** Gmail, Calendar, Drive, and Docs for business. Familiar interface for Gmail users.
**Who it's for:** Businesses already using Google services or needing deep integration with Google tools.
**Cost:** $7/user/month (Business Starter)
**Setup wizard:** https://admin.google.com/ac/domains

### DNS records

| Type | Name | Value | Priority | Proxied |
|------|------|-------|----------|---------|
| MX | `@` | `aspmx.l.google.com` | 1 | false |
| MX | `@` | `alt1.aspmx.l.google.com` | 5 | false |
| MX | `@` | `alt2.aspmx.l.google.com` | 5 | false |
| MX | `@` | `alt3.aspmx.l.google.com` | 10 | false |
| MX | `@` | `alt4.aspmx.l.google.com` | 10 | false |
| TXT (SPF) | `@` | `v=spf1 include:_spf.google.com ~all` | — | false |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:OWNER_EMAIL` | — | false |

DKIM: Google generates a unique TXT record in Admin Console > Apps > Google Workspace > Gmail > Authenticate email. The owner must copy the value from there.

---

## Proton Mail

**What:** Privacy-first, end-to-end encrypted email based in Switzerland.
**Who it's for:** Businesses that prioritize privacy and data sovereignty.
**Cost:** Free (1 user, 1 GB) or $4/user/month (Mail Plus)
**Setup wizard:** https://proton.me/support/custom-domain

### DNS records

| Type | Name | Value | Priority | Proxied |
|------|------|-------|----------|---------|
| MX | `@` | `mail.protonmail.ch` | 10 | false |
| MX | `@` | `mailsec.protonmail.ch` | 20 | false |
| TXT (SPF) | `@` | `v=spf1 include:_spf.protonmail.ch ~all` | — | false |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:OWNER_EMAIL` | — | false |

DKIM: Proton generates three CNAME records in Settings > Domain > DKIM. The owner must copy the values from there.

---

## Zoho Mail

**What:** Free email hosting for small teams. Part of the Zoho productivity suite.
**Who it's for:** Budget-conscious businesses with up to 5 users.
**Cost:** Free (up to 5 users, 5 GB each) or $1/user/month (Mail Lite)
**Setup wizard:** https://www.zoho.com/mail/help/adminconsole/configure-email-delivery.html

### DNS records

| Type | Name | Value | Priority | Proxied |
|------|------|-------|----------|---------|
| MX | `@` | `mx.zoho.com` | 10 | false |
| MX | `@` | `mx2.zoho.com` | 20 | false |
| MX | `@` | `mx3.zoho.com` | 50 | false |
| TXT (SPF) | `@` | `v=spf1 include:zoho.com ~all` | — | false |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:OWNER_EMAIL` | — | false |

DKIM: Zoho generates a TXT record in Mail Admin > Domains > DKIM. The owner must copy the value from there.
