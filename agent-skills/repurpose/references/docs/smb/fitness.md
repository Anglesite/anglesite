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

## Design

**Visual mood:** Energetic, motivating, strong. The site should make visitors want to move. High energy without being aggressive — welcoming intensity that says "you belong here, let's go."

**Color direction:** Bold, high-contrast palette — black or dark charcoal as the base with a bright accent (orange, red, or electric blue). White text on dark backgrounds for hero sections. The accent color drives CTAs (join now, try a class). Avoid muted or pastel tones — they undercut the energy.

**Typography feel:** Modern stack (system-ui sans-serif). Heavy weight headings (700–800) for impact. Bold, confident, and unapologetic. All-caps headings work well for class names and CTAs.

**Layout emphasis:** Class schedule and membership/trial CTA above the fold. Make it easy to see what's happening today and how to start. Use Pattern 2 (hero + content) for home with a high-energy photo, Pattern 4 (card grid) for the class lineup. Max-width 64rem.

**Photography style:** Action photos of real members and trainers — mid-workout, not posed. Show the gym environment, the community, the effort. 16:9 for hero and environment shots, 1:1 for trainer portraits. Authentic energy over stock fitness photography.

**Key component:** Class schedule grid or weekly timetable — days as columns, time slots as rows, color-coded by class type. Each cell shows class name, time, instructor, and a link to book or drop in.

## Tools

- **Momoyoga** (~$32/mo, proprietary) — Built for yoga studios. Scheduling, payments, member management. momoyoga.com
- **Zen Planner** (~$99/mo, proprietary) — Gym and studio management. Members, billing, scheduling. zenplanner.com
- **Cal.com** (open source, free tier) — For personal trainers doing 1:1 session booking.
- **Square** (free POS, proprietary) — Good for drop-in payments and retail (merchandise, water, etc.).
- Many studios already use MindBody or ClassPass. If it's working, integrate with it rather than replacing it.

## Review platforms

- **Google Business Profile** — The primary channel. People search "yoga studio near me" or "CrossFit [neighborhood]" and decide based on star ratings, photo quality, and responses. A studio with 50+ reviews looks established and safe to try. Respond to all reviews, including negative ones — showing you care about feedback builds trust with prospective members.
- **Yelp** — Active for fitness and wellness businesses. Used especially when someone is comparing multiple studios in an area. A complete Yelp profile with photos of the space and real member reviews is worth maintaining.
- **ClassPass** — If the studio offers drop-in classes through ClassPass, the in-app reviews are the primary signal for new ClassPass members trying the studio for the first time. A high ClassPass rating drives bookings.
- **Facebook** — Fitness communities are active on Facebook. A business page with visible reviews, event posts, and community interaction signals an active, engaged studio. Many members will leave a recommendation on Facebook if asked.

After a member's first month or a milestone class (e.g., "you've completed 10 classes!"), ask: "We'd love a Google review if you've been enjoying your time here." Members who feel part of the community are the most willing to write substantive, persuasive reviews.

See `docs/smb/reviews.md` for full review management guidance.

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
