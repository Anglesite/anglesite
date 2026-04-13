# Healthcare & Wellness

Covers: chiropractors, dentists, therapists (physical, occupational, mental health), acupuncture, massage therapy, veterinary clinics, optometrists, naturopaths.

## Pages

- **Services** — List of services with plain-language descriptions
- **Providers** — Bio, photo, credentials, specialties for each provider
- **Insurance / payment** — Accepted insurance, self-pay options, sliding scale if applicable
- **New patients** — What to expect, intake forms (link to external portal), how to schedule
- **Hours / location** — With parking and accessibility notes
- **About** — Practice philosophy, history
- **Blog** — Health tips, seasonal wellness, FAQ answers
- **Contact** — Phone, fax (many healthcare offices still use fax), email

## Design

**Visual mood:** Calming, trustworthy, clinical but warm. The design should lower anxiety — patients visiting a healthcare site are often stressed or in pain. Clean and reassuring.

**Color direction:** Soft blues, greens, and white. Light, airy backgrounds. Warm accents (soft gold, sage) to avoid feeling sterile. Avoid harsh reds or high-contrast patterns. The palette should feel clean without feeling cold.

**Typography feel:** Humanist stack (Segoe UI / Roboto) for warmth and readability. Heading weight 600. Approachable and clear — healthcare content must be easy to read for all literacy levels.

**Layout emphasis:** Patient portal link and online booking CTA above the fold — these are the #1 and #2 reasons people visit. Provider bios with photos build trust before the first visit. Insurance/payment info should be easy to find. Use Pattern 2 (hero + content) for home. Max-width 56rem.

**Photography style:** Clean, bright, natural-light photography. Real office and provider photos are far better than stock. Warm and welcoming — show the space patients will actually visit. Avoid clinical stock photos with stethoscopes and clipboards.

**Key component:** Provider bio card — professional photo, name, title/credentials, specialties, brief personal note, and "book with this provider" link. Patients choose providers, not practices.

## Tools

- **Jane App** (~$55/mo, proprietary) — Practice management, online booking, charting, insurance billing. Purpose-built for health and wellness. janeapp.com
- **Cal.com** (open source, free tier) — Simple appointment scheduling if they don't need practice management.
- **SimplePractice** (~$29/mo, proprietary) — Popular with therapists and counselors. Includes telehealth, billing, client portal.
- For patient forms: link to their existing EHR/portal. Don't build patient intake into the website.

## Review platforms

- **Google Business Profile** — The primary channel. Patients search "dentist near me" or "chiropractor [city]" and choose largely on star rating and number of reviews. A practice with 100+ reviews and a 4.7 average gets significantly more new patient calls than one with 10. Respond to all reviews professionally — even brief "Thank you, we look forward to seeing you again" responses show the practice is attentive.
- **Healthgrades** — Heavily used for physicians, dentists, and specialists. Patients check Healthgrades specifically when researching providers. Claim the profile and encourage patients to leave reviews here.
- **Zocdoc** — If the practice accepts Zocdoc bookings, patients leave reviews through the platform after appointments. These are verified patient reviews and carry weight. Keep the profile complete.
- **Yelp** — Relevant for dentists, chiropractors, and alternative health practices. Less used for physicians in most markets but worth monitoring.
- **Psychology Today** (mental health only) — The dominant directory for therapists and counselors. Reviews aren't the focus here but profile completeness matters enormously.

For practices that use patient communication platforms (Solutionreach, Weave, etc.), set up automated post-visit review requests. These integrations make consistent review generation essentially automatic.

**Note:** Some jurisdictions restrict healthcare testimonials. Review state licensing board rules before prominently featuring reviews. See the Compliance section below.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **HIPAA (US)**: The website itself isn't a HIPAA concern — it's public information. But do NOT collect patient health information through website forms. Contact forms should only collect name, phone, and reason for visit (not symptoms or diagnoses). Link to a HIPAA-compliant patient portal for intake forms.
- **No medical advice disclaimers**: Blog content should include a general disclaimer that it's informational, not medical advice.
- **Veterinary**: Less regulatory burden on the website, but still avoid collecting patient (animal) health records through forms.
- **Testimonials**: Some jurisdictions restrict healthcare testimonials. Note this during the design interview.

## Content ideas

Seasonal health tips, "what to expect" guides for common procedures, provider spotlights, office news, community health events, answers to frequently asked questions (great for SEO), new service announcements.

## Key dates

- **American Heart Month** (Feb) — Heart health screenings, wellness tips, preventive care content.
- **Mental Health Month** (May) — Resource guides, destigmatization content, community support.
- **National Immunization Awareness Month** (Aug) — Back-to-school vaccines, flu shot prep, preventive care.
- **Breast Cancer Awareness Month** (Oct) — Screening reminders, early detection education, community walks.

## Structured data

Use `MedicalBusiness` (or more specific: `Dentist`, `Optician`, `Physician`, `VeterinaryCare`) with:
- name, address, phone, hours
- `medicalSpecialty` if applicable
- `availableService` for key services

## Data tracking

- **Patients/Clients:** Name, Phone, Email, Provider (linked), Status, Notes, Created Date
- **Appointments:** Client (linked), Provider (linked), Date, Type, Status, Notes
