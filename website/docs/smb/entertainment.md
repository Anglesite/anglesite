# Entertainment & Recreation

Covers: bowling alleys, escape rooms, mini golf, arcades, go-kart tracks, trampoline parks, laser tag, skating rinks (ice and roller), batting cages, axe throwing, family entertainment centers, pool halls, drive-in theaters, haunted attractions (seasonal). See also [community-theater.md](community-theater.md) for performing arts, [fitness.md](fitness.md) for gyms and sports training, and [event-venue.md](event-venue.md) for facilities that primarily host private events.

## Pages

- **Activities / attractions** — Everything you offer, with photos, brief descriptions, age/height requirements, and pricing. Group by activity if you have multiple (bowling, arcade, laser tag). Each major activity should have enough detail that a visitor can decide "yes, we're going."
- **Pricing** — Clear, visible pricing. Per game, per hour, per person. Day passes, combo deals, unlimited play options. This is the #1 thing visitors look for. Don't hide it behind a "contact us" — families plan by budget.
- **Parties and group events** — Birthday parties are a major revenue stream. Party packages with what's included (activity time, food, table, invitations, party host), pricing, group minimums, booking lead time. Corporate team-building packages. Field trip and school group rates.
- **Hours** — Prominent, easy to find. Entertainment venues often have complex hours: different on weekdays vs. weekends, different during school breaks, seasonal hours, holiday hours. Make a clear schedule. Update it before every holiday and school break.
- **Specials and deals** — Dollar bowling night, family fun night, student discounts, military discounts, loyalty programs, gift cards, season passes. These drive repeat visits and off-peak traffic.
- **Food and drink** — If you have a snack bar, restaurant, or bar: menu with prices, food allergy info. If BYOB is allowed, say so. If outside food isn't allowed, say that too (people ask).
- **About** — History, the team, community involvement. Photos of the facility. Virtual tour if possible.
- **Events** — Leagues (bowling, pool, darts), tournaments, themed nights, holiday events, live entertainment, DJ nights. League schedules and standings.
- **Contact / location** — Address, phone, directions, parking. Note if the location is hard to find or inside a larger complex.

## Design

**Visual mood:** Fun, exciting, and high-energy. The site should feel like walking through the front door — you immediately want to play.

**Color direction:** Bold, saturated colors — adapt to the venue's personality. Neon tones for arcades, bright and cheerful for family centers, sleek dark palettes for escape rooms. Avoid muted or corporate tones.

**Typography feel:** Modern stack (system-ui) with bold, playful weight. Big headings that match the energy of the space.

**Layout emphasis:** Hours, activities, and pricing above the fold — families plan by budget and availability. Pattern 2 (hero + content) with an action photo for the home page, Pattern 4 (card grid) for activities. Max-width 56rem.

**Photography style:** Action shots of people having fun, facility highlights, activity close-ups. Show the experience, not just the space. 16:9 for the hero image, 4:3 for activity cards.

**Key component:** Activity or attraction card — photo, name, brief description, age suitability, price, and a "Book" button. Each card should answer: "What is it, can my kids do it, and how much?"

## Tools

- **Party Bookings**: Most entertainment venues manage party bookings through phone calls and a calendar. For higher volume, consider:
  - **Square Appointments** (free for 1 staff) — Online booking for party time slots.
  - **FareHarbor** (commission-based, proprietary) — Activity and experience booking. Designed for attractions. fareharbor.com
  - **Peek** (commission-based, proprietary) — Similar to FareHarbor. peek.com
- **POS**: **Square** (free POS, 2.6% per transaction) — Standard for entertainment venues. Handles admissions, food, retail, and gift cards.
- **Loyalty programs**: **Square Loyalty** (add-on to Square POS) — Punch card replacement. Reward repeat visits.
- **Google Business Profile** — Essential. Families search "things to do near me" and "bowling near me." Complete the profile with photos, hours, and activity categories.
- **Yelp** — Active for entertainment venues in many markets. Claim the listing.
- **TripAdvisor** — If the venue attracts tourists (especially escape rooms, unique attractions). Claim and manage the listing.

## Compliance

- **Amusement ride safety**: If the venue has mechanical rides, inflatables, or trampolines, state amusement ride regulations may apply. Many states require annual inspections, incident reporting, and operator training. Check with the state's amusement ride safety office.
- **Occupancy and fire code**: Entertainment venues have strict occupancy limits. Display the posted occupancy prominently. Fire exits must be clearly marked and unobstructed. Fire marshal inspections are regular.
- **Liability waivers**: Required for most physical activities (trampolines, go-karts, axe throwing, escape rooms). Waivers should be signed before participation. Many venues use digital waiver systems. Note on the website: "All participants must sign a waiver. Minors require a parent/guardian signature." Link to the waiver form for pre-visit signing if available.
- **Age and supervision requirements**: State clearly: age minimums for each activity, height/weight requirements, supervision requirements for minors. "Children under 10 must be accompanied by an adult." These are safety and liability issues.
- **ADA accessibility**: Note accessible activities and facilities. Which activities are wheelchair-accessible? Are there sensory-friendly hours? Is the facility accessible throughout?
- **Alcohol licensing**: If serving alcohol, state liquor license required. Specific regulations around alcohol and physical activities (no alcohol near trampoline areas, etc.). Age verification at the bar.
- **Food safety**: If serving food, health department permits and inspections apply. Display food allergy information. Safe food handling training for staff.
- **Music licensing**: If playing music in the venue (background music, DJ nights, live music), ASCAP/BMI/SESAC licensing is required. Most entertainment venues need a blanket license.
- **Noise ordinances**: Late-night operation (go-karts, outdoor activities) may conflict with local noise ordinances. Note operating hours that comply.

## Content ideas

Event and league announcements, party highlights (with permission), holiday hours and specials, new activity or game additions, staff spotlights, behind-the-scenes maintenance and upgrades, community involvement, fundraiser events, school break activity guides, rainy day activity promotion, birthday party planning tips, group event recaps, tournament results, league standings, seasonal themed events (Halloween haunted bowling, glow nights, holiday parties), customer photos and videos (with permission).

## Key dates

- **National Bowling Day** (2nd Saturday in Aug) — Free bowling promotions, community events.
- **National Escape Room Day** (Jan) — Discounts, new room launches, team challenges.
- **School breaks** (varies by district) — The busiest times. Promote specials before each break: spring break, summer, winter break, teacher in-service days.
- **National Fun Day** (Apr 2) — General entertainment promotion.
- **Halloween season** (Oct) — Haunted attractions, costume events, themed nights. Start promoting in September.
- **Holiday party season** (Nov–Dec) — Corporate parties, family gatherings, gift card sales.

## Structured data

Use `LocalBusiness` with `additionalType` of `AmusementPark`, `BowlingAlley`, `EntertainmentBusiness`, or the most specific type available:
- `name`, `address`, `telephone`
- `openingHours` — note complex schedules
- `priceRange`
- `amenityFeature` — list activities
- `event` — for upcoming events and leagues

For specific activities, use `Product` or `Service`:
- `name`, `description`, `offers` (pricing)

## Data tracking

- **Party bookings:** Date, Time, Contact Name, Phone, Email, Package, Guest Count, Age of Guest of Honor, Deposit, Status (Booked/Confirmed/Completed/Cancelled), Notes
- **Leagues:** Name, Activity, Day/Time, Season, Teams/Players, Status (Active/Completed/Forming), Notes
- **Events:** Name, Date, Type (Tournament/Theme Night/Holiday/Private), Attendance, Revenue, Notes
