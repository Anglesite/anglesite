# Newsletter setup

Connect your site to a newsletter service for email updates to subscribers.

## Supported platforms

| Platform | Free tier | Recommended for |
|---|---|---|
| Buttondown | 100 subscribers | Most businesses (simple, indie, private) |
| Mailchimp | 500 contacts | Businesses already using Mailchimp |

## What gets set up

- **Subscribe page** (`/subscribe`) — email signup form
- **Worker proxy** — protects your API key (subscribers never see it)
- **Auto-syndication** — blog posts marked with `sendNewsletter: true` are emailed on deploy
- **Subscriber count** — shown in `/anglesite:stats`

## Configuration

Stored in `.site-config`:

| Key | Purpose |
|---|---|
| `NEWSLETTER_PLATFORM` | `buttondown` or `mailchimp` |
| `SUBSCRIBE_WORKER_URL` | Worker endpoint for the subscribe form |
| `MAILCHIMP_LIST_ID` | Mailchimp audience ID (if using Mailchimp) |

Secrets stored in Cloudflare (not in code):

| Secret | Purpose |
|---|---|
| `NEWSLETTER_API_KEY` | Platform API key |
| `NEWSLETTER_PLATFORM` | Platform identifier |
| `MAILCHIMP_LIST_ID` | Audience ID (Mailchimp only) |

## Auto-syndication

To send a blog post as a newsletter, add `sendNewsletter: true` to the post's frontmatter:

```yaml
title: Spring Menu Update
description: Five new seasonal dishes
sendNewsletter: true
```

On deploy, the agent will ask before sending. After sending, the newsletter URL is added to the post's `syndication` field and `sendNewsletter` is set back to `false`.

## Privacy

Newsletter subscribers' email addresses are stored by the newsletter service (Buttondown or Mailchimp), not on your site. Mention this in your privacy policy.
