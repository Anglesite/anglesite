# Sending a Newsletter from a Blog Post

After the owner has a newsletter platform set up (Ghost or Buttondown), the Webmaster can send blog posts as email newsletters. This guide covers the API workflow for each platform.

## When to send

The owner decides which posts become newsletters. Not every blog post needs to be emailed — ask the owner before sending. Common patterns:
- Send every new post as a newsletter
- Send only certain tagged posts (e.g., posts tagged "newsletter" or "update")
- Send a weekly digest with links to recent posts

## Ghost Admin API

### Authentication

Ghost Admin API uses JWT tokens generated from the Admin API key. The key is in the format `ID:SECRET` (e.g., `6489...a4:d34f...b2c1`).

To create a JWT token for API authentication:

```js
// The Admin API key from Ghost Admin → Integrations
const key = 'ADMIN_API_KEY';
const [id, secret] = key.split(':');

// Create JWT with the key ID and secret
// Ghost expects: iat (issued at), exp (expiry), aud (audience = /admin/)
```

The token is sent as a Bearer token in the Authorization header.

### Sending a post as newsletter

**Step 1:** Read the blog post from `src/content/posts/SLUG.mdoc`. Convert the Markdoc content to HTML suitable for email.

**Step 2:** Push to Ghost Admin API:

```sh
curl -s -X POST "GHOST_URL/ghost/api/admin/posts/" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "posts": [{
      "title": "Post Title",
      "html": "<p>The post content as HTML...</p>",
      "status": "published",
      "email_only": true,
      "newsletter": {"slug": "default-newsletter"}
    }]
  }'
```

Key parameters:
- `status: "published"` — must be published to trigger email send
- `email_only: true` — the post exists in Ghost only as an email, not as a web page (the web version is on the Anglesite site)
- `newsletter.slug` — the newsletter to send through (usually `"default-newsletter"` — check Ghost Admin → Settings → Email newsletter for the slug)

**Step 3:** Ghost processes the post and sends it via Mailgun to all subscribed members.

**Step 4:** Add the Ghost post URL to the `syndication` field in the `.mdoc` frontmatter to preserve provenance (ADR-0006):

```yaml
syndication:
  - "https://newsletter.example.com/sent-post-slug/"
```

### Checking send status

After sending, verify delivery:

```sh
curl -s "GHOST_URL/ghost/api/admin/posts/POST_ID/" \
  -H "Authorization: Bearer JWT_TOKEN"
```

The response includes `email` object with:
- `status` — "submitted", "submitting", or "failed"
- `stats.delivered` — number of successful deliveries
- `stats.opened` — number of opens

Report these to the owner:
> "Newsletter sent! [N] subscribers will receive it. I'll check the open rate later if you'd like."

## Buttondown API

### Authentication

Buttondown uses a simple API key passed in the Authorization header. The owner gets this from buttondown.email → Settings → API.

### Sending a post as newsletter

```sh
curl -s -X POST "https://api.buttondown.email/v1/emails" \
  -H "Authorization: Token BUTTONDOWN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Post Title",
    "body": "The post content in Markdown...",
    "status": "about_to_send"
  }'
```

Key parameters:
- `subject` — the email subject line (usually the post title)
- `body` — Markdown content (Buttondown renders Markdown natively)
- `status: "about_to_send"` — sends immediately. Use `"draft"` to save without sending.

Buttondown accepts Markdown directly — no HTML conversion needed. The `.mdoc` content can be sent with minimal cleanup (strip Markdoc-specific tags if any).

### Alternative: owner sends manually

The owner can also compose newsletters directly in Buttondown's dashboard at buttondown.email. In this case, the Webmaster's role is just to suggest:
> "Your new blog post is published. Would you like to send it as a newsletter too?
> You can copy the post link and write a short intro in Buttondown, or I can send
> it through the API."

## Content preparation

When converting a blog post to newsletter format:

1. **Keep it concise.** The full post may be long. Consider sending the first few paragraphs with a "Read more on the website" link.
2. **Include the canonical URL.** Always link back to the blog post on the Anglesite website: `Read the full post at: SITE_URL/blog/SLUG`
3. **Strip interactive elements.** Remove anything that won't work in email: embedded videos (use a thumbnail + link), interactive widgets, code playgrounds.
4. **Images.** Use absolute URLs to images on the Anglesite site (`https://example.com/images/blog/...`). Email clients won't render relative paths.
5. **No tracking scripts.** Per ADR-0008, don't add tracking pixels or analytics. Ghost and Buttondown handle open/click tracking on their end.

## Storing newsletter configuration

After initial newsletter setup, store the platform choice and credentials reference in `.site-config`:

```
NEWSLETTER_PLATFORM=ghost
NEWSLETTER_API_URL=https://newsletter.example.com
```

Or:

```
NEWSLETTER_PLATFORM=buttondown
```

Do NOT store API keys in `.site-config` or any committed file. The Webmaster should ask the owner for the API key each time, or the owner can set it as an environment variable.
