# Youth Organization

Covers: youth sports leagues, scouting groups, Boys & Girls Clubs, after-school programs, mentoring organizations, youth arts programs, summer camps.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Programs** — What's offered, age groups, schedule, locations. Parents need to quickly determine "is this for my kid?"
- **Registration / sign up** — Season registration, enrollment, waitlists. Make this prominent during registration periods.
- **Schedule / calendar** — Game schedules, practice times, program calendars. The most frequently visited page during active seasons.
- **About** — Mission, history, leadership, coaches/mentors
- **For parents** — What to expect, volunteer requirements, code of conduct, communication expectations, pickup/dropoff procedures
- **Safety** — Background check policy, supervision ratios, incident reporting. Parents are making a trust decision.
- **Donate / sponsor** — Scholarship funds, equipment needs, facility improvements, corporate sponsorships
- **Volunteer / coach** — How to get involved, requirements, training
- **Contact** — Office, program coordinators, emergency contact
- **News / blog** — Season recaps, player spotlights, event announcements

## Design

- **Visual mood:** Energetic, inclusive, safe, and age-appropriate. The design should appeal to parents making a trust decision while reflecting the fun and growth kids experience.
- **Color direction:** Bright but not garish — blues, greens, and warm yellows. Friendly and active without looking childish. Avoid overly dark or corporate palettes.
- **Typography feel:** Humanist sans-serif (Segoe UI/Roboto stack). Clean, friendly, and highly readable. Parents scan quickly during registration periods.
- **Layout emphasis:** Pattern 2 (hero + content) for the home page. Registration and program information above the fold. Pattern 4 (card grid) for program listings. Max-width 48rem for content pages.
- **Photography style:** Kids in action (with parental consent), group activities, coaches and mentors engaged with participants. 4:3 aspect ratio. Bright, natural settings. Never use photos of identifiable minors without documented media releases.
- **Key component:** Program card — age group, schedule, description, and registration link. Parents need to quickly determine "is this for my kid?" and sign up.

## Tools

- **TeamSnap** (free tier for basic, ~$13/mo for premium, proprietary) — Sports team management. Schedules, rosters, communication, availability. teamsnap.com
- **SportsEngine** (pricing varies, proprietary) — League management, registration, scheduling, websites. sportsengine.com
- **Jotform** (free tier, proprietary) — Registration forms, waivers, medical forms. jotform.com
- **SignUpGenius** (free tier) — Volunteer scheduling for snack duty, field maintenance, carpool.
- **GiveButter** (free, tips-based) — Fundraising for equipment, scholarships, facility needs.
- For summer camps: **CampMinder** or **UltraCamp** — Camp-specific registration and management.

## Compliance

- **Child safety**: This is the #1 compliance concern. Display:
  - Background check policy for all adults (coaches, volunteers, board members)
  - Code of conduct
  - Mandatory reporting policy
  - Two-deep leadership (no adult alone with a child)
  - SafeSport certification if applicable (sports)
- **Photo/media consent**: Never post photos of minors on the website without parental consent. Have a media release form as part of registration.
- **Medical forms**: Collect emergency contact and medical info during registration (through the registration platform, not the website).
- **Concussion protocol**: For sports orgs, display the concussion awareness policy. Many states require this.
- **ADA / inclusion**: Note how the organization accommodates children with disabilities. Adaptive programs, buddy systems, etc.

## Content ideas

Season recaps and highlights, player/participant spotlights (with parental consent), volunteer and coach appreciation, registration reminders and deadlines, fundraiser announcements, scholarship recipient stories (anonymized or with consent), community event participation, facility improvement updates, safety tip articles, "what to expect" guides for new families.

## Key dates

- **National Mentoring Month** (Jan) — Mentor recruitment, impact stories, program spotlights.
- **Scouting Anniversary Week** (Feb) — For scout organizations. History, community service, membership drives.
- **National Youth Sports Safety Month** (Apr) — Safety education, equipment checks, coaching resources.

## Structured data

Use `SportsOrganization` or `NGO` with:
- name, address (or service area), phone
- `sport` if applicable
- `nonprofitStatus`

## Data tracking

- **Families:** Parent Name, Email, Phone, Children (text or linked), Emergency Contact, Notes, Created Date
- **Participants:** Name, Age, Family (linked), Program, Season, Status, Medical Notes
- **Volunteers:** Name, Family (linked), Role (Coach/Assistant/Board/Other), Background Check Date, Status
