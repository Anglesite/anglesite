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

Don't recommend privacy policy generators that inject their own tracking or affiliate links. A simple, honest, plain-language page is better than a 10-page legal template. See [legal-templates.md](legal-templates.md) for vetted free template sources.

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

Note: WCAG AA compliance is already enforced by `/anglesite:check` and `/anglesite:deploy`. The statement is about communication, not a substitute for actual accessibility. See [legal-templates.md](legal-templates.md) for the W3C WAI template.

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

Keep it plain language. A clear 1-page terms document is better than a 20-page one nobody reads. See [legal-templates.md](legal-templates.md) for free template sources.

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

### 10. Return/refund policy

**types:** businesses with ecommerce (buy-button, snipcart, shopify-buy-button, lemon-squeezy)

Required by most payment processors and builds buyer trust. Clearly states what happens if a customer wants a return, exchange, or refund. For service businesses using booking, a cancellation policy serves the same purpose.

**Where to add:** Dedicated page (`/returns/` or `/refund-policy/`) linked from the footer and referenced near checkout buttons.

**Ask the owner:** "Since you're selling through your website, we need a return/refund policy. Do you already have one? If not, I'll draft one as a starting point." See [legal-templates.md](legal-templates.md) for free template sources.

---

### 11. Shipping policy

**types:** businesses selling physical goods (snipcart, shopify-buy-button)

Sets delivery expectations: processing time, shipping methods, estimated delivery windows, and who pays for return shipping. Reduces disputes and support requests.

**Where to add:** Dedicated page (`/shipping/`) or a section within the returns/refund page. Link from the footer and from product pages.

**Ask the owner:** "What are your typical shipping times? Do you ship everywhere or just within certain areas?" Draft the policy from their answers.

---

### 12. Age verification notice

**types:** alcohol, cannabis, firearms, tobacco, vape, adult-content businesses

Legal requirement in most jurisdictions for businesses selling age-restricted products or services. The website must include a notice or gate before users can access product content.

**Where to add:** A brief notice on the homepage or a lightweight age gate before product pages. Don't build a complex verification system — a simple "You must be 21+ to purchase" notice with acknowledgment is sufficient for a website. The actual age verification happens at point of sale.

**Ask the owner:** "Your business sells age-restricted products. I'll add a notice that visitors must be of legal age. Does your state require a specific minimum age?"

---

### 13. Professional license display

**types:** contractor, electrician, plumber, cosmetologist, barber, real-estate, insurance

Many state licensing boards require the license number to be displayed on advertising — which includes websites. Even when not legally required, displaying a license number builds credibility.

**Where to add:** Footer (brief) and About page (with issuing authority). Example: "Licensed General Contractor #12345 — California CSLB"

**Ask the owner:** "Do you have a professional license or contractor license number? Many states require it to be displayed on your website."

---

### 14. GDPR data processing disclosure

**types:** all (if the site has any EU visitors and collects data via forms or newsletter)

GDPR requires explicit disclosure of what data is collected, the legal basis for processing, and the right to request deletion. For most Anglesite sites, the privacy policy covers this — but it must specifically mention GDPR rights (access, rectification, erasure, portability) if EU visitors are expected.

**Where to add:** A "For European visitors" section in the privacy policy page. Not a separate page.

**Ask the owner:** "Do you expect visitors from Europe? If so, I'll add a section to your privacy policy about their data rights under GDPR." If unsure, add it anyway — it's free insurance.

---

### 15. CCPA "Do Not Sell" notice

**types:** all (if the site has California visitors and collects any data)

CCPA requires businesses meeting certain thresholds to include a "Do Not Sell My Personal Information" notice. Most Anglesite SMB sites fall below CCPA thresholds ($25M+ revenue, 50K+ consumers' data), but a simple statement in the privacy policy builds trust regardless.

**Where to add:** A sentence in the privacy policy: "We do not sell your personal information." No separate page needed for sites below CCPA thresholds.

**Ask the owner:** Nothing — just include the statement in the privacy policy by default. Anglesite's no-third-party-JS architecture means there's genuinely nothing being sold.

---

### 16. Service cancellation/refund policy

**types:** businesses with appointment booking (booking skill configured)

Reduces no-shows and disputes. States how far in advance a booking can be cancelled, whether deposits are refundable, and what happens for late cancellations.

**Where to add:** Dedicated section on the booking page and referenced in terms of service. Link from the footer if booking is a primary feature.

**Ask the owner:** "What's your cancellation policy? For example, do you require 24-hour notice? Are deposits refundable?" Draft the policy from their answers.

---

### 17. Testimonial and endorsement disclosure

**types:** all businesses displaying testimonials, reviews, or endorsements

The FTC requires disclosure of material connections — paid testimonials, incentivized reviews, or affiliate relationships. Updated 2023 FTC endorsement guides apply to website content, not just social media.

**Where to add:** Inline with each testimonial or review. If all testimonials are genuine unpaid reviews, a brief note is still good practice: "These are reviews from real customers. We did not pay for or incentivize these reviews."

**Ask the owner:** "Did you offer any discount or incentive for these reviews? The FTC requires disclosure if so." This expands on item 9 (FTC disclosure for affiliate/sponsored content) to cover testimonials specifically.

---

## What this checklist does NOT cover

- **Business formation, structure, insurance** → [pre-launch.md](pre-launch.md)
- **Industry-specific permits and licenses** → each SMB file's Compliance section
- **PII scanning, token scanning, third-party script blocking** → `/anglesite:deploy` security gates
- **WCAG AA accessibility testing** → `/anglesite:check` command (already enforced)
- **PCI compliance for payments** → the payment processor's responsibility (Square, Stripe, etc.)
- **State-specific laws** → too variable to cover; the checklist points to general principles
