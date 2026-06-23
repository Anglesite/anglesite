# Ghost Newsletter

**Used by:** Bloggers, publishers, and creators who want to send blog posts as email newsletters to subscribers. Especially useful when migrating from Ghost or Substack.

## When to recommend

Recommend Ghost as the newsletter platform when:
- The owner is migrating from Ghost and already has a running Ghost instance with subscribers
- The owner wants paid newsletter subscriptions (Ghost has built-in Stripe integration for paid memberships)
- The owner wants full control over their email infrastructure (self-hosted Ghost + Mailgun)
- The owner needs a newsletter platform that stores subscriber data on infrastructure they control

Recommend **Buttondown** instead when:
- The owner is starting fresh with no existing subscribers
- The owner wants the simplest possible setup (no server to maintain)
- The subscriber count is under 100 (Buttondown's free tier)
- The owner doesn't need paid subscriptions

## How it works

Ghost runs as a separate service (self-hosted or Ghost Pro) alongside the Anglesite website. The Anglesite site is the public website — Ghost handles only the email newsletter backend. When the owner publishes a blog post, the Webmaster can push the content to Ghost via its Admin API, which sends it as an email to all subscribers via Mailgun.

```
Owner writes post in Keystatic
        ↓
Webmaster publishes to Anglesite website
        ↓
Webmaster pushes post to Ghost Admin API (optional)
        ↓
Ghost sends email via Mailgun to subscribers
```

## Setup

### 1. Ghost instance

The owner needs a running Ghost instance. Two options:

- **Ghost Pro** (managed): Sign up at ghost.org. Starts at $9/month. No server management required.
- **Self-hosted**: Install Ghost on a VPS (DigitalOcean, Hetzner, etc.). Free software, server costs only ($5–10/month).

The Ghost instance does NOT need to be the public-facing website — it's used only as the newsletter backend. The owner can use a subdomain like `newsletter.example.com` or `mail.example.com`.

### 2. Mailgun configuration

Ghost requires Mailgun for bulk email delivery. In Ghost Admin → Settings → Email newsletter:

1. Create a Mailgun account at mailgun.com
2. Add and verify the sending domain (e.g., `mail.example.com`)
3. Enter the Mailgun API key and domain in Ghost's email settings
4. Send a test email to verify delivery

Mailgun's free tier allows 1,000 emails/month for the first 3 months, then it's pay-as-you-go (about $0.80 per 1,000 emails).

### 3. Admin API integration

Create a Custom Integration in Ghost Admin → Settings → Integrations → Add custom integration:

1. Name it "Anglesite" or the site name
2. Copy the **Admin API key** — this is used by the Webmaster to push posts
3. Note the **API URL** (the Ghost instance URL)

Store these credentials securely. The Webmaster uses them to send newsletters via the Admin API.

### 4. Newsletter configuration

In Ghost Admin → Settings → Email newsletter:

1. Set the newsletter name and description
2. Set the sender name and email address
3. Choose the email template style
4. Configure the header image (optional)
5. Set the footer content (physical address for CAN-SPAM compliance)

## Website integration

Add a newsletter signup form to the website. Ghost's member signup endpoint accepts plain HTML form submissions:

```html
<form action="https://GHOST_URL/members/api/send-magic-link/" method="POST">
  <input type="hidden" name="emailType" value="subscribe">
  <label for="email">Get updates by email:</label>
  <input type="email" name="email" id="email" required placeholder="you@example.com">
  <button type="submit">Subscribe</button>
</form>
```

Replace `GHOST_URL` with the Ghost instance URL.

**CSP update:** Add the Ghost domain to `form-action` in `public/_headers`:

```
form-action 'self' https://GHOST_URL
```

**No JavaScript required.** The form submits directly to Ghost's endpoint. Ghost handles double opt-in via magic link email automatically.

## Sending a newsletter from a blog post

See `docs/newsletter-sending.md` for the full workflow. In brief:

1. The Webmaster reads the published `.mdoc` file
2. Converts the Markdoc content to HTML
3. Pushes it to Ghost via the Admin API with the `newsletter` parameter
4. Ghost sends it to all subscribers via Mailgun
5. The Ghost post URL is added to the `syndication` frontmatter field

## Subscriber management

Subscribers are managed in Ghost Admin → Members:
- View subscriber list, filter by status (free, paid, comped)
- Export subscribers as CSV
- Import subscribers from CSV (useful for migration from Substack or other platforms)
- View email analytics (open rate, click rate)

## Privacy note

Ghost is a data processor for subscriber email addresses. Mention it in the privacy policy: "We use Ghost to send our newsletter. Your email address is stored by Ghost ([ghost instance URL]) and is not shared with anyone else. You can unsubscribe at any time via the link in every email."

If self-hosted, the owner controls the data entirely. If using Ghost Pro, Ghost (the company) is the data processor.

## Tips for the owner

- **Ghost Pro vs self-hosted**: Ghost Pro is easier but costs more. Self-hosted gives full control but requires a VPS and occasional maintenance (updates, backups). For most small businesses, Ghost Pro is the better choice.
- **Mailgun costs**: Mailgun charges per email sent. For a 500-subscriber list sending weekly, that's about 2,000 emails/month — roughly $1.60/month after the free period.
- **Don't duplicate content**: The Anglesite website is the canonical source. Ghost is only the email sending mechanism. Don't maintain content in both places.
- **Paid subscriptions**: Ghost supports paid memberships via Stripe. If the owner wants a paid newsletter, Ghost handles payment collection, access control, and subscriber management. This is Ghost's strongest differentiator from Buttondown.
