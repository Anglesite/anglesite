# Roadside Attraction

Covers: roadside attractions, novelty museums, mystery spots, themed experiences, oversized landmarks, curiosity shops, corn mazes, adventure parks, natural wonders with admission, tourist stops, Americana landmarks. See also [museum.md](museum.md) for traditional museums, and [retail.md](retail.md) if the gift shop is a major component.

The business model: people stop because it's worth the detour. Discovery is road-trip-driven — travelers decide to visit based on reviews, lists, and signs they pass on the highway. The website's job is to convince someone planning a trip that your stop is worth adding to the route.

## Pages

- **What we are** — The hero page. Big photos, the story of the attraction, what visitors experience. Answer: "What is this place and why should I stop?" Don't oversell — authenticity is the brand. Quirky is good. Pretending to be something you're not isn't.
- **Visit** — Hours, admission pricing (adults, kids, seniors, group rates), directions with highway exit numbers and landmarks ("take Exit 42, turn left at the gas station, 2 miles on the right"), parking, estimated visit duration ("plan for 45 minutes to an hour"), accessibility notes.
- **Gift shop** — If there's a shop (and there usually is), feature it. Unique merchandise tied to the attraction is a major revenue stream. Consider an online shop for items people didn't buy on-site or want as gifts. "I wish I'd bought the t-shirt" is a real thing.
- **Gallery** — Photos and videos of the attraction, visitors enjoying it (with permission), the grounds, seasonal variations. User-generated content is gold — encourage visitors to tag your location on social.
- **Group visits & events** — School field trips, tour bus stops, birthday parties, corporate team outings, private rentals. Include group pricing, booking process, and what's included.
- **About / History** — How the attraction came to be, who built it, the story behind it. For Americana attractions, the history IS the attraction. Don't skip this.
- **Reviews** — Visitor testimonials. These matter enormously for "is it worth the stop?" decisions. Embed or link to TripAdvisor, Google Reviews, and Yelp. Feature the best quotes on the home page.
- **Contact** — Phone, email, social links. Include "report a problem" and "press/media inquiries" if applicable.

## Tools

- **Google Business Profile** — Critical. Claim it, keep hours updated, respond to reviews, post photos regularly. Most discovery comes from Google Maps searches like "things to do near [highway/town]." See `docs/webmaster.md` → Map listings.
- **TripAdvisor** — Claim the listing. For tourist attractions, TripAdvisor is a primary discovery channel. Respond to reviews. tripadvisor.com
- **Atlas Obscura** — Submit the attraction. This is THE directory for quirky, unusual, and offbeat places. Inclusion drives visits from road-trip planners. atlasobscura.com
- **Roadtrippers** — Submit to the Roadtrippers database. Trip-planning app used by road trippers. roadtrippers.com
- **Square** (free POS, 2.6% per transaction) — For admission and gift shop sales. square.com
- **Shopify Lite** or **Square Online** — For online gift shop if they sell merchandise.
- **Social media** — Instagram and TikTok are primary discovery channels. Visitors create content — encourage it with photo spots, hashtags, and signs. The attraction IS the content.

## Compliance

- **Liability and insurance**: Visitors on the property need general liability coverage. If there are physical activities (climbing, mazes, rides), additional coverage and safety inspections apply. Consult an insurance agent specializing in attractions or tourism.
- **ADA accessibility**: Note what's accessible and what isn't. Outdoor and older attractions often have terrain challenges — be transparent on the website. "The main attraction is wheelchair accessible; the nature trail is not."
- **Zoning**: Commercial tourist attraction on rural or residential land needs appropriate zoning. If it's an existing attraction, this is likely settled. If converting property to an attraction, check with the planning office.
- **Occupancy and fire safety**: Indoor spaces need fire marshal approval and posted occupancy limits.
- **Food service**: If selling food (even pre-packaged), health department permits may apply. See [restaurant.md](restaurant.md) compliance.
- **Signage permits**: Highway signs and roadside billboards are regulated by state DOT and local ordinances. Those iconic "SEE THE GIANT BALL OF TWINE — 5 MILES" signs may require permits.

## Content ideas

Visitor photos and stories (with permission), the history of the attraction, "how it was built" stories, seasonal events, behind-the-scenes maintenance and updates, "on this day in history" posts, collaborations with other nearby attractions ("road trip route" content), press coverage and media appearances, anniversary celebrations, new additions or exhibits, "weirdest question we've been asked" posts, day-in-the-life of running the attraction.

**Video content** — Roadside attractions are inherently visual and shareable. Walk-through tours, visitor reactions, the story behind the attraction, time-lapse of setup or maintenance. TikTok and Instagram Reels drive discovery — one viral video can fill a parking lot.

## Key dates

- **National Road Trip Day** (last Fri May) — Perfect for "add us to your route" content. Promote road trip itineraries that include the attraction.
- **Tourist season** (Memorial Day–Labor Day in most locations) — Peak traffic. Keep hours extended, staff the gift shop, post daily.
- **Fall foliage / harvest season** (Sep–Oct) — Second peak for many attractions, especially those in scenic areas.
- **Atlas Obscura Day** (if running events) — Community-organized events at unusual places.

See `seasonal-calendar/` for broader tourism hooks tagged `types: hospitality`.

## Structured data

Use `TouristAttraction` with:
- name, address, phone
- `openingHoursSpecification`
- `isAccessibleForFree` (or `offers` with pricing)
- `image` — multiple photos
- `description` — what makes it worth the stop
- `touristType` — families, road trippers, etc.

If there's a gift shop, add `Store` as an additional type on the shop page.

## Data tracking

- **Visitors:** Date, Count (if tracked), Source (Google/TripAdvisor/highway sign/word of mouth), Group (Individual/School/Tour Bus/Event), Notes
- **Gift shop:** handled by POS (Square)
- **Events:** Client, Date, Type (Field Trip/Birthday/Private/Corporate), Guest Count, Price, Status, Notes
- **Press:** Outlet, Date, Type (Article/TV/Podcast/Social), Link, Notes
