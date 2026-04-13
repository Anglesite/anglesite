# Social media syndication

Generate ready-to-copy social media posts from a published blog post, following the POSSE principle (Publish on your Own Site, Syndicate Elsewhere).

## How it works

After publishing a blog post, the agent can generate platform-specific versions:

| Platform | Format |
|---|---|
| Instagram | Caption with hashtags, image suggestion (no links) |
| Facebook | Short text with link for preview card |
| Google Business Profile | "What's New" post for local customers |
| Nextdoor | Neighborhood-friendly post |
| X | Title + link (280 char limit) |
| Bluesky | Title + link (300 char limit) |

## Workflow

1. Publish a blog post on your site
2. The agent generates social media content tailored to each platform
3. Copy and paste the text into each platform
4. Share the social media post URLs back so they can be recorded in the blog post's `syndication` field

## Why syndication links matter

When you add social media URLs to your blog post's `syndication` field, they create a verifiable trail from your website (the original) to each social copy. This is part of the IndieWeb approach — your site is the authoritative source, and social posts are copies that link back.

## Customization

The generated content adapts to your business type (from `.site-config`) and uses your blog post's tags for hashtags. You can always edit the generated text before posting.
