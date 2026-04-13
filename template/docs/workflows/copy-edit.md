# Copy quality coaching

The agent reviews your website's text for clarity, tone, and completeness — like having a copy editor look over your shoulder.

## How it works

The agent reads every page on your site and checks for common writing issues that affect how visitors perceive your business. It looks for things like:

- **Vague headlines** that don't tell visitors what you do
- **Feature lists without benefits** — what you do matters less than why your customer should care
- **Missing calls to action** — every page should give visitors a clear next step
- **Walls of text** that are hard to read on phones
- **Inconsistent tone** — your About page and Services page should sound like the same business
- **Industry jargon** that customers might not understand

## When it runs

- Automatically during health checks (`/anglesite:check`) — surfaces 1-5 findings
- Automatically before deploys (`/anglesite:deploy`) — saves findings to `copy-edit-report.md`
- When you ask about your writing — provides a detailed, per-page review

## Brand voice

The first time the agent reviews your copy, it may ask a few questions to understand your brand's voice — things like how you'd describe your business's personality, who your ideal customer is, and what makes you different. These answers are saved in `docs/brand-voice.md` so every future review stays consistent with your style.

## What it won't do

The agent never rewrites your content without asking. It offers suggestions with explanations, and only makes changes if you approve them. Your voice is your brand — the agent helps make it clearer, not different.

## Customization

The agent adapts its suggestions to your business type. A law firm gets different tone advice than a cafe. If your business type is set in `.site-config`, the agent uses industry-specific guidance for vocabulary, tone, and content expectations.
