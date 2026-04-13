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

## Design

**Visual mood:** Encouraging, professional, and approachable. The site should feel like a great teacher — knowledgeable, warm, and invested in your success.

**Color direction:** Warm blues, greens, and bright accents. Inviting without being childish (even for children's programs). Avoid dull or institutional colors.

**Typography feel:** Humanist stack (Segoe UI/Roboto) for approachability and readability. Friendly and clear.

**Layout emphasis:** Services or subjects, scheduling, and contact above the fold — parents and students want to know what you teach and how to get started. Pattern 2 (hero + content) for the home page, Pattern 4 (card grid) for subjects and services. Max-width 56rem.

**Photography style:** Bright learning environment photos, tutor-student interactions, engaged faces. Show the teaching relationship. 4:3 aspect ratio.

**Key component:** Subject or service card — subject name, brief description, levels offered (beginner through advanced, or grade ranges), and a scheduling link. Clear and actionable.

## Tools

- **Cal.com** (open source, free tier) — Session scheduling with recurring appointments. Good for tutors.
- **TutorBird** (~$15/mo, proprietary) — Built for tutors. Scheduling, invoicing, student tracking. tutorbird.com
- **Square Invoices** (free, proprietary) — For collecting payment. Simple invoicing.
- **Video conferencing** — For online sessions. Link from the website. **Jitsi Meet** (open source, free, no account required — meet.jit.si), **Zoom** (free tier, proprietary), or **Google Meet** / **FaceTime** depending on what the student uses.
- **Monica CRM** (open source, free) — Track students and parents.
- For driving schools: look into **ScheduleOnce** or similar for multi-instructor, multi-vehicle scheduling.

## Review platforms

- **Google Business Profile** — The primary channel for parents searching "tutor near me" or "music lessons [city]." Reviews that describe specific results ("my daughter went from a C to an A in math," "my son finally enjoys piano") are enormously persuasive. Respond to every review — parents see that the educator is engaged and communicative.
- **Yelp** — Used for tutors and enrichment centers in some markets. Claim the profile if it exists and keep it updated.
- **Care.com** (if applicable) — For in-home tutors and some after-school programs, parents search Care.com as part of their vetting. Reviews there carry weight because the platform requires background check verification.
- **Facebook** — Parent communities are active on Facebook and word-of-mouth referrals dominate this category. A business page where parents can leave recommendations, and where the educator shares tips and achievements (with permission), builds a visible reputation.

For tutors and private instructors, the best time to ask for a review is after a noticeable achievement — a test score improvement, a competition result, a grade turnaround. The parent is already pleased; a brief email with a direct Google review link is almost always welcomed.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Background checks**: Mention if instructors have passed background checks. Parents expect this. Not always legally required, but it builds trust.
- **Child safety**: If working with minors, note any policies (no 1:1 sessions without parental awareness, open-door policy, etc.).
- **Credentials**: Display relevant certifications, teaching licenses, or degrees. For driving schools: state-issued instructor license numbers.
- **FERPA (US)**: Generally doesn't apply to private tutors, but don't collect or display student grades or educational records on the website.
- **Online sessions**: Note privacy practices for recorded sessions if applicable.

## Content ideas

Study tips and learning strategies, subject-specific guides ("how to prepare for the SAT"), student success stories (with permission), parent resources, seasonal posts ("back to school prep"), new program announcements, teacher spotlights, educational news relevant to your subject area.

## Key dates

- **Read Across America Day** (Mar 2) — Literacy activities, reading challenges, community events.
- **Teacher Appreciation Week** (1st full week May) — Thank-you campaigns, teacher spotlights, referral promotions.
- **National Tutoring Week** (Oct) — Success stories, new student specials, parent resources.

## Structured data

Use `EducationalOrganization` or `School` with:
- name, address (or service area), phone
- `knowsAbout` for subjects taught
- For individual tutors, `Person` with `hasCredential` may be more appropriate

## Data tracking

- **Students:** Name, Parent Name, Parent Email, Parent Phone, Subject, Grade Level, Status, Notes, Created Date
- **Sessions:** Student (linked), Date, Time, Subject, Duration, Status, Notes
- **Invoices:** Student (linked), Amount, Date, Status (Sent/Paid/Overdue)
