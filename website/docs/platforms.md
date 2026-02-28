# Platform Best Practices

Setup guidance and integration tips for the SaaS platforms recommended across multiple business types. Reference for the webmaster agent — read when the owner chooses a platform during `/start` or `/design-interview`. Not user-facing documentation.

Each SMB file recommends tools specific to that business type. This file covers the platforms that appear across many types — the ones the agent will set up most often. Industry-specific tools (Printavo, Jackrabbit Dance, PioneerRx, etc.) are covered only in their respective SMB files.

---

## Square

**Used by:** Nearly every business type with in-person transactions. POS, invoicing, appointments, online store, gift cards, loyalty programs.

### What to recommend

Square has many products. Match the owner's needs — don't set up everything:

| Product | Free tier | When to recommend |
|---|---|---|
| Square POS | Free (2.6% + $0.10 per tap/swipe) | Any business taking in-person payments |
| Square Online | Free (2.9% + $0.30 per transaction) | Simple online ordering or product sales |
| Square Appointments | Free for 1 staff | Salons, services, trades, healthcare — anyone booking time slots |
| Square Invoices | Free | Trades, services, photography — anyone billing after the fact |
| Square Loyalty | Paid add-on | Repeat-visit businesses: cafés, car washes, salons |
| Square Gift Cards | Per-card cost | Any business that sells gift cards |

### Website integration

- **Link, don't embed.** Square's online store and booking pages work best as linked pages, not iframes. Add a clear CTA on the website ("Book an appointment" or "Order online") that links to the Square-hosted page.
- **Keep the branding consistent.** Square allows logo, colors, and cover photo customization. Set these up during `/design-interview` to match the website design.
- **No third-party scripts.** Linking to Square (rather than embedding their JavaScript widget) keeps the website clean and avoids CSP issues. The deploy gate won't flag an external link.

### Privacy note

Square processes payment data under their own PCI compliance. The website doesn't handle card numbers. If Square is used, mention it in the privacy policy: "Payments are processed by Square. We do not store your payment information."

### Tips for the owner

- **Set up the items/services catalog first.** Square's POS, online store, and invoicing all draw from the same catalog. Getting it right once saves time.
- **Turn on email receipts.** Builds a customer list organically.
- **Use Square Dashboard on mobile.** The owner can track sales, manage appointments, and respond to invoices from their phone.

---

## Google Business Profile

**Used by:** Every business with a physical location or service area. The most impactful single action for local discoverability.

### Setup during `/start` or `/deploy`

Ask: "Have you claimed your business on Google?" If not, walk them through:

