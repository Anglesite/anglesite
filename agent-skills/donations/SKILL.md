---
name: donations
description: "Add a donation button or page (Stripe, Liberapay, or GitHub Sponsors) with suggested amounts, recurring defaults, optional goal widget, and 501(c)(3) tax-receipt template"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm run build), Write, Read, Edit, Glob
metadata:
  author: "David W. Keith"
  version: "1.3.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Add a donation flow to the owner's site. Donations are not products — copy, recurrence, and (for nonprofits) tax-receipt semantics differ from `/anglesite:buy-button`. Use this skill when the owner wants to accept tips, ongoing support, fundraising for a goal, or 501(c)(3) charitable contributions.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Architecture decisions

- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — All three providers below are plain external redirects. No third-party JavaScript is loaded on the site.

## When to invoke this skill

- Owner says "donate", "donation", "tip jar", "support us", "fundraiser", "give"
- Owner runs a nonprofit, charity, mutual-aid project, open-source project, or creator/artist project
- Owner wants ongoing recurring support (memberships → patronage, not paywall)
- `/anglesite:add-store` routes here when the answer to "what are you selling?" is "donations" or "support"

If the owner is selling a product or service (even a single one), use `/anglesite:buy-button` or `/anglesite:add-store` instead.

## Step 1 — Understand the donation context

Ask the owner, in plain conversation:

1. **What is this for?** — a one-line description that will appear next to the button (e.g., "Support our community fridge", "Tip the artist", "Fund the documentary")
2. **One-time, recurring, or both?** — most projects benefit from offering both; recurring is the higher-lifetime-value default for ongoing work
3. **Are you a registered 501(c)(3) nonprofit (US)?** — if yes, you'll need to issue tax receipts; capture the **EIN** (Employer Identification Number) and legal entity name
4. **Is there a fundraising goal?** — optional. If yes, capture the dollar goal and what it's for (e.g., "$5,000 for new equipment")
5. **Where should the donate button(s) appear?** — a dedicated `/donate` page, the homepage, the footer, or several pages

Save what's relevant to `.site-config`:

```
DONATION_PROVIDER=stripe|liberapay|github-sponsors
DONATION_RECURRING=true|false
NONPROFIT_501C3=true|false
NONPROFIT_EIN=XX-XXXXXXX        # only if 501(c)(3)
NONPROFIT_LEGAL_NAME=...         # only if 501(c)(3)
DONATION_GOAL_AMOUNT=5000        # optional, integer USD
DONATION_GOAL_LABEL=...           # optional, what the money is for
```

## Step 2 — Choose a provider

Recommend in this priority order. Present trade-offs honestly; let the owner choose.

| Provider | Best for | Cost | Recurring | Tax receipts |
|---|---|---|---|---|
| **Stripe Payment Links** (recommended) | Most donors, all geographies, 501(c)(3) nonprofits | 2.9% + 30¢ | ✅ Yes (subscription mode) | ✅ Stripe can email receipts; nonprofit issues year-end statements |
| **Liberapay** | Open-source maintainers, creators with EU audiences | 0% (donor pays processor) | ✅ Weekly/monthly/yearly | ❌ Not a tax-receipting platform |
| **GitHub Sponsors** | Open-source maintainers with GitHub presence | 0% for individuals; org match programs vary | ✅ Monthly | ❌ Not designed for charitable receipts |

Routing rules:
- If the owner is a **501(c)(3) and wants charitable tax receipts** → Stripe (only option here that supports tax-deductible receipting cleanly). Skip the question.
- If the owner is an **open-source maintainer or creator who explicitly named GitHub or Liberapay** → use that.
- Otherwise default to **Stripe** unless the owner asks for an alternative.

Save the choice as `DONATION_PROVIDER` in `.site-config`.

---

## Path A — Stripe Payment Links (recommended)

Stripe Payment Links natively support suggested amounts, donor-chosen custom amounts, and one-time **or** recurring donations. The owner configures all of that in the Stripe Dashboard — no API keys live on the site.

### A1 — Guide the owner through Stripe Payment Link creation

If the owner doesn't have a Stripe account, explain:

> Stripe is free to set up — you only pay when you receive a donation (2.9% + 30¢). If you're a registered 501(c)(3), Stripe can apply for nonprofit pricing through their Stripe for Nonprofits program after activation. Create your account at stripe.com, then come back here.

