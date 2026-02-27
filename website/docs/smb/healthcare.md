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

## Tools

- **Jane App** (~$55/mo, proprietary) — Practice management, online booking, charting, insurance billing. Purpose-built for health and wellness. janeapp.com
- **Cal.com** (open source, free tier) — Simple appointment scheduling if they don't need practice management.
- **SimplePractice** (~$29/mo, proprietary) — Popular with therapists and counselors. Includes telehealth, billing, client portal.
- For patient forms: link to their existing EHR/portal. Don't build patient intake into the website.

## Compliance

- **HIPAA (US)**: The website itself isn't a HIPAA concern — it's public information. But do NOT collect patient health information through website forms. Contact forms should only collect name, phone, and reason for visit (not symptoms or diagnoses). Link to a HIPAA-compliant patient portal for intake forms.
- **No medical advice disclaimers**: Blog content should include a general disclaimer that it's informational, not medical advice.
- **Veterinary**: Less regulatory burden on the website, but still avoid collecting patient (animal) health records through forms.
- **Testimonials**: Some jurisdictions restrict healthcare testimonials. Note this during the design interview.

## Content ideas

Seasonal health tips, "what to expect" guides for common procedures, provider spotlights, office news, community health events, answers to frequently asked questions (great for SEO), new service announcements.

## Structured data

Use `MedicalBusiness` (or more specific: `Dentist`, `Optician`, `Physician`, `VeterinaryCare`) with:
- name, address, phone, hours
- `medicalSpecialty` if applicable
- `availableService` for key services

## Data tracking

- **Patients/Clients:** Name, Phone, Email, Provider (linked), Status, Notes, Created Date
- **Appointments:** Client (linked), Provider (linked), Date, Type, Status, Notes