1. Go to business.google.com
2. Search for the business name (it may already exist from Google's data)
3. Claim or create the listing
4. Verify ownership (phone, email, postcard, or video — Google decides the method)
5. Complete the profile fully

### What to fill out

Every field matters for search ranking. Don't skip any:

- **Business name** — Exact legal name. Don't add keywords ("Best Pizza Springfield" — just "Joe's Pizza").
- **Category** — Primary category is the most important. Add secondary categories for other services. Be specific: "Italian restaurant" beats "restaurant."
- **Address** — Exact match to the website's address (NAP consistency — see `docs/webmaster.md`).
- **Service area** — For businesses that go to customers (trades, cleaning, mobile detailing). List specific cities or ZIP codes.
- **Hours** — Regular hours, special hours for holidays, seasonal hours. Update before every holiday. Inaccurate hours generate negative reviews faster than anything else.
- **Phone** — Primary business phone. Must match the website.
- **Website** — Link to the website. This is the #1 referral source for most local businesses.
- **Description** — 750 characters. What the business does, who it serves, what makes it different. Include the city/area name naturally. No keyword stuffing.
- **Photos** — The single biggest impact on click-through. Upload at least 5–10: storefront/exterior, interior, products/services, the team, action shots. Update photos quarterly. Listings with photos get significantly more engagement.
- **Products/services** — List specific offerings with descriptions and prices where appropriate.
- **Attributes** — Accessibility, payment methods, amenities (WiFi, parking, outdoor seating). Every relevant attribute should be set.

### Ongoing maintenance

During monthly `/check`:
- "Have you checked your Google reviews this month?" (see `docs/smb/reviews.md`)
- "Are your hours still accurate?"
- "Any new photos to add?"

During quarterly review:
- Post a Google update (like a mini blog post on the profile)
- Verify information is still accurate
- Check insights: how many people found the business, what they searched for, what actions they took

### Common mistakes

- **Duplicate listings** — If the business moved or changed names, old listings may still exist. Search for the business and claim/merge/delete duplicates.
- **Inconsistent NAP** — Name, address, and phone must be identical on the website, Google, Apple Maps, and everywhere else. "123 Main St" vs. "123 Main Street" is an inconsistency that hurts rankings.
- **Ignoring reviews** — Respond to every review, positive and negative. See `docs/smb/reviews.md`.
- **Not using Posts** — Google Business Profile has a "Posts" feature for updates, events, and offers. Most businesses don't use it. It's free visibility.

---

## Cal.com

**Used by:** Any appointment-based business — services, trades, healthcare, education, photography, events, tattoo, pet services, real estate, fitness, insurance, legal, accounting.

### When to recommend

Cal.com is the scheduling tool for businesses that book time with customers. Recommend it when:
- The owner takes appointments or consultations
- Customers need to pick a time slot
- The business doesn't already have scheduling built into their industry platform (salon software, healthcare EHR, etc.)

Don't recommend Cal.com if the business already uses Square Appointments, Fresha, Vagaro, Jane App, or another industry-specific booking tool that includes scheduling.

### Setup

1. Create a free account at cal.com
2. Set up event types matching the business's services:
   - **Consultation** (30 min) — for initial meetings
   - **Service appointment** (duration varies) — for the actual service
   - **Phone call** (15 min) — for quick questions
3. Set availability (business hours, buffer time between appointments, minimum notice)
4. Connect the owner's calendar (Google Calendar, Apple Calendar, Outlook) so double-booking is prevented
5. Customize the booking page with the business name and branding

### Website integration

- **Link from the website.** Add a "Book an appointment" button on the services page, contact page, and/or home page that links to the Cal.com booking page.
- **Use their direct link.** Each event type has a shareable URL (e.g., `cal.com/businessname/consultation`). Link directly to the relevant event type from each service page.
- **Don't embed the widget.** Cal.com offers an embed script, but embedding it adds third-party JavaScript. Linking keeps the site clean and avoids CSP issues.

### Tips for the owner

- **Set buffer time between appointments.** 15 minutes between appointments prevents back-to-back stress and accounts for cleanup/prep.
- **Set a minimum notice period.** 24 hours minimum prevents last-second bookings the owner can't prepare for.
- **Turn on email reminders.** Cal.com can send confirmation and reminder emails automatically. This reduces no-shows.
- **Use the mobile app.** The owner can see upcoming appointments and manage availability from their phone.

---

## Buttondown

**Used by:** Any business with a mailing list — farms (CSA updates), creators, musicians, podcasters, insurance, accounting, and any business that wants to email customers.

### When to recommend

Recommend Buttondown as the default newsletter platform. It's indie-run, privacy-respecting, simple, and has a free tier (up to 100 subscribers). Recommend Mailchimp only if the owner already uses it or needs the larger free tier (500 contacts).

### Setup

1. Create a free account at buttondown.email
2. Set the sender name to the business name
3. Set the reply-to address to the business email
4. Configure double opt-in (recommended — see `docs/security.md` → Newsletter double opt-in)
5. Add the physical mailing address (CAN-SPAM requirement — see `docs/smb/legal-checklist.md`)

### Website integration

- **Embed the signup form.** Buttondown provides a simple HTML form. Add it to the website footer, contact page, or a dedicated subscribe page.
- **The form is just HTML.** No JavaScript required. It submits to Buttondown's servers. Update `form-action` in the CSP (`public/_headers`) to allow `buttondown.email` as a form action destination.
- **Set expectations.** The signup form should say what people are signing up for: "Weekly farm updates and what's at market" or "Monthly business tips and news." Vague "subscribe to our newsletter" converts poorly.

### Privacy note

Buttondown is a third-party data processor for email addresses. Mention it in the privacy policy: "We use Buttondown to send our newsletter. Your email address is stored by Buttondown (buttondown.email) and is not shared with anyone else. You can unsubscribe at any time."

### Tips for the owner

- **Send consistently.** Weekly, biweekly, or monthly — pick a cadence and stick to it. Irregular emails lose subscribers.
- **Keep it short.** 200–400 words per email. A few sentences and a link to the blog post is better than a wall of text.
- **Use it for time-sensitive info.** "We're closed tomorrow for the holiday" or "New classes start Monday" — the mailing list reaches people directly when social media might not.

---

## Mailchimp

**Used by:** Businesses that already use it, or need the larger free tier (500 contacts vs. Buttondown's 100). Farms, dance studios, pharmacies, tour guides, musicians.

### When to recommend

Recommend Mailchimp only if:
- The owner already uses it and is comfortable
- The mailing list has 100–500 subscribers (beyond Buttondown's free tier but within Mailchimp's)
- The owner needs advanced features (audience segmentation, automation, A/B testing)

For new setups, prefer Buttondown — it's simpler, indie-run, and more privacy-respecting.

### Website integration

- **Embed the signup form.** Mailchimp provides embeddable forms. Use the "embedded form" option (plain HTML), not the popup or slide-in — those require JavaScript and annoy visitors.
- **Update the CSP.** Add the Mailchimp form action URL to `form-action` in `public/_headers`.
- **Don't use Mailchimp's tracking pixel.** Mailchimp adds a tracking pixel to emails by default. The owner can disable open tracking in campaign settings for better privacy.

### Privacy note

"We use Mailchimp to send our newsletter. Your email address is stored by Mailchimp (mailchimp.com), which is a US-based service. You can unsubscribe at any time." If the business has EU customers, note Mailchimp's US data processing.

### Common issues

- **Mailchimp's free tier is increasingly limited.** They've removed features from the free tier over time. If the owner hits limits, switching to Buttondown (paid tier at $9/mo) is often cheaper and simpler than Mailchimp's paid plans ($13/mo+).
- **Mailchimp adds their branding** to free-tier emails. The paid tier removes it.

---

## Yelp

**Used by:** Restaurants, salons, auto repair, services, entertainment, car washes, equipment rental — any consumer-facing local business, especially on the West Coast and in urban markets.

### Setup

1. Search for the business at biz.yelp.com
2. Claim the listing (verify by phone or email)
3. Complete the profile: hours, photos, categories, specialties, history

### Best practices

- **Don't pay for Yelp ads** unless the owner understands the ROI. Yelp's sales team is aggressive. The free listing is usually sufficient. If the owner is getting sales calls from Yelp, they can say no.
- **Respond to every review** — positive and negative. See `docs/smb/reviews.md` for response guidance.
- **Don't ask customers to review on Yelp specifically.** Yelp's algorithm filters reviews it suspects were solicited. Instead, encourage reviews in general and let customers choose the platform.
- **Photos matter.** Add professional-quality photos. Yelp users browse photos before reading reviews.
- **Keep hours accurate.** Update before every holiday and seasonal change.

### Yelp's review filter

Yelp filters reviews aggressively. Legitimate reviews get hidden. This frustrates business owners. Explain:
- "Yelp has an automated filter that hides some reviews. It's not personal — it affects all businesses. You can't control it. Focus on getting a steady stream of reviews over time."
- Filtered reviews still exist and can be seen by clicking "other reviews that are not currently recommended." They don't affect the star rating.

---

## TripAdvisor

**Used by:** Hospitality, tour guides, roadside attractions, entertainment venues, restaurants in tourist areas.

### Setup

1. Search for the business at tripadvisor.com/Owners
2. Claim the listing
3. Complete the profile: description, photos, categories, hours, pricing, contact info

### Best practices

- **Ranking is driven by recency, quantity, and quality of reviews.** A steady stream of reviews matters more than a burst. Encourage reviews after every trip/visit.
- **Respond to every review.** TripAdvisor prominently shows management responses. Professional, gracious responses to negative reviews influence future customers more than the negative review itself.
- **Update photos seasonally.** Show the experience as it currently looks — not photos from 5 years ago.
- **Use the "Traveler's Choice" badge** if earned. Display it on the website.
- **Link from the website.** Add "See our reviews on TripAdvisor" on the testimonials or contact page.

---

## HoneyBook

**Used by:** Event venues, photographers, food trucks, service businesses, freelancers — client-based businesses with proposals, contracts, and invoicing.

### When to recommend

Recommend HoneyBook (~$19/mo) when the business needs a combined tool for:
- Proposals and quotes
- Contracts and e-signatures
- Invoicing and payment collection
- Client communication workflow
- Project tracking

Don't recommend HoneyBook if the owner only needs invoicing (Square Invoices is free) or only needs scheduling (Cal.com is free).

### Website integration

- **Link to the inquiry form.** HoneyBook can generate a contact/inquiry form. Link to it from the website's contact page, or use the website's own contact form and manually enter leads into HoneyBook.
- **Don't embed HoneyBook scripts.** Link to their hosted pages instead.

### Alternative: Dubsado

Dubsado (~$20/mo) offers similar features. The choice between HoneyBook and Dubsado is largely preference:
- **HoneyBook** — Simpler, faster to learn, more opinionated workflow
- **Dubsado** — More customizable, steeper learning curve, more flexible workflows

Ask the owner: "Do you already use either of these?" If not, recommend HoneyBook for simplicity or Dubsado if the owner wants more control.

---

## Ko-fi

**Used by:** Creators, artists, photographers, musicians, podcasters — anyone accepting tips, selling digital products, or offering memberships.

### When to recommend

Recommend Ko-fi when the creator wants a simple, low-friction way for supporters to give money. Ko-fi charges zero platform fees on one-time donations (payment processor fees still apply). It's more accessible than Patreon for small creators.

| Feature | Ko-fi (free) | Ko-fi Gold ($6/mo) | Patreon |
|---|---|---|---|
| One-time donations | Free | Free | Not the primary model |
| Memberships | Limited | Full | Full (5–12% fee) |
| Shop (digital/physical) | Free | Free | Limited |
| Platform fee | None | None | 5–12% of income |

### Website integration

- **Link to the Ko-fi page.** Add a "Support us" or "Buy me a coffee" button on the website linking to `ko-fi.com/username`.
- **Don't embed the Ko-fi widget.** It adds third-party JavaScript. A styled link or button works fine.

### Alternative: Patreon

Recommend Patreon instead of Ko-fi when:
- The creator has a substantial audience ready to pay monthly
- The creator offers exclusive content tiers (bonus episodes, early access, behind-the-scenes)
- The creator's audience already expects Patreon (it's more widely recognized)

Patreon takes 5–12% of income plus payment processing. For small creators, Ko-fi is almost always the better starting point.

---

## The Knot / WeddingWire

**Used by:** Event venues, photographers, florists, equipment rental — wedding-adjacent businesses.

### When to recommend

If the business serves the wedding market, listing on The Knot and WeddingWire (both owned by the same parent company) is important for discovery. Engaged couples plan on these platforms.

### Setup

- Create a free listing (both platforms offer free tiers)
- Complete the profile: photos, pricing range, capacity, services, description
- Respond to inquiries quickly — couples contact multiple vendors and book the first responsive one

### Best practices

- **Paid advertising is expensive.** Both platforms push paid placements aggressively. The free listing is often sufficient for smaller markets. In competitive urban markets, paid placement may be necessary. Ask the owner about their budget before recommending paid tiers.
- **Reviews on these platforms matter.** Couples filter by rating. Encourage happy couples to leave reviews on The Knot or WeddingWire after the event.
- **Keep the website as the primary hub.** The Knot and WeddingWire listings should drive traffic to the website, where the owner controls the full experience. Include the website URL prominently in the profile.
- **Portfolio photos are everything.** Wedding couples browse visually. Professional photos of past events are the primary sales tool.

---

## Cross-platform tips

### Don't overload the owner

Most businesses need 2–3 platforms at most:
1. A payment/POS tool (Square)
2. A map listing (Google Business Profile)
3. One more based on their specific needs (booking, newsletter, reviews)

Don't recommend 6 platforms during `/start`. Start with the essentials and add more as the business grows.

### Link, don't embed

Every platform offers embeddable widgets. Resist the temptation. Embedded third-party JavaScript:
- Slows the page
- Adds tracking (privacy cost)
- Breaks the CSP (security cost)
- Creates maintenance burden (widget APIs change)

A styled link or button to the platform's hosted page is simpler, faster, more private, and easier to maintain. The deploy gate in `/deploy` blocks unauthorized third-party scripts — linking avoids this entirely.

### Privacy policy updates

When any platform is connected to the website, update the privacy policy to mention it as a data processor. See `docs/security.md` → Data handling and `docs/smb/legal-checklist.md` → Privacy policy.

### Keep platform info in sync

When business details change (hours, phone, address), update the website AND every connected platform. See `docs/smb/info-changes.md` for the full checklist.
