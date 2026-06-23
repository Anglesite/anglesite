# Mailchimp

**Used by:** Businesses that already use it, or need the larger free tier (500 contacts vs. Buttondown's 100). Farms, dance studios, pharmacies, tour guides, musicians.

## When to recommend

Recommend Mailchimp only if:
- The owner already uses it and is comfortable
- The mailing list has 100–500 subscribers (beyond Buttondown's free tier but within Mailchimp's)
- The owner needs advanced features (audience segmentation, automation, A/B testing)

For new setups, prefer Buttondown — it's simpler, indie-run, and more privacy-respecting.

## Website integration

- **Embed the signup form.** Mailchimp provides embeddable forms. Use the "embedded form" option (plain HTML), not the popup or slide-in — those require JavaScript and annoy visitors.
- **Update the CSP.** Add the Mailchimp form action URL to `form-action` in `public/_headers`.
- **Don't use Mailchimp's tracking pixel.** Mailchimp adds a tracking pixel to emails by default. The owner can disable open tracking in campaign settings for better privacy.

## Privacy note

"We use Mailchimp to send our newsletter. Your email address is stored by Mailchimp (mailchimp.com), which is a US-based service. You can unsubscribe at any time." If the business has EU customers, note Mailchimp's US data processing.

## Common issues

- **Mailchimp's free tier is increasingly limited.** They've removed features from the free tier over time. If the owner hits limits, switching to Buttondown (paid tier at $9/mo) is often cheaper and simpler than Mailchimp's paid plans ($13/mo+).
- **Mailchimp adds their branding** to free-tier emails. The paid tier removes it.
