Help Julia set up custom domain email so she can send from an @pairadocs.farm address using Apple Mail.

## How to communicate

Before every step that requires Julia to do something in a browser or system settings, explain what she's doing and why in plain English.

## Step 1 — Check current state

Ask Julia: "Do you already have an email address you use for the farm, or should we set up a new one at something@pairadocs.farm?"

If she already uses a Gmail or other address and wants to keep it, that's fine — skip to Step 4 (just configure Mail.app with her existing address).

## Step 2 — Add domain to iCloud

Julia needs iCloud+ (any paid tier) to use a custom email domain. Most Mac users already have this.

Tell her: "We're going to connect your farm's domain to iCloud so you can send and receive email at yourname@pairadocs.farm. This uses your existing iCloud account."

Walk her through:
1. Open **System Settings** → **Apple Account** → **iCloud** → **iCloud Mail** → **Custom Email Domain**
2. Click **Add Domain**
3. Enter `pairadocs.farm`
4. Choose whether this is for her only or her family

Apple will show DNS records that need to be added to Cloudflare.

## Step 3 — Add DNS records in Cloudflare

Tell Julia: "Now we need to tell the internet that your farm's email goes through iCloud. I'll open the Cloudflare dashboard where we'll add some records."

```sh
open https://dash.cloudflare.com
```

Walk her to the DNS settings for `pairadocs.farm`. Add the records Apple showed in the previous step. Typically:
- MX records pointing to iCloud mail servers
- TXT record for SPF
- CNAME records for DKIM

Wait for Julia to confirm each record is added. Apple's setup page will verify them — this can take a few minutes.

## Step 4 — Set up Mail.app

If Julia doesn't already have Mail.app configured with her iCloud account:
1. Open **Mail.app**
2. It should auto-detect her iCloud account
3. Verify she can send from her @pairadocs.farm address in **Mail** → **Settings** → **Accounts**

## Step 5 — Test

Tell Julia: "Let's send a test email to make sure everything works."

Have her send a test email from her new @pairadocs.farm address to herself (or to you). Confirm it arrives and the From address looks right.

## Step 6 — Save to config

Save the farm email to `.farm-config` so `/draft-email` can use it:

```sh
grep -q '^FARM_EMAIL=' .farm-config 2>/dev/null
```

If not present:
```sh
echo "FARM_EMAIL=julia@pairadocs.farm" >> .farm-config
```

Update `docs/cloudflare.md` with the DNS records that were added.

Tell Julia: "Your farm email is ready! When you use `/draft-email`, it'll open Mail.app with your farm address."