Once they have an account, walk them through it:

> 1. Go to **Stripe Dashboard** → Payment Links → **Create payment link**
> 2. Choose **"Customers choose what to pay"** as the price model
> 3. Set **suggested amounts** (e.g., $10, $25, $50, $100) and a **minimum** (typically $1 or $5)
> 4. **For recurring donations:** create a second Payment Link, choose **"Subscription"** as the type, and offer monthly options (e.g., $5/mo, $10/mo, $25/mo). Stripe lets you create multiple links — one for one-time, one for recurring. Or use a single link with both modes if you prefer simplicity.
> 5. Under **After payment**, enable **"Automatically send a receipt"** so donors get an email confirmation
> 6. Set the product name to your project or organization name
> 7. Click **Create link** and copy the URL (it looks like `https://buy.stripe.com/...`)
> 8. Paste the URL(s) here

Wait for the Payment Link URL(s) before proceeding.

### A2 — Add the DonationButton component

The `DonationButton.astro` component already exists at `src/components/DonationButton.astro`.

For a **single button**:

```astro
---
import DonationButton from "../components/DonationButton.astro";
---

<DonationButton href="https://buy.stripe.com/OWNER_LINK" label="Donate" />
```

For **one-time + recurring side-by-side** (recommended when both are offered):

```astro
---
import DonationButton from "../components/DonationButton.astro";
---

<div class="donate-options">
  <DonationButton href="https://buy.stripe.com/OWNER_ONE_TIME" label="Donate once" />
  <DonationButton href="https://buy.stripe.com/OWNER_RECURRING" label="Donate monthly" variant="primary" />
</div>
```

Place donate buttons in context — near the description of the cause, after impact stories, or in the footer of every page if the project is donation-driven. Don't drop a donate button in isolation.

### A3 — Add the goal widget (optional)

If the owner provided `DONATION_GOAL_AMOUNT`, add the `DonationGoal.astro` component to the donate page. Because the site is static, the **raised** amount is updated manually by the owner (or by a future Stripe webhook integration — out of scope for this skill).

```astro
---
import DonationGoal from "../components/DonationGoal.astro";
---

<DonationGoal goal={5000} raised={1850} label="for new community fridge equipment" />
```

Tell the owner: "I've added the goal widget. To update the running total, edit the `raised` value on the page — I can do that for you whenever you have new numbers, or you can edit it directly in your editor."

### A4 — Add the 501(c)(3) tax-receipt language (if applicable)

If `NONPROFIT_501C3=true`, render the standard charitable contribution disclosure on the donate page. Use the values from `.site-config`:

```astro
<aside class="tax-receipt-notice">
  <p>
    {NONPROFIT_LEGAL_NAME} is a registered 501(c)(3) nonprofit organization.
    Federal tax ID (EIN): {NONPROFIT_EIN}.
    Donations are tax-deductible to the fullest extent allowed by U.S. law.
    No goods or services were provided in exchange for this contribution.
  </p>
  <p>
    You'll receive an emailed receipt from Stripe immediately after your donation.
    A year-end giving statement will be sent in January for donations totaling $250 or more.
  </p>
</aside>
```

Also create a **donation acknowledgment email template** the owner can send manually for donations of $250+ (IRS threshold for written acknowledgment). Save it as `docs/donation-receipt-template.md` in the user's project:

```markdown
# Donation acknowledgment template (501(c)(3))

Use this template when sending a year-end statement or per-donation receipt for donations of $250 or more.

---

Subject: Thank you for your tax-deductible contribution to {NONPROFIT_LEGAL_NAME}

Dear {DONOR_NAME},

Thank you for your generous donation of ${AMOUNT} on {DATE} to {NONPROFIT_LEGAL_NAME}.

This letter serves as your official receipt for tax purposes.

- Donor: {DONOR_NAME}
- Donation amount: ${AMOUNT}
- Date received: {DATE}
- Payment method: {PAYMENT_METHOD}
- Organization: {NONPROFIT_LEGAL_NAME}
- Federal tax ID (EIN): {NONPROFIT_EIN}

No goods or services were provided in exchange for this contribution. Your gift is tax-deductible to the fullest extent allowed by U.S. law.

Thank you for supporting our mission.

Sincerely,
{SIGNER_NAME}
{SIGNER_TITLE}
{NONPROFIT_LEGAL_NAME}
```

