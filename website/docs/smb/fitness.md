# Fitness & Studio

Covers: gyms, yoga studios, Pilates, martial arts schools, dance studios, CrossFit boxes, personal trainers, swim schools.

## Pages

- **Classes / schedule** — Weekly schedule by day, filterable by type or instructor
- **Instructors** — Bio, photo, certifications, teaching style
- **Membership / pricing** — Tiers, drop-in rates, introductory offers
- **New members** — What to expect, what to bring, how to sign up
- **About** — Studio philosophy, history, community values
- **Location** — Address, parking, transit, accessibility features
- **Blog** — Wellness tips, member spotlights, event recaps
- **Contact** — Phone, email, social links

## Tools

- **Momoyoga** (~$32/mo, proprietary) — Built for yoga studios. Scheduling, payments, member management. momoyoga.com
- **Zen Planner** (~$99/mo, proprietary) — Gym and studio management. Members, billing, scheduling. zenplanner.com
- **Cal.com** (open source, free tier) — For personal trainers doing 1:1 session booking.
- **Square** (free POS, proprietary) — Good for drop-in payments and retail (merchandise, water, etc.).
- Many studios already use MindBody or ClassPass. If it's working, integrate with it rather than replacing it.

## Compliance

- **Waivers**: Most fitness businesses require liability waivers. Link to a digital waiver form (many scheduling tools include this). Don't collect health information on the website itself.
- **ADA**: Physical accessibility info is important — mention wheelchair access, shower facilities, parking. Not just for compliance but for welcoming all members.
- **Auto-renewal disclosure**: If memberships auto-renew, pricing pages should clearly state the terms. Some states have specific auto-renewal disclosure laws.

## Content ideas

Weekly or monthly class schedule highlights, new class announcements, instructor spotlights, member transformation stories (with consent), wellness tips (nutrition, recovery, mobility), workshop or special event announcements, seasonal challenges ("30-day challenge"), community event participation.

## Key dates

- **National Physical Fitness & Sports Month** (May) — Community fitness challenges, open house events, new member specials.
- **Global Running Day** (1st Wed Jun) — Group runs, couch-to-5K starts, running club promotions.
- **National Yoga Month** (Sep) — Free introductory classes, yoga challenges, wellness workshops.

## Structured data

Use `SportsActivityLocation` or `ExerciseGym` with:
- name, address, phone, hours
- `event` for regular classes (optional, can be complex)

## Data tracking

- **Members:** Name, Email, Phone, Membership Type, Start Date, Status, Notes
- **Classes:** Name, Instructor, Day, Time, Capacity, Notes
