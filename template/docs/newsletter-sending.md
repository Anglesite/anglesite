# Sending a Newsletter from a Blog Post

After the owner has a newsletter platform set up (Buttondown or Mailchimp), the Webmaster can send blog posts as email newsletters. This guide covers the API workflow for each platform.

## When to send

The owner decides which posts become newsletters. Not every blog post needs to be emailed — ask the owner before sending. Common patterns:

- Send every new post as a newsletter
- Send only certain tagged posts (e.g., posts tagged "newsletter" or "update")
- Send a weekly digest with links to recent posts

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

```text
NEWSLETTER_PLATFORM=buttondown
```

Do NOT store API keys in `.site-config` or any committed file. The Webmaster should ask the owner for the API key each time, or the owner can set it as an environment variable.
