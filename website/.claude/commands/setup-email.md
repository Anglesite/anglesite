Help the site owner set up custom domain email using Apple Mail and iCloud.

Read `.site-config` for `SITE_NAME` and `SITE_DOMAIN` (if set).

## How to communicate

Before every step that requires the owner to do something in a browser or system settings, explain what they're doing and why in plain English.

## Step 1 — Check current state

Ask: "Do you already have an email address you use for the business, or should we set up a new one at your domain?"

If they already use a Gmail or other address and want to keep it, that's fine — skip to Step 4 (just configure Mail.app with their existing address).

## Step 2 — Add domain to iCloud

The owner needs iCloud+ (any paid tier) to use a custom email domain. Most Mac users already have this.

Tell them: "We're going to connect your domain to iCloud so you can send and receive email at yourname@yourdomain.com. This uses your existing iCloud account."

If `SITE_DOMAIN` is in `.site-config`, use that domain. Otherwise ask what domain they want to use for email.

Walk them through:
1. Open **System Settings** → **Apple Account** → **iCloud** → **iCloud Mail** → **Custom Email Domain**
2. Click **Add Domain**
3. Enter the domain
4. Choose whether this is for them only or their family

Apple will show DNS records that need to be added to Cloudflare.

## Step 3 — Add DNS records in Cloudflare

Tell the owner: "Now we need to tell the internet that your email goes through iCloud. I'll open the Cloudflare dashboard where we'll add some records."

```sh
open https://dash.cloudflare.com
```

Walk them to the DNS settings for their domain. Add the records Apple showed in the previous step. Typically:
- MX records pointing to iCloud mail servers
- TXT record for SPF
- CNAME records for DKIM

Wait for confirmation each record is added. Apple's setup page will verify them — this can take a few minutes.

## Step 4 — Set up Mail.app

If they don't already have Mail.app configured with their iCloud account:
1. Open **Mail.app**
2. It should auto-detect their iCloud account
3. Verify they can send from their custom domain address in **Mail** → **Settings** → **Accounts**

## Step 5 — Test

Tell the owner: "Let's send a test email to make sure everything works."

Have them send a test email from the new address to themselves. Confirm it arrives and the From address looks right.

## Step 6 — Save to config

Save the email to `.site-config` so `/draft-email` can use it:

```sh
grep -q '^SITE_EMAIL=' .site-config 2>/dev/null
```

If not present:
```sh
echo "SITE_EMAIL=name@domain.com" >> .site-config
```

Update `docs/cloudflare.md` with the DNS records that were added.

Tell the owner: "Your business email is ready! When you use `/draft-email`, it'll open Mail.app with your business address."