Tell the owner: "I've saved a tax-receipt template at `docs/donation-receipt-template.md`. The IRS requires written acknowledgment for donations of $250 or more — Stripe's automatic receipt covers most cases, but you'll want to send this for larger gifts and year-end statements. I'm not a tax advisor; have a CPA review your receipting practices."

---

## Path B — Liberapay

Liberapay is a non-profit, open-source recurring-donation platform popular with open-source maintainers and EU creators. Donors pay processor fees, not the recipient.

### B1 — Guide setup

> 1. Go to **liberapay.com** and create an account, then create or claim your team/project
> 2. Under your account, set your **giving goal** (weekly amount you'd like to receive) — this is optional but motivates donors
> 3. Copy your profile URL (e.g., `https://liberapay.com/your-name`)
> 4. Paste it here

### B2 — Add the button

```astro
---
import DonationButton from "../components/DonationButton.astro";
---

<DonationButton
  href="https://liberapay.com/OWNER/donate"
  label="Donate via Liberapay"
  provider="liberapay"
/>
```

The component renders an external-redirect anchor — no third-party scripts.

---

## Path C — GitHub Sponsors

For open-source maintainers with a GitHub presence.

### C1 — Guide setup

> 1. Go to **github.com/sponsors** and apply (individual or organization)
> 2. Once approved, set up tier(s) — the lowest is typically $1/mo, with optional higher tiers
> 3. Your sponsor URL is `https://github.com/sponsors/YOUR_USERNAME`
> 4. Paste it here

### C2 — Add the button

```astro
---
import DonationButton from "../components/DonationButton.astro";
---

<DonationButton
  href="https://github.com/sponsors/OWNER_USERNAME"
  label="Sponsor on GitHub"
  provider="github-sponsors"
/>
```

Also consider adding a `.github/FUNDING.yml` file at the project root if there's a public source repo — that wires up GitHub's native "Sponsor" button on the repo page. (Skill scope is the website; only do this if the owner explicitly asks.)

---

## Step 3 — Optional: dedicated donate page

If the owner wants a dedicated page (recommended for nonprofits and goal-based fundraisers), create `src/pages/donate.astro`:

```astro
---
import Layout from "../layouts/Layout.astro";
import DonationButton from "../components/DonationButton.astro";
import DonationGoal from "../components/DonationGoal.astro";
---

<Layout title="Donate">
  <h1>Support {SITE_NAME}</h1>
  <p>{ONE_LINE_CASE_FOR_GIVING}</p>

  {/* Goal widget if configured */}
  <DonationGoal goal={GOAL} raised={RAISED} label={GOAL_LABEL} />

  {/* Donation buttons */}
  <div class="donate-options">
    <DonationButton href={ONE_TIME_URL} label="Donate once" />
    <DonationButton href={RECURRING_URL} label="Give monthly" variant="primary" />
  </div>

  {/* 501(c)(3) disclosure if applicable */}
</Layout>
```

Add a navigation link to `/donate` in the site header or footer. Coordinate with `src/layouts/Layout.astro`.

## Step 4 — Verify

Run `npm run build` to confirm the site builds cleanly with the new component(s).

If the project is configured for deploys, the pre-deploy security scan will run automatically on the next `/anglesite:deploy`. All three donation providers used here are plain external links and pass the third-party-script scan without configuration.

## Notes

- Stripe Payment Links handle the entire checkout flow — no server routes, no API keys in the codebase, no PII concerns
- The donate button is a plain `<a>` tag with `target="_blank"` — accessible, works without JavaScript, prints cleanly
- Recurring is a higher-LTV default for ongoing causes; lead with it visually when both are offered
- Goal widgets on static sites are manually updated. If the owner wants automatic totals, that requires a Stripe webhook + KV worker — out of scope for this skill; file an issue if requested
- For nonprofits, Stripe offers a [Stripe for Nonprofits](https://stripe.com/nonprofits) discount program — encourage 501(c)(3) owners to apply after their account is verified
- This skill does NOT provide tax advice. If the owner runs a 501(c)(3), tell them to have a CPA or tax attorney review their receipting practices
- Donations don't currently flow through the ecommerce-webhook-worker revenue-tracking path (that's product-revenue tracking). If the owner later wants donation analytics, build it on top of Stripe's reporting or a dedicated webhook
