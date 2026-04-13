---
name: newsletter
description: "Set up email newsletter with Buttondown, subscribe form, and auto-syndication"
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(curl *), Bash(grep *), Write, Read, Edit, Glob
disable-model-invocation: true
---

Connect the site to a newsletter service (Buttondown recommended, Mailchimp supported). Sets up a subscribe form, optional auto-syndication of blog posts, and subscriber count reporting.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — subscribe form uses a Cloudflare Worker proxy, no client-side JS from newsletter services
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the owner controls the newsletter account and subscriber list

Read the existing newsletter platform guide: `${CLAUDE_PLUGIN_ROOT}/docs/platforms/buttondown.md`
Read the newsletter sending guide: `docs/newsletter-sending.md`

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Choose a platform

Ask the owner: "Do you want to send email newsletters to your customers? It's a great way to stay in touch."

If yes, ask: "Do you already use a newsletter service, or should we set one up?"

- **Buttondown** (recommended default) — free up to 100 subscribers, indie-run, privacy-respecting, simple
- **Mailchimp** — free up to 500 contacts, widely used, more features

Save to `.site-config` as `NEWSLETTER_PLATFORM=buttondown` (or `mailchimp`) using the Write tool.

## Step 1 — Platform setup

### Buttondown

Guide the owner:
1. Sign up at `https://buttondown.email`
2. Set sender name to their business name
3. Set reply-to to their business email
4. Enable double opt-in (Settings → Subscribers)
5. Add mailing address (CAN-SPAM requirement)
6. Go to Settings → API → copy the API key

### Mailchimp

Guide the owner:
1. Sign up at `https://mailchimp.com`
2. Create an audience (list)
3. Go to Account → Extras → API keys → create a key
4. Note the Audience ID (Audience → Settings → Audience name and defaults → Audience ID)

Save `MAILCHIMP_LIST_ID` to `.site-config` if using Mailchimp.

## Step 2 — Deploy the subscribe Worker

Tell the owner: "I'm setting up a subscribe form that protects your API key — subscribers' emails go through your Cloudflare account, not directly to the newsletter service."

Store secrets:

```sh
npx wrangler secret put NEWSLETTER_API_KEY --name newsletter-subscribe
```

Tell the owner to paste their API key when prompted.

```sh
npx wrangler secret put NEWSLETTER_PLATFORM --name newsletter-subscribe
```

Paste the platform name (buttondown or mailchimp).

If Mailchimp:

```sh
npx wrangler secret put MAILCHIMP_LIST_ID --name newsletter-subscribe
```

Deploy:

```sh
npx wrangler deploy --config worker/subscribe-wrangler.toml
```

After deployment, save the Worker URL to `.site-config` as `SUBSCRIBE_WORKER_URL`.

Create `worker/subscribe-wrangler.toml` if it doesn't exist:

```toml
name = "newsletter-subscribe"
main = "subscribe-worker.js"
compatibility_date = "2024-01-01"
```

## Step 3 — Add the subscribe page

The template includes `src/pages/subscribe.astro`. Update it with the Worker URL from `.site-config`.

Create `src/pages/subscribe/thanks.astro` for the confirmation page.

Update `public/_headers` CSP `form-action` to include the Worker URL.

## Step 4 — Auto-syndication setup

Tell the owner: "When you write a blog post, you can mark it to be sent as a newsletter. I'll send it to your subscribers when you deploy."

Explain: "In your blog post frontmatter, set `sendNewsletter: true` to send it to subscribers on the next deploy. Posts without this flag won't be emailed."

The deploy skill should check for posts with `sendNewsletter: true` that haven't been syndicated yet (no newsletter URL in `syndication`). For each:

1. Read the post content
2. Format it for email (description + read-more link)
3. Send via the newsletter API:

For Buttondown:

```sh
curl -s -X POST "https://api.buttondown.email/v1/emails" \
  -H "Authorization: Token NEWSLETTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject": "POST_TITLE", "body": "MARKDOWN_CONTENT", "status": "about_to_send"}'
```

4. Update the post's `syndication` field with the newsletter URL
5. Set `sendNewsletter: false` to prevent re-sending

**Important:** Always ask the owner before sending. "This post is marked for newsletter — want me to send it to your subscribers now?"

## Step 5 — Subscriber count

Read subscriber count for reporting in `/anglesite:stats`:

For Buttondown:

```sh
curl -s "https://api.buttondown.email/v1/subscribers?type=regular" \
  -H "Authorization: Token NEWSLETTER_API_KEY" | jq '.count'
```

For Mailchimp:

```sh
curl -s "https://DATACENTER.api.mailchimp.com/3.0/lists/LIST_ID?fields=stats.member_count" \
  -H "Authorization: Bearer MAILCHIMP_API_KEY"
```

Report: "Newsletter: 42 subscribers."

## Step 6 — Verify

Build the site:

```sh
npm run build
```

Tell the owner: "Your newsletter is set up! Here's what we have:"
- A `/subscribe` page where visitors can sign up
- Blog posts with `sendNewsletter: true` will be emailed on deploy
- Subscriber count shows up in `/anglesite:stats`

Suggest adding a subscribe link to the site navigation.
