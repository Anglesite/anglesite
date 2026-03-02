# Pharmacy

Covers: independent pharmacies, compounding pharmacies, specialty pharmacies, apothecaries, pharmacies with front-end retail (cards, gifts, OTC, health products). See also [healthcare.md](healthcare.md) for medical providers and [retail.md](retail.md) for general retail shops.

## Pages

- **Services** — What sets the pharmacy apart from chains: compounding, medication synchronization (med sync), blister packaging, delivery, immunizations/vaccines, medication therapy management (MTM), health screenings (blood pressure, glucose, cholesterol), pet medications, durable medical equipment (DME), specialized services (hormone therapy, pain management compounds, veterinary compounding). Independent pharmacies survive by offering services chains don't.
- **Transfer your prescription** — Simple, prominent call to action. Explain the process: "Call us or fill out the form below with your current pharmacy name and prescription numbers. We handle the rest." This is the primary conversion page. Make it friction-free.
- **Accepted insurance** — List of insurance plans and PBMs accepted. Medicare Part D, Medicaid, and major commercial plans. Note if the pharmacy works with GoodRx, discount cards, or offers a cash-pay discount program. This is the first thing many customers check.
- **Delivery** — If the pharmacy delivers: delivery area, same-day vs. next-day, free vs. fee, how to sign up, any restrictions. Delivery is a major differentiator for independent pharmacies, especially for elderly and homebound patients.
- **Compounding** — If applicable: what compounding is (explain simply — "custom-made medications"), types offered (dermatological, hormone, pediatric, veterinary, pain), how it works (doctor prescribes, pharmacy makes it), insurance coverage notes. This is a specialty service worth a dedicated page.
- **Immunizations** — Vaccines offered (flu, COVID, shingles, pneumonia, Tdap, travel vaccines), walk-in or appointment, insurance coverage, what to bring. Seasonal promotion during flu season.
- **Front-end / shop** — If the pharmacy has a retail section: categories carried (health and beauty, cards, gifts, home health, OTC, first aid, specialty items). Not necessarily a full product catalog — more "what you'll find here."
- **About** — Pharmacist bios (name, credentials, photo, areas of expertise), pharmacy history, community involvement. "Your pharmacist knows your name" — this is the differentiator from chain pharmacies.
- **Health resources** — Drug interaction checker link, medication disposal info, health tips, seasonal health reminders. Positions the pharmacy as a health resource, not just a dispensary.
- **Contact** — Phone (pharmacists answer the phone — this matters), fax, address, hours, refill line if separate, delivery request line.

## Design

**Visual mood:** Trustworthy, clean, and health-focused. The site should feel like a well-run pharmacy — professional, approachable, and reassuring.

**Color direction:** Healthcare palette — calming blues, clean whites, soft greens. Avoid red (alarm) and anything clinical or cold. Warmth builds trust.

**Typography feel:** Humanist stack (Segoe UI/Roboto) for approachability. Clear and easy to read at all sizes — many pharmacy customers are elderly or have low vision.

**Layout emphasis:** Services, hours, and prescription transfer CTA above the fold — these are why people visit the site. Pattern 2 (hero + content) for the home page. Max-width 56rem.

**Photography style:** Clean, bright, well-organized store photos. The pharmacist at the counter, tidy shelves, friendly service. Avoid stock photos — authenticity matters for healthcare trust. 4:3 aspect ratio.

**Key component:** Services list with icons — prescriptions, immunizations, compounding, delivery. Each service gets a clear label, brief description, and link to learn more. This is how the pharmacy differentiates from chains.

## Tools

- **Pharmacy management systems** are specialized and usually pre-existing. The website integrates with them, not the other way around. Common systems:
  - **PioneerRx**, **Liberty**, **QS/1**, **Computer-Rx**, **BestRx** — These handle dispensing, insurance billing, and patient records. The website is separate.
