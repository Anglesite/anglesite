# Customer testimonials

Collect and display customer reviews with star ratings and Google-friendly structured data.

## How it works

1. Customer visits `/review` and submits their name, star rating, and review text
2. Turnstile verifies they're human (no CAPTCHA needed)
3. The review is emailed to you for approval — nothing is published automatically
4. You approve by adding the review as a Keystatic testimonial entry
5. Approved reviews appear on `/testimonials` with star ratings

## What Google sees

The testimonials page includes AggregateRating JSON-LD structured data. This enables rich results in Google — your star rating and review count can appear directly in search results.

## Pages

| Page | Purpose |
|---|---|
| `/review` | Submission form for customers |
| `/review/thanks` | Confirmation after submission |
| `/testimonials` | Display of approved reviews |

## Moderation

Reviews are never auto-published. Every submission is emailed to you first. To approve:
- Add it as a new testimonial in Keystatic
- Or tell your webmaster: "Add this review" and paste the email content

## Configuration

| Key | Purpose |
|---|---|
| `REVIEW_WORKER_URL` | Worker endpoint for the review form |
| `TURNSTILE_SITE_KEY` | Turnstile widget key (shared with contact form) |

## Tips

- Ask happy customers to leave a review: "We'd love your feedback at example.com/review"
- Put the review link on receipts, follow-up emails, or table tents
- Generate a QR code for the review page with `/anglesite:qr`
