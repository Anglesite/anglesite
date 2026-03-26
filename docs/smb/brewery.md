# Brewery / Winery / Distillery

Covers: craft breweries, microbreweries, brewpubs, wineries, vineyards, distilleries, cideries, meaderies, tasting rooms.

## Pages

- **Taproom / tasting room** — Hours, location, atmosphere, food available (menu or food trucks), live music or events. The taproom is the business — make it inviting.
- **Our beers / wines / spirits** — Current offerings with descriptions, style, ABV, tasting notes. Rotate seasonally. Photos of the products.
- **About** — The story: why you started, your process, your philosophy. Craft beverage is built on authenticity and story.
- **Events** — Trivia nights, live music, release parties, harvest festivals, pairing dinners. Events drive repeat visits.
- **Tours & tastings** — Booking, what to expect, group sizes, private events. If no tours, say so to avoid inquiries.
- **Shop / order** — Merch, gift cards, to-go sales (growlers, bottles, cans). Direct-to-consumer shipping if legally permitted in your state.
- **Distribution / find us** — Where to find the product: bars, restaurants, retail stores. Map or list by area. For businesses that distribute beyond the taproom.
- **Private events** — Venue rental for weddings, parties, corporate events. Many taprooms generate significant revenue from private events.
- **Blog** — Brewing/winemaking process, ingredient spotlights, new release announcements, event recaps.
- **Contact** — Phone, email, reservations if applicable.

## Design

**Visual mood:** Craft, artisanal, community gathering place. The vibe depends on the taproom: industrial (dark, textured, exposed materials), rustic (wood tones, warm, lodge-like), or modern (clean, minimal, Scandinavian). Match the physical space.

**Color direction:** Warm earth tones or dark moody palettes — amber, charcoal, deep brown, copper, cream. Dark backgrounds work well for the industrial vibe. Avoid bright or playful colors unless the brand is explicitly fun/casual.

**Typography feel:** Classic stack (Georgia serif) for traditional or rustic breweries, modern stack (system-ui) for contemporary taprooms. Heading weight 700+. The beer names and tap list should be easy to scan.

**Layout emphasis:** Taproom hours and the current tap list should be prominent — above the fold. Home page uses Pattern 2 (hero + content) with an atmospheric taproom photo. Beer list uses Pattern 4 (card grid) for individual beer cards. Max-width 56rem.

**Photography style:** Atmospheric interior shots — the taproom, the bar, the brewing equipment. Beer close-ups with rich color and texture. Event photos showing community. 4:3 aspect ratio. Warm, moody lighting matches the space.

**Key component:** Current tap list — each beer displayed as a card or row with beer name, style, ABV, and tasting notes. Indicate what's on tap now vs. seasonal/coming soon. Update whenever the taps rotate.

## Tools

- **Untappd for Business** (~$50+/mo, proprietary) — Brewery menu management, customer check-ins, print menus. untappd.com
- **Arryved** (pricing varies, proprietary) — Taproom POS built for breweries. Tab management, pour tracking. arryved.com
- **Ekos Brewmaster** / **Orchestrated Beer** — Brewery management: inventory, production, distribution.
- **Commerce7** (pricing varies, proprietary) — Wine DTC e-commerce, wine club management, reservations.
- **Square** (free POS, proprietary) — Good for smaller taprooms. Payments, tabs, basic inventory.
- **Eventbrite** (free for free events, proprietary) — Event ticketing and promotion.

## Review platforms

- **Google Business Profile** — "Breweries near me" and "taprooms in [city]" are common searches. The profile photo, hours, and review response quality strongly influence whether someone chooses this taproom over the next. Update it whenever tap hours or seasonal offerings change.
- **Yelp** — Well-used for breweries and taprooms, especially in cities. Yelp reviewers tend to describe the atmosphere, beer quality, and food in detail — the qualities that differentiate a craft taproom.
- **Untappd** — The dominant beer-specific check-in and review platform. Craft beer fans use Untappd to discover new breweries, track beers they've tried, and share ratings. Claim the brewery page on Untappd and keep the beer list current.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Federal licensing (TTB)**: The Alcohol and Tobacco Tax and Trade Bureau (TTB) issues permits for breweries, wineries, and distilleries. Display your permit type (e.g., Brewer's Notice, Basic Permit).
- **State ABC licensing**: State alcohol beverage control laws vary dramatically. Taproom hours, Sunday sales, food requirements, distribution rights — all state-specific. Display your state license.
- **Age verification**: The website itself doesn't legally need an age gate, but if selling online (DTC shipping), you must verify age at purchase and delivery. Many craft beverage sites use an age gate splash page — it's industry convention even when not strictly required.
- **Direct-to-consumer shipping**: Wine shipping is legal in most states; beer and spirits DTC is legal in far fewer. Check state-by-state before adding an online shop. Never ship to a state where it's prohibited.
- **Labeling and advertising**: TTB regulates alcohol advertising. Don't make health claims. Required label elements if selling packaged products.
- **Food safety**: If serving food (brewpub), standard food service licensing applies.
- **Taproom capacity / occupancy**: Display capacity if required by local fire code.
- **Responsible service**: Mention responsible consumption. Many states require visible signage about drinking and driving — extend this to the website.

## Content ideas

New release announcements, brewing/winemaking process stories, ingredient spotlights (hops, grapes, grain), food pairing guides, event recaps, taproom playlist or vibe features, seasonal specials, collaboration brew stories, "meet the brewer/winemaker," harvest updates (wineries), sustainability practices, behind-the-scenes production, local agriculture partnerships, award announcements.

## Key dates

- **National Beer Day** (Apr 7) — Taproom specials, beer history posts, new release timing.
- **American Craft Beer Week** (mid-May) — Brewery tours, collaboration brews, tap takeovers.
- **Oktoberfest** (Sep–Oct) — Seasonal releases, German-style events, food pairings.
- **National Wine Day** (May 25) — For wineries. Tasting events, vineyard tours, new vintage releases.
- **Repeal Day** (Dec 5) — End of Prohibition anniversary. History posts, special tappings.

## Structured data

Use `Brewery`, `Winery`, or `LocalBusiness` with:
- name, address, phone, hours
- `servesCuisine` if brewpub
- `hasMenu` for beer/wine list
- `event` for upcoming events

## Data tracking

- **Products:** Name, Style/Type, ABV, Status (On Tap/Available/Seasonal/Retired), Description, Notes
- **Events:** Name, Date, Type (Music/Trivia/Release/Private), Capacity, Tickets (yes/no), Notes
