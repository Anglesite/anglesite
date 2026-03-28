---
name: syndicate
description: "Generate social media posts from a blog post for POSSE syndication"
user-invokable: false
allowed-tools: Write, Read, Glob
---

Generate ready-to-copy social media posts from a blog post. Called after blog post creation or deployment — not invoked directly by the owner.

## Architecture decisions

- [ADR-0006 IndieWeb POSSE](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0006-indieweb-posse.md) — why content is published on the site first, then syndicated to social platforms

## When to invoke this skill

Call this skill after:
- A new blog post is published via `/anglesite:deploy`
- The owner creates or edits a blog post and asks about sharing it

Do not invoke unprompted during routine edits. Offer it naturally: "You just published 'Spring Menu Update' — want me to write social media posts for it?"

## Step 1 — Read the blog post

Read the blog post's frontmatter and content from `src/content/posts/<slug>.mdx`. Extract:
- `title`
- `description`
- `tags`
- `image` (if present — suggest for Instagram)

Read `.site-config` for:
- `SITE_DOMAIN` — to construct the full post URL
- `BUSINESS_TYPE` — to tailor tone and hashtags

If `BUSINESS_TYPE` is set, read `${CLAUDE_PLUGIN_ROOT}/docs/smb/<type>.md` for industry-specific guidance on tone, audience, and relevant hashtags.

Construct the post URL: `https://SITE_DOMAIN/blog/<slug>`

## Step 2 — Generate platform content

Generate content for each platform the owner uses. Ask which platforms they're active on if you don't already know (check `.site-config` for social profile URLs or `docs/brand.md` for social accounts mentioned during design interview).

### Instagram
- Caption with the post's key message (not just the title)
- Hashtags generated from tags + industry-relevant hashtags
- No URLs (not clickable in captions)
- If the post has an `image`, suggest using it
- If no image, suggest which photo from the post or site would work
- Max 2200 characters

### Facebook
- Short, engaging text that teases the post content
- Include the post URL — Facebook generates a link preview card
- Keep under 500 characters for best engagement
- Conversational tone

### Google Business Profile
- "What's New" post format
- Focus on what's relevant to local customers
- Include the URL with "Read more:" prefix
- Max 1500 characters

### Nextdoor
- Neighborhood-friendly, conversational tone
- Frame it as sharing with neighbors, not advertising
- Include the post URL
- Mention the business location or neighborhood if known

### X (Twitter)
- Title + URL
- Must fit in 280 characters
- Add 1-2 relevant hashtags if space allows

### Bluesky
- Title + URL
- Must fit in 300 characters
- Slightly more room than X — can add a brief description if it fits

### Reddit (r/internetisbeautiful and similar)

If `BUSINESS_TYPE` includes `web-artist` and the post is about an interactive experiment:

- **Title format**: Descriptive — what the experience IS, not who made it. "An interactive particle flow that responds to your mouse" not "Check out my new project."
- **Subreddit**: r/internetisbeautiful (creative web experiences), r/generative (generative art), r/creativecoding (creative coding community)
- **Link**: Direct link to the experiment page (e.g., `https://SITE_DOMAIN/lab/<slug>`), not the blog post
- **Self-promotion rules**: Reddit requires ~10% self-promotion ratio. Note this to the owner: "Reddit communities prefer you participate regularly, not just post your own work. Share other people's work too."
- **No marketing language**: No "we built" or "our team created." Use "I made" or describe the experience in third person.

## Step 3 — Present to the owner

Present each platform's content in a clear, copy-paste-friendly format:

```
📱 Instagram:
[caption text]

📘 Facebook:
[post text]

📍 Google Business Profile:
[post text]

🏘️ Nextdoor:
[post text]

🐦 X:
[post text]

🦋 Bluesky:
[post text]
```

Tell the owner: "Here are ready-to-paste posts for each platform. Copy the ones you want to use — you can edit them before posting."

If the post has an image, add: "For Instagram and Facebook, use the image from your blog post: [image path]"

## Step 4 — Record syndication URLs

After the owner shares which platforms they posted to, ask for the URLs of each post. Update the blog post's `syndication` frontmatter:

```yaml
syndication:
  - https://www.instagram.com/p/ABC123/
  - https://www.facebook.com/page/posts/456
  - https://bsky.app/profile/user/post/789
```

These render as `u-syndication` links in the blog post's h-entry markup, creating a verifiable trail from the canonical post to its social copies.

If the owner doesn't have the URLs handy, tell them: "No rush — you can add syndication links later by editing the post in Keystatic."
