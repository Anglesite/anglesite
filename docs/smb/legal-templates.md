# Free Legal Template Sources for SMB Websites

Curated, well-regarded sources for legal page templates. These are **starting points** — every template should be reviewed by a lawyer before publishing. A basic legal review runs $300–$500 and is worth it.

The agent reads this file when creating legal pages during `/anglesite:start` or when the owner asks about privacy policies, terms, or disclaimers. Use templates as a starting framework, then customize for the owner's specific business.

---

## Privacy policy

| Source | What it covers | Limitations |
|---|---|---|
| [Termly](https://termly.io/products/privacy-policy-generator/) | Free generator, comprehensive, no tracking injected | Requires account; generated policy can be verbose |
| [FreePrivacyPolicy.com](https://www.freeprivacypolicy.com/) | Free generator with GDPR and CCPA options | Free tier is basic; upsells premium features |

**For default Anglesite sites**, a privacy policy is straightforward because the architecture is privacy-first: no third-party cookies, no tracking scripts, no data sold. The policy should cover:

- Contact form submissions (name, email, message) — stored by the owner only
- Newsletter signups (email) — managed by the email platform (Buttondown, Mailchimp)
- Cloudflare Web Analytics — cookieless, aggregate-only, no individual tracking
- No data shared with or sold to third parties

**Don't use generators that:** inject their own tracking pixels, require linking back to the generator, or add affiliate code to the generated policy.

---

## Terms of service

| Source | What it covers | Limitations |
|---|---|---|
| [Termly](https://termly.io/products/terms-and-conditions-generator/) | Free generator for basic terms | Account required; generated terms can be generic |

**When needed:** Any site that takes payments, bookings, deposits, or user-submitted content. See legal-checklist.md item 6.

**Key sections to customize:** Refund/cancellation policy, liability limits, governing jurisdiction, acceptable use. If the owner already has terms from their booking or payment platform, use those as the baseline — the website terms should be consistent, not contradictory.

---

## Return and refund policy

| Source | What it covers | Limitations |
|---|---|---|
| [Termly](https://termly.io/products/refund-policy-generator/) | Free generator for return/refund terms | Basic; may not cover service-based businesses well |
| [Shopify free generator](https://www.shopify.com/tools/policy-generator/refund) | Retail-focused return policy | Tailored to physical goods; needs adaptation for services |

**When needed:** Any site with ecommerce (buy-button, snipcart, shopify-buy-button, lemon-squeezy). Payment processors often require a visible return policy.

---

## Accessibility statement

| Source | What it covers | Limitations |
|---|---|---|
| [W3C WAI template](https://www.w3.org/WAI/planning/statements/generator/) | International standard, well-established | Can be overly formal; simplify the language |

**Always include.** Anglesite sites get an accessibility statement by default. The most useful content is a contact method for people who encounter barriers. Keep it short and honest.

---

## Professional disclaimers

No generator needed — these are short, profession-specific statements. See legal-checklist.md item 5 for standard language by profession (legal, healthcare, accounting, insurance, fitness).

**Additional professions that need disclaimers:**

| Profession | Disclaimer focus |
|---|---|
| Real estate | "Not a substitute for professional appraisal or inspection" |
| Financial planning | "Past performance does not guarantee future results" |
| Nutrition/dietetics | "Not a substitute for medical nutrition therapy from a licensed dietitian" |
| Mental health/therapy | "This site is not a crisis service. If you are in crisis, call 988" |
| Veterinary | "This information does not replace a veterinary examination" |

---

## Cookie consent / GDPR notice

**Most Anglesite sites don't need a cookie banner.** The privacy-first architecture (no third-party JS, cookieless analytics) means there are no tracking cookies to consent to. A cookie banner where none is needed annoys users and implies tracking that isn't happening.

**When a banner IS needed:** If the owner embeds YouTube videos, Instagram feeds, Google Maps, or other third-party content that sets cookies. In that case, disclose the specific third-party cookies in the privacy policy.

---

## CCPA "Do Not Sell" notice

**When needed:** Sites that collect personal information from California residents AND meet CCPA thresholds (>$25M revenue, >50K consumers' data, or >50% revenue from selling data). Most Anglesite SMB sites fall below these thresholds — but including a "We do not sell your personal information" statement in the privacy policy is free insurance and builds trust.

---

## Important reminders

1. **Templates are starting points, not legal advice.** Always recommend the owner consult a lawyer for customization — especially for licensed professions, ecommerce, and healthcare.
2. **Plain language wins.** A clear 1-page policy that people actually read beats a 20-page document nobody opens.
3. **Keep policies consistent.** Terms on the website should match terms from the booking platform, payment processor, and any signed contracts.
4. **Update annually.** Legal pages should be reviewed at least once a year or whenever the site adds new features (ecommerce, newsletter, booking).
5. **Don't copy competitors' policies.** Their business, jurisdiction, and data practices differ. Use templates designed for customization.
