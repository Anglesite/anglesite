# Website Legal Checklist

Legal requirements and best practices that apply to every business website. The agent applies these during `/anglesite:design-interview` and `/anglesite:start`, on top of the business type's Compliance section.

This file covers what the **website** needs — pages, footer items, notices. Business-level legal advice (formation, insurance, contracts) is in [pre-launch.md](pre-launch.md). Industry-specific permits and licenses are in each SMB file's Compliance section.

## How to use

1. Read the owner's `BUSINESS_TYPE` from `.site-config`.
2. For each checklist item below, check if the `types:` tag includes the owner's type or `all`.
3. During `/anglesite:design-interview` or `/anglesite:start` (Step 2), ask the owner about applicable items — or just add them when no question is needed (copyright notice, accessibility statement).
4. Add the relevant pages, footer links, and notices to the site.
5. During `/anglesite:check`, verify that privacy policy, copyright notice, and accessibility statement are present.

---

## The checklist

### 1. Privacy policy

**types:** all (any site with a contact form, email signup, or analytics)

Required by law in most jurisdictions when collecting any personal data. Even a simple contact form collects names and emails. A mailing list signup collects emails. Cloudflare Analytics collects aggregate traffic data. Nearly every Anglesite site needs this.

What to include: what data is collected, how it's used, who it's shared with (if anyone), how to request deletion. For default Anglesite sites: no third-party tracking except optional Cloudflare Analytics, no data sold, contact form submissions go to the owner only, no cookies beyond essential session cookies.

**Where to add:** Dedicated page (`/privacy/`) linked from the site footer on every page.

**Ask the owner:** "Your site will have a contact form [and a mailing list signup], so we need a privacy policy page. I'll draft one — it's straightforward since your site doesn't use third-party tracking."

Don't recommend privacy policy generators that inject their own tracking or affiliate links. A simple, honest, plain-language page is better than a 10-page legal template.

---

### 2. Copyright notice

**types:** all

Standard practice. Copyright exists automatically — the notice isn't legally required but signals ownership, deters copying, and is expected by visitors.

**Where to add:** Site footer on every page.

**Format:** `© 2026 Business Name` — using the current year and `SITE_NAME` from `.site-config`.

**Ask the owner:** Nothing — just add it during site setup.

---

### 3. Accessibility statement

**types:** all (mandatory for government; strongly recommended for all)

Signals commitment to accessibility. Legally required for government websites (Section 508 / ADA Title II). For private businesses, ADA Title III litigation against websites is real and growing — an accessibility statement demonstrates good faith even if the site isn't perfectly compliant yet.

Keep it short. The most useful thing is a contact method for people who encounter barriers.

**Where to add:** Dedicated page or a section on an existing page, linked from the footer. Example: "We're committed to making this website accessible to everyone. If you have trouble using any part of this site, please contact us at [email/phone] and we'll help."

**Ask the owner:** Nothing for the basic statement — just add it. During `/anglesite:design-interview` (Step 9, accessibility), ask about audience-specific accessibility needs.

Note: WCAG AA compliance is already enforced by `/anglesite:check` and `/anglesite:deploy`. The statement is about communication, not a substitute for actual accessibility.

---

### 4. Photo and testimonial consent

**types:** all businesses that display customer photos or testimonials on the website

Using someone's photo or quote without permission creates liability — and burns trust if they find out. This isn't a page on the website — it's a practice the owner must follow. The website should credit sources where appropriate.

**Where to add:** Not a dedicated page. Mention in gallery captions ("Photo by [name]" or "Used with permission") and attribute testimonials by name (or "— Verified customer" if anonymous). Remind the owner during the `/anglesite:design-interview` gallery and testimonials discussion.

**Ask the owner:** "Do you have permission to use the photos and testimonials you want on your site? Going forward, always get written permission — even a text message saying 'yes, you can use my photo' is enough."

---

### 5. Professional disclaimer

**types:** legal, healthcare, accounting, insurance, fitness, education

Certain professions must disclaim that website content is not professional advice. The specific language varies:

- **Legal:** "This website provides general information, not legal advice. No attorney-client relationship is formed by using this site."
- **Healthcare:** "This information is for educational purposes and is not a substitute for professional medical advice. Consult your healthcare provider."
- **Accounting:** "Content on this site is informational and does not constitute tax or financial advice."
- **Insurance:** "Information provided is general in nature. Contact us for advice specific to your situation."
- **Fitness:** "Consult your physician before beginning any exercise program."