- **Refill requests**: Many pharmacy systems have patient-facing refill portals. Link to the portal from the website. If no portal exists, a simple refill request form on the website (name, date of birth, prescription numbers, phone) that emails the pharmacy works.
- **Google Business Profile** — Essential. People search "pharmacy near me" and "24-hour pharmacy." Keep hours accurate, especially holiday hours.
- **Square** (free POS, 2.6% per transaction) — For front-end retail sales if not using the pharmacy system's POS.
- **Mailchimp** (free up to 500 contacts) or **Buttondown** (~$9/mo, indie) — For health newsletters, flu shot reminders, and seasonal promotions.

## Compliance

- **HIPAA**: The pharmacy handles protected health information (PHI). The website must not collect or display PHI. Contact forms should not ask for medical details — just name, phone, and "I'd like to transfer a prescription" or "I need a refill." A privacy policy mentioning HIPAA compliance is expected. No patient names, prescription details, or health conditions on the website ever.
- **State Board of Pharmacy**: Every state regulates pharmacies. Display the pharmacy license number. Pharmacist licenses should be current. Some states require the pharmacist-in-charge to be named publicly.
- **DEA registration**: Required for dispensing controlled substances. Not displayed on the website, but the pharmacy must have it.
- **Prescription advertising restrictions**: Some states restrict advertising specific prescription medications or prices. Check state regulations before listing specific drug prices on the website. It's safer to say "we offer competitive pricing" and handle specifics in person.
- **Compounding regulations**: Compounding pharmacies may need additional accreditation (PCAB) and must comply with USP 795/797/800 standards depending on what they compound. If accredited, display the accreditation.
- **Vaccine administration**: Pharmacist vaccine administration authority varies by state. Some states allow pharmacists to administer any vaccine; others restrict by age or vaccine type. Note what's available and link to the state's requirements.
- **FDA and FTC**: The pharmacy cannot make health claims about products or services beyond what's FDA-approved. "Our compound cures [condition]" is not allowed. "Our compounding pharmacy prepares custom medications as prescribed by your doctor" is fine.
- **Accessibility**: Pharmacy websites must be accessible. Many pharmacy customers are elderly and may use screen readers, have low vision, or have difficulty with small text. See `docs/accessibility.md`.

## Content ideas

Flu season vaccine reminders, medication safety tips ("how to store medications properly"), drug disposal events and permanent disposal locations, seasonal health topics (allergies, sun protection, cold and flu, holiday stress), new service announcements, pharmacist spotlights, compounding FAQs, Medicare Part D enrollment reminders (Oct 15–Dec 7), community health screening events, travel health tips, pet medication awareness, medication synchronization benefits explained, "ask your pharmacist" Q&A posts, partnership announcements with local doctors and clinics.

## Key dates

- **American Pharmacists Month** (Oct) — Pharmacist spotlights, community health events, service promotions.
- **Medicare Open Enrollment** (Oct 15–Dec 7) — Insurance plan reviews, medication cost consultations. Critical for independent pharmacies.
- **Flu season** (Sep–Mar, peak Oct–Feb) — Vaccine promotion starting in September. Weekly reminders during peak season.
- **National Immunization Awareness Month** (Aug) — Back-to-school vaccines, catch-up schedules, adult vaccine reminders.
- **Poison Prevention Week** (3rd week of Mar) — Medication safety, safe storage, child-resistant packaging, disposal.
- **National Drug Take Back Day** (last Saturday in Apr, last Saturday in Oct) — Promote collection events, permanent disposal locations.

## Structured data

Use `Pharmacy` (a schema.org type):
- `name`, `address`, `telephone`, `faxNumber`
- `openingHours` — include holiday hours
- `isAcceptingNewPatients` — if applicable
- `availableService` — list services (compounding, delivery, immunizations)
- `insuranceAccepted` — list accepted plans if feasible

## Data tracking

- **Services:** Service Name, Category (Compounding/Vaccines/DME/Screening/MTM), Status (Active/Seasonal/Discontinued), Insurance Coverage Notes, Notes
- **Delivery area:** ZIP Codes or Towns served, Delivery Days, Same-Day Cutoff Time, Fee (if any)
- **Insurance plans:** Plan Name, Type (Commercial/Medicare/Medicaid/Discount), Network Status (In-Network/Out-of-Network), Notes
