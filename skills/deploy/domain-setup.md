# Domain setup

If they want a custom domain, surface the domain education prompts from `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 2 ("Domain Setup"). Check `.site-config` for each `EDUCATION_<KEY>=shown` flag. Share `DOMAIN_VS_WEBSITE`, `DOMAIN_RENEWAL`, `EMAIL_NOT_AUTOMATIC`, and `TLD_AND_SEO` as a natural aside before diving into options — this is the richest single moment for education. Write the flags to `.site-config` after.

Then determine the right path. Ask: "Do you already own a domain, or do you need to buy one?"

## Option A — Buy a new domain

Before searching, read `${CLAUDE_PLUGIN_ROOT}/docs/domain-guide.md` and check the owner's `BUSINESS_TYPE` in `.site-config`. The right TLD depends on who they are — co-ops should consider .coop, nonprofits should consider .org, environmental orgs should consider .eco. Some mission-aligned TLDs aren't available on Cloudflare; if the best TLD for this owner requires an external registrar, help them register there first and then point nameservers to Cloudflare (Option C below). See the domain guide for the full recommendation table.

Tell the owner: "Let's search for a domain name. Cloudflare sells domains at cost — no markup, no surprise renewals."

Open the Cloudflare domain registration page: `https://dash.cloudflare.com/?to=/:account/domains/register`

Walk them through:
1. Search for their desired domain name
2. Pick a TLD — recommend based on the domain guide and their business type, not just price
3. Complete purchase (requires payment method on Cloudflare account)
4. Wait for registration to complete (usually instant)

## Option B — Transfer an existing domain to Cloudflare

Tell the owner: "We can move your domain to Cloudflare so everything is in one place. Cloudflare charges only the registry cost — usually cheaper than other registrars."

Walk them through:
1. At their current registrar: unlock the domain and get the transfer authorization code (sometimes called EPP code or auth code)
2. Open the Cloudflare transfer page:
   Open the Cloudflare transfer page: `https://dash.cloudflare.com/?to=/:account/domains/transfer`
3. Enter the domain and auth code
4. Confirm transfer and pay (extends registration by 1 year)
5. Approve the transfer confirmation email from the current registrar

Tell the owner: "Transfers can take up to 5 days, but usually finish within a few hours. Your website will keep working during the transfer."

## Option C — Point an existing domain (keep current registrar)

Tell the owner: "We can point your domain at Cloudflare without moving it. Your domain stays where it is, but Cloudflare will handle the DNS."

Open the Cloudflare domains page: `https://dash.cloudflare.com/?to=/:account/domains`

Walk them through:
1. Click "Add a domain" (or "Add a site")
2. Enter their domain name
3. Choose the Free plan
4. Cloudflare will show two nameserver addresses
5. At their current domain registrar, change nameservers to the two Cloudflare addresses (usually under "DNS settings" or "Nameservers")

Tell the owner: "That's the only step I can't do for you — it has to be done where you bought the domain. Propagation usually takes minutes but can take up to 48 hours."

## Option D — Use a subdomain of an existing Cloudflare zone

If the domain is a subdomain (e.g., `shop.example.com`) and the parent zone (`example.com`) is already on Cloudflare, the buy/transfer/point steps don't apply. Skip straight to Step 5 — the custom domain just needs a CNAME record added to the existing zone.

Tell the owner: "Since your parent domain is already on Cloudflare, we just need to connect this subdomain to your site. I'll do that in the next step."

## After domain setup — save and update local HTTPS

Save the domain to `.site-config` using the Write tool (update the existing file, adding `SITE_DOMAIN=example.com`).

If `DEV_HOSTNAME` in `.site-config` doesn't already end with the chosen domain, update it:

1. Update `DEV_HOSTNAME=SITE_DOMAIN.local` in `.site-config` using the Write tool (e.g., `DEV_HOSTNAME=pairadocs.farm.local`)
2. Tell the owner: "I need to update your local preview to use your new domain name. The setup script will generate a new certificate — you may need to enter your password again."

```sh
npm run ai-setup
```

The setup script detects the hostname change, generates a new certificate, and updates the hosts file.
