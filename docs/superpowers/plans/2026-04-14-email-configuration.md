# Email Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Apple-first email configuration skill that guides users through business email setup, with pre-filled DNS records and a reference doc for non-Apple providers.

**Architecture:** New model-only `skills/email/SKILL.md` invoked from the domain skill when users ask for email. Apple path pre-fills iCloud MX/SPF records via Cloudflare API and walks users through DKIM/verification values. Non-Apple providers covered by `docs/email-setup.md` reference doc.

**Tech Stack:** Skill markdown (SKILL.md), Cloudflare DNS API (curl), `.site-config` for persistence.

**Spec:** `docs/superpowers/specs/2026-04-14-email-configuration-design.md`

---

### Task 1: Create the email reference doc

**Files:**
- Create: `docs/email-setup.md`

This doc is read by the email skill when users pick a non-Apple provider. It contains DNS records for each provider so the skill can add them via the Cloudflare API without looking them up dynamically.

- [ ] **Step 1: Create `docs/email-setup.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/email-setup.md
git commit -m "docs: add email provider DNS reference for non-Apple providers"
```

---

### Task 2: Create the email skill

**Files:**
- Create: `skills/email/SKILL.md`

The core deliverable. This model-only skill handles the recommendation flow, Apple path with tier routing and DNS pre-fill, and the non-Apple path via the reference doc.

- [ ] **Step 1: Create `skills/email/SKILL.md`**

```markdown
---
name: email
description: "Set up business email: Apple-first provider recommendation, DNS pre-fill, tier routing"
user-invokable: false
allowed-tools: Bash(curl *), Write, Read
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
| No / mixed | Write `EMAIL_PROVIDER=other` to `.site-config`. Read `${CLAUDE_PLUGIN_ROOT}/docs/email-setup.md`. Recommend **Fastmail** as the simplest cross-platform option. Show the other providers (Google Workspace, Proton Mail, Zoho Mail) as alternatives. Once the owner picks one, proceed to **Other provider path** below. |
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

Read `${CLAUDE_PLUGIN_ROOT}/docs/email-setup.md` for the provider's DNS records.

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
- Never modify the CNAME record for `www` — that points to the Pages project
```

- [ ] **Step 2: Commit**

```bash
git add skills/email/SKILL.md
git commit -m "feat: add model-only email skill with Apple-first provider flow"
```

---

### Task 3: Update the domain skill to delegate to the email skill

**Files:**
- Modify: `skills/domain/SKILL.md:69-98`

Replace the current email section with a handoff to the email skill.

- [ ] **Step 1: Replace the email section in `skills/domain/SKILL.md`**

Replace lines 69-98 (the entire `### Email` section, from `### Email` through the line ending with `using the **Write tool** (update the existing file).`) with:

```markdown
### Email

For email setup (business mailboxes at the owner's domain), invoke the email skill:

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/email/SKILL.md`

The email skill expects the Cloudflare API context (`CF_API_TOKEN`, `CF_ZONE_ID`) to already be available. Ensure the Cloudflare API access section above has been completed before invoking it.
```

- [ ] **Step 2: Verify the domain skill still reads correctly**

Read through `skills/domain/SKILL.md` to confirm:
- The email handoff is in the right place (after the "What do you need?" question, as one of the options)
- The Bluesky, Google verification, and other DNS sections are untouched
- No orphaned references to the old email content remain

- [ ] **Step 3: Commit**

```bash
git add skills/domain/SKILL.md
git commit -m "refactor: delegate email setup from domain skill to email skill"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:11` (skill count)
- Modify: `CLAUDE.md` (plugin structure tree, add email skill entry)
- Modify: `CLAUDE.md:144-170` (model-only skills table, add email entry)

- [ ] **Step 1: Update the skill count on line 11**

Change:
```
├── skills/                       Skills (41 total: 18 user-facing, 23 model-only)
```
To:
```
├── skills/                       Skills (42 total: 18 user-facing, 24 model-only)
```

- [ ] **Step 2: Add email to the plugin structure tree**

After the line:
```
│   ├── design-interview/SKILL.md Visual identity (model-only)
```
Add:
```
│   ├── email/SKILL.md            Business email setup, Apple-first (model-only)
```

- [ ] **Step 3: Add email to the model-only skills table**

In the model-only skills table (after line 148, the `design-interview` row), add:

```
| `email` | Business email setup: Apple-first provider recommendation, DNS pre-fill |
```

- [ ] **Step 4: Add email to the plugin structure overview in the `## Plugin structure` section**

In the file tree under `skills/`, the new entry from Step 2 should appear in alphabetical order among the other model-only skills. Verify it's placed correctly (after `design-interview`, before `animate` would be wrong — place it alphabetically: after `design-import` and before `experiment`).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add email skill to CLAUDE.md skills reference"
```

---

### Task 5: Verify everything

- [ ] **Step 1: Verify all new files exist**

```bash
ls -la skills/email/SKILL.md docs/email-setup.md
```

Expected: both files exist.

- [ ] **Step 2: Verify the domain skill handoff**

```bash
grep -n "email skill" skills/domain/SKILL.md
```

Expected: reference to `${CLAUDE_PLUGIN_ROOT}/skills/email/SKILL.md` appears in the email section.

- [ ] **Step 3: Verify CLAUDE.md skill count**

```bash
grep "Skills (42 total" CLAUDE.md
```

Expected: `Skills (42 total: 18 user-facing, 24 model-only)`

- [ ] **Step 4: Verify CLAUDE.md model-only table includes email**

```bash
grep "email.*Business email" CLAUDE.md
```

Expected: `| `email` | Business email setup: Apple-first provider recommendation, DNS pre-fill |`

- [ ] **Step 5: Verify no references to old email content remain in domain skill**

```bash
grep -n "iCloud Mail\|Fastmail\|Google Workspace\|Proton Mail" skills/domain/SKILL.md
```

Expected: no matches (these provider names now live in the email skill and reference doc, not in the domain skill).

- [ ] **Step 6: Run tests to confirm nothing is broken**

```bash
npm test
```

Expected: all tests pass. The email skill is a new markdown file — no existing tests should be affected.
