# Food Truck & Mobile Food

Covers: food trucks, food carts, pop-up kitchens, mobile food vendors, catering-only businesses. See also [restaurant.md](restaurant.md) for fixed-location restaurants, cafés, and bakeries.

The key difference from a fixed-location restaurant: **customers need to know where you are today, not where you are in general.** Discovery is schedule-driven, not address-driven. The website's job is to answer "where is the truck right now?" and "how do I book the truck for my event?"

## Pages

- **Schedule / locations** — The most-visited page. Where you'll be this week, updated regularly. A simple table or list: date, location, hours. If the schedule is consistent ("Wednesdays at the brewery, Saturdays at the farmers market"), show the recurring schedule. If it varies, update weekly. Consider an embeddable calendar or a feed that syncs with social media.
- **Menu** — Full menu with prices. HTML, not PDF. Note if the menu changes by location or day. Food truck menus are often shorter and more focused than restaurants — that's a strength.
- **Book the truck** — Private events, corporate catering, weddings, festivals. This is often the highest-value revenue stream. Include: what events you serve, pricing guidance or "request a quote," minimum headcount, lead time, service area, what's included (setup, cleanup, plates, napkins). Past event photos.
- **About** — The truck's story, the people behind it, the food philosophy. Food trucks are personality-driven — customers follow the people, not just the food.
- **Gallery** — The truck itself, the food, events you've worked. The truck's exterior is part of the brand.
- **Contact** — Phone, email, social links. Include a booking inquiry form for events.

## Tools

- **Square** (free POS, 2.6% per transaction, proprietary) — Standard for food trucks. Payments, online ordering, marketing. square.com
- **Social media for location updates** — Instagram and Facebook are where food truck customers check "where are you today?" Post your daily/weekly location. The website should link prominently to these accounts and mirror the schedule.
- **Map listings** — Different from restaurants. A food truck may not have a permanent Google Business Profile address. Options:
  - Use a service area instead of a fixed address on Google Business Profile
  - If you have a consistent home base (a brewery lot, a regular market), list that
  - Apple Business Connect and OpenStreetMap are less useful for mobile businesses — focus on Google and social
- **HoneyBook** or **Dubsado** (~$19–$35/mo) — For managing event/catering bookings, contracts, invoices. Only if they do enough events to justify the cost. Otherwise Square invoicing works.
- **Roaming Hunger** — Food truck marketplace for event booking. Charges a commission but brings leads. roaminghunger.com

## Compliance

- **Mobile food vendor permit**: Required in most jurisdictions. Different from a restaurant health permit — covers the vehicle, not a building. Display the permit number if required. Some cities require separate permits for each location.
- **Commissary kitchen requirement**: Most jurisdictions require food trucks to prep and store food in a licensed commercial kitchen (commissary), not in the truck itself. Note the commissary arrangement.
- **Parking and vending permits**: Many cities regulate where food trucks can park and sell. Some require vending permits, distance-from-restaurant buffers, or time limits. This varies enormously by city.
- **Fire safety**: Propane, generators, and cooking equipment in a vehicle have specific fire marshal requirements. Display fire extinguisher and suppression system inspection status if required.
- **Cottage food laws**: If they prep shelf-stable items (packaged sauces, baked goods) for sale alongside fresh food, cottage food rules may apply. See [restaurant.md](restaurant.md) for details.
- **Event-specific permits**: Festivals, fairs, and private events may require temporary food service permits. The event organizer usually handles this but the truck should confirm.

## Content ideas

Daily/weekly location announcements, menu specials, behind-the-scenes of truck life (people love this), event recaps, "find us at [festival]" posts, new menu item teasers, customer photos, the truck getting wrapped or customized, weather-related updates ("rain day — we're at the covered market instead"), collaboration posts with other trucks or venues, booking availability for upcoming weekends.

**Video content** — Food trucks are inherently visual and kinetic. Cooking in the truck, serving a line of customers, setting up at a festival, the menu board going up. TikTok and Instagram Reels drive discovery. The website hosts the permanent version; social gets the clips.

## Key dates

- **National Food Truck Day** (last Fri Jun) — Special menu, giveaway, social push.
- **Festival season** (May–Oct) — The busiest time. Post which festivals you'll attend. Book private events for shoulder season.
- **Catering season** (Apr–Oct for outdoor events, year-round for corporate) — Push event booking on the website starting in February.

## Structured data

Use `FoodEstablishment` with:
- name, phone, `areaServed` (instead of a fixed address)
- `servesCuisine`
- `priceRange`
- `hasMenu` (link to menu page)
- If there's a consistent home location, use `address` for that spot

## Data tracking

- **Schedule:** Date, Location, Hours, Notes (special menu, event)
- **Events:** Client, Date, Location, Guest Count, Menu, Price, Deposit, Status (Inquiry/Booked/Complete), Notes
- **Customers:** Name, Email, Phone, Type (Regular/Event/Corporate), Source, Created Date
