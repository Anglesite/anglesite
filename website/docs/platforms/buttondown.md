# Buttondown

**Used by:** Any business with a mailing list — farms (CSA updates), creators, musicians, podcasters, insurance, accounting, and any business that wants to email customers.

## When to recommend

Recommend Buttondown as the default newsletter platform. It's indie-run, privacy-respecting, simple, and has a free tier (up to 100 subscribers). Recommend Mailchimp only if the owner already uses it or needs the larger free tier (500 contacts).

## Setup

1. Create a free account at buttondown.email
2. Set the sender name to the business name
3. Set the reply-to address to the business email
4. Configure double opt-in (recommended — see `docs/security.md` → Newsletter double opt-in)
5. Add the physical mailing address (CAN-SPAM requirement — see `docs/smb/legal-checklist.md`)

## Website integration

- **Embed the signup form.** Buttondown provides a simple HTML form. Add it to the website footer, contact page, or a dedicated subscribe page.
- **The form is just HTML.** No JavaScript required. It submits to Buttondown's servers. Update `form-action` in the CSP (`public/_headers`) to allow `buttondown.email` as a form action destination.
- **Set expectations.** The signup form should say what people are signing up for: "Weekly farm updates and what's at market" or "Monthly business tips and news." Vague "subscribe to our newsletter" converts poorly.

## Privacy note

Buttondown is a third-party data processor for email addresses. Mention it in the privacy policy: "We use Buttondown to send our newsletter. Your email address is stored by Buttondown (buttondown.email) and is not shared with anyone else. You can unsubscribe at any time."

## Tips for the owner

- **Send consistently.** Weekly, biweekly, or monthly — pick a cadence and stick to it. Irregular emails lose subscribers.
- **Keep it short.** 200–400 words per email. A few sentences and a link to the blog post is better than a wall of text.
- **Use it for time-sensitive info.** "We're closed tomorrow for the holiday" or "New classes start Monday" — the mailing list reaches people directly when social media might not.
