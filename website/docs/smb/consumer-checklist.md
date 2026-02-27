# Consumer-Facing Page Checklist

Details that customers expect to find on a local business website. The agent applies these on top of the business type's Pages section during `/design-interview` and `/start`.

This file supplements the individual SMB docs. The SMB doc says *which pages to build* — this checklist says *what details consumers expect on those pages*.

## How to use

1. Read the owner's `BUSINESS_TYPE` from `.site-config`.
2. For each checklist item below, check if the `types:` tag includes the owner's type or `all`.
3. During `/design-interview` (content priorities) or `/start` (Step 2), ask the owner about each applicable item.
4. Add the information to the relevant page. If the SMB doc already covers the item (e.g., campground already mentions pet policy), skip it.

---

## The checklist

### 1. Payment methods accepted

**types:** all (especially farm, salon, repair, trades, tattoo, florist, food-bank)

"We accept cash, all major credit cards, and Apple Pay." Consumers avoid businesses where they're unsure about payment. Farmers market vendors, mobile businesses, and trades people especially — customers want to know before they show up.

**Where to add:** Contact page footer, or a "Visit us" section on the Hours/Location page.

**Ask the owner:** "What forms of payment do you accept?"

---

### 2. Parking and finding you

**types:** all businesses with a physical location

Beyond the street address: "Free parking behind the building," "metered street parking on Main St," "we're in Suite 204 — take the elevator," "look for the blue awning." Businesses in strip malls, shared buildings, downtown areas, or non-obvious locations lose customers who can't find them or don't know where to park.

Embed a map on the contact or location page. Use OpenStreetMap (privacy-friendly, no third-party JS) or link to all three platforms so the customer can use their preferred app: Google Maps, Apple Maps, or OpenStreetMap. See `docs/webmaster.md` → Map listings for how to claim the business on each.

**Where to add:** Hours/Location page, or a "Getting here" section on the Contact page.

**Ask the owner:** "Is your business easy to find? Is parking available? Any tips for first-time visitors? Have you claimed your business on Google Maps, Apple Maps, and OpenStreetMap?"

---

### 3. Walk-in vs. appointment

**types:** salon, tattoo, repair, restaurant, healthcare, auto-dealer, fitness

"Walk-ins welcome," "by appointment only," or "walk-ins accepted, appointments preferred." This is a first-click decision — a customer who doesn't know your policy may choose a competitor who makes it clear.

**Where to add:** Top of the Services page, the Hours/Location page, or prominently on the home page.

**Ask the owner:** "Do you take walk-ins, require appointments, or both?"

---

### 4. Languages spoken

**types:** all (especially healthcare, legal, accounting, childcare, social-services, government, real-estate)

"Se habla español" or "Staff speaks English, Spanish, and Vietnamese." In diverse communities, this determines which business a customer calls. It's also a genuine service — people should be able to get help in their language.

**Where to add:** About page, Contact page, or header/footer if it's a key differentiator.

**Ask the owner:** "Do you or your staff speak languages other than English?"

---

### 5. Pet policy

**types:** brewery, bookshop, hardware, retail, hospitality, campground, restaurant, florist

"Dogs welcome on the patio," "leashed dogs welcome in the store," or "service animals only." Customers with dogs plan around this. A brewery with a dog-friendly patio should say so — it's a selling point.

**Where to add:** Hours/Location page, Policies page, or an "FAQ" section.

**Ask the owner:** "Are pets allowed at your business? Any restrictions?"

---

### 6. Gift cards

**types:** restaurant, salon, brewery, florist, bookshop, retail, fitness, photography, hospitality, campground

Consumers actively search "[business name] gift cards" around holidays. It's a revenue channel that requires zero inventory. "Gift cards available in-store and online" is all it takes.

**Where to add:** Navigation (if sold online), home page, or a dedicated section on the Shop page. Mention in the footer year-round and promote heavily in November/December.

**Ask the owner:** "Do you sell gift cards? In-store, online, or both?"

---

### 7. What you don't do

**types:** repair, trades, healthcare, legal, cleaning, salon, photography, accounting

"We specialize in residential electrical — we don't do commercial." "We repair Apple and Samsung devices but not tablets." "We don't do family law." Saves the customer a wasted call and saves the business a wasted conversation. It's also a sign of expertise — specialists are trusted more than generalists.

**Where to add:** Services page (after the list of what you do), or FAQ.

**Ask the owner:** "What do people commonly ask you to do that you don't offer? We'll note that on the site to save everyone's time."

---

### 8. Emergency / after-hours availability

**types:** trades, repair, healthcare (vet), funeral-home, insurance, childcare (late pickup), pet-services

"24/7 emergency service — call (555) 123-4567." When it's 9pm and a pipe bursts, or a pet is sick, or someone has died — the customer needs to know if you're available *right now*. This should be one of the most visible things on the site.

**Where to add:** Header or top of Contact page. Not buried in a FAQ. If you offer emergency service, it should be findable in under 5 seconds.

**Ask the owner:** "Do you offer emergency or after-hours service? What's the process for urgent needs?"

---

### 9. Cancellation / refund policy

**types:** salon, fitness, photography, hospitality, campground, education, childcare, cleaning, florist

"Free cancellation up to 24 hours before your appointment." Customers hesitate to book when they can't find the cancellation policy. Surfacing it near the booking CTA builds confidence. Don't bury it in fine print — make it a selling point.

**Where to add:** Near the booking button/link, on the Policies page, or in a FAQ. Repeat it in booking confirmation messages.

**Ask the owner:** "What's your cancellation or refund policy?"
