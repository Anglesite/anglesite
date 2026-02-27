# Education & Tutoring

Covers: private tutors, music teachers, driving schools, test prep, language schools, art classes, after-school programs, enrichment centers.

## Pages

- **Programs / subjects** — What you teach, age groups, skill levels
- **About / instructors** — Credentials, teaching philosophy, experience, certifications
- **Schedule / availability** — Current openings, session formats (1:1, group, online)
- **Pricing** — Per session, packages, group rates. Be transparent.
- **Testimonials** — Parent and student reviews. Critical for education trust.
- **Results** — Test score improvements, student achievements (anonymized or with permission)
- **FAQ** — How sessions work, cancellation policy, what students need
- **Location** — If in-person: address, parking. If online: what platform, tech requirements.
- **Contact / enroll** — Phone, email, enrollment form or booking link

## Tools

- **Cal.com** (open source, free tier) — Session scheduling with recurring appointments. Good for tutors.
- **TutorBird** (~$15/mo, proprietary) — Built for tutors. Scheduling, invoicing, student tracking. tutorbird.com
- **Square Invoices** (free, proprietary) — For collecting payment. Simple invoicing.
- **Zoom** or **Google Meet** — For online sessions. Link from the website.
- **Monica CRM** (open source, free) — Track students and parents.
- For driving schools: look into **ScheduleOnce** or similar for multi-instructor, multi-vehicle scheduling.

## Compliance

- **Background checks**: Mention if instructors have passed background checks. Parents expect this. Not always legally required, but it builds trust.
- **Child safety**: If working with minors, note any policies (no 1:1 sessions without parental awareness, open-door policy, etc.).
- **Credentials**: Display relevant certifications, teaching licenses, or degrees. For driving schools: state-issued instructor license numbers.
- **FERPA (US)**: Generally doesn't apply to private tutors, but don't collect or display student grades or educational records on the website.
- **Online sessions**: Note privacy practices for recorded sessions if applicable.

## Content ideas

Study tips and learning strategies, subject-specific guides ("how to prepare for the SAT"), student success stories (with permission), parent resources, seasonal posts ("back to school prep"), new program announcements, teacher spotlights, educational news relevant to your subject area.

## Structured data

Use `EducationalOrganization` or `School` with:
- name, address (or service area), phone
- `knowsAbout` for subjects taught
- For individual tutors, `Person` with `hasCredential` may be more appropriate

## Airtable schema

- **Students:** Name, Parent Name, Parent Email, Parent Phone, Subject, Grade Level, Status, Notes, Created Date
- **Sessions:** Student (linked), Date, Time, Subject, Duration, Status, Notes
- **Invoices:** Student (linked), Amount, Date, Status (Sent/Paid/Overdue)