**Where to add:** Brief version in the site footer. Full version on a dedicated Disclaimer page or within the About page. The SMB file's Compliance section may have additional requirements (e.g., state bar rules for attorney advertising).

**Ask the owner:** "Does your profession require a disclaimer on your website?" If they're unsure, the answer is almost always yes for the types listed above.

---

### 6. Terms of service

**types:** businesses with online ordering, booking, deposits, or user-submitted content

Required when money changes hands through the website or when users submit content. Covers the rules of engagement: refunds, cancellations, liability limits, dispute resolution, acceptable use.

Many owners already have terms from their booking or payment platform (Square, HoneyBook, Dubsado). The website's terms should be consistent with those — not contradictory.

**Where to add:** Dedicated page (`/terms/`) linked from the footer. Reference it near checkout, booking, or deposit buttons ("By booking, you agree to our [terms of service]").

**Ask the owner:** "Do you take payments, bookings, or deposits through the website? We'll need a terms of service page." If they already have terms from their platform, use those as a starting point.

Keep it plain language. A clear 1-page terms document is better than a 20-page one nobody reads.

---

### 7. Email marketing compliance (CAN-SPAM)

**types:** all businesses with a mailing list or newsletter

CAN-SPAM (US) requires: physical mailing address in every marketing email, working unsubscribe link, honest subject lines, and identification as an ad if applicable. GDPR (for EU audience) requires explicit opt-in — not just "we added you to our list."

Most email platforms (Buttondown, Mailchimp, Square, Constant Contact) handle compliance automatically — unsubscribe links, physical address in footer, opt-in confirmation. The website's role is to set expectations at the signup form.

**Where to add:** Not a dedicated page — this is about the signup form and email platform configuration. The website signup form should say what people are signing up for: "Weekly farm updates and what's at market this week. Unsubscribe anytime."

**Ask the owner:** "Do you send marketing emails or a newsletter?" If yes, confirm their platform includes an unsubscribe link and physical address. If they're using a personal email to BCC a list — that's a compliance problem worth mentioning gently.

---

### 8. Cookie and tracking notice

**types:** all (especially if embedding third-party content)

CCPA (California) and GDPR (EU) require disclosure of tracking cookies and data collection. But Anglesite sites are privacy-first by default — no third-party JavaScript except optional Cloudflare Analytics (which is cookieless and doesn't track individuals).

**Where to add:** The privacy policy page covers cookie disclosure. A separate cookie consent banner is NOT required for sites that don't use third-party cookies. Don't add one where it isn't needed — it annoys users and implies tracking that isn't happening.

**Ask the owner:** Nothing if the site is default Anglesite configuration. If the owner wants to embed YouTube videos, Instagram feeds, or other third-party content, note that those services may set their own cookies — disclose this in the privacy policy.

**Important:** The `/anglesite:deploy` security gate already blocks unauthorized third-party scripts. If a third-party embed is approved, update the privacy policy to mention it.

---

### 9. FTC disclosure for sponsored or affiliate content

**types:** creator, any business with affiliate links or sponsored blog posts

The FTC requires clear, conspicuous disclosure of material connections — payment, free products, affiliate commissions. "#ad" or "Sponsored by [brand]" must be visible without scrolling or clicking "more."

This applies to website content (blog posts, reviews), not just social media. A disclosure policy page is not enough — the disclosure must appear in each piece of sponsored content.

**Where to add:** Inline with each sponsored post or affiliate link. Not buried in a separate page. Example: "This post contains affiliate links — I earn a small commission if you purchase through them, at no extra cost to you."

**Ask the owner:** "Do you use affiliate links or accept sponsored content on your site?" If yes, plan disclosure placement for each post type.

---

## What this checklist does NOT cover

- **Business formation, structure, insurance** → [pre-launch.md](pre-launch.md)
- **Industry-specific permits and licenses** → each SMB file's Compliance section
- **PII scanning, token scanning, third-party script blocking** → `/anglesite:deploy` security gates
- **WCAG AA accessibility testing** → `/anglesite:check` command (already enforced)
- **PCI compliance for payments** → the payment processor's responsibility (Square, Stripe, etc.)
- **State-specific laws** → too variable to cover; the checklist points to general principles
