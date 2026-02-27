# Artist, Maker & Craftsperson

Covers: visual artists, sculptors, potters, woodworkers, jewelers, fiber artists, printmakers, glassblowers, leatherworkers, any handmade goods maker. See also [photography.md](photography.md) for photographers/videographers and [tattoo.md](tattoo.md) for tattoo artists.

## Pages

- **Portfolio / gallery** — The core of the site. Large, high-quality images. Organize based on what the owner makes:
  - **Fine art / studio work** — By medium, series, or chronology.
  - **Made-to-order / event work** — By occasion or use case (weddings, birthdays, holidays, corporate). This is common for custom cookies, cakes, jewelry, clothing, furniture — anything commissioned for a specific event.
  - **Mixed** — Categories that make sense for the work. Ask the owner: "How would a customer browse your work — by what it's made of, or by what it's for?"
- **Shop** — If selling directly. Link to the marketplace they already use (Etsy, Big Cartel, Ko-fi) or an on-site store. Even a simple "available works" page with prices and a "contact to purchase" button works. See marketplace integration below.
- **About** — Artist statement, background, influences, process. Collectors and galleries want to understand the person behind the work.
- **Custom orders / commissions** — If they take custom work. The page should walk a customer through the process step by step:
  1. What to include in a request (what they want, when they need it, budget range, inspiration photos)
  2. How pricing works ("starting at $X" or "request a quote" — see pricing guidance below)
  3. Lead time ("order 2–3 weeks before your event")
  4. What happens next (quote → deposit → design approval → production → delivery/shipping)
  5. Examples of past custom work, organized by type
  - Include a contact form or inquiry form that collects the key details upfront. This saves back-and-forth.
- **Events / exhibitions** — Upcoming shows, markets, open studio dates, gallery exhibitions. Past events build credibility.
- **Process** — Behind-the-scenes photos or write-ups of how work is made. Fascinating to buyers and great for social sharing.
- **Shipping** — If they ship products. Shipping policy, turnaround time, zones/costs, how items are packaged and protected. For fragile or perishable items, set expectations ("here's how we pack for safe delivery"). Seasonal notes if relevant (e.g., chocolate in summer, plants in winter).
- **Contact** — Email, social links, studio visit policy. Include wholesale/gallery inquiries if applicable.
- **Press / CV** — If they exhibit or sell to galleries. Exhibition history, publications, awards, residencies. Standard format for the art world.

## Tools

- **Big Cartel** (free for 5 products, proprietary) — Simple online store built for makers. Clean, minimal. bigcartel.com
- **Ko-fi** (free, no fees on donations) — Commissions, memberships, shop. Indie-friendly and creator-focused. ko-fi.com
- **Etsy** (listing fee + 6.5% transaction fee) — Marketplace for discovery. See marketplace integration below.
- **Square** (free POS, proprietary) — For in-person sales at markets, fairs, and studio visits. Also good for professional invoicing on custom orders.
- **Informal payments** — Many makers start with Venmo, PayPal, or Cash App. These work for casual sales but lack invoicing, receipts, and buyer/seller protection. Don't replace what's working — suggest Square or Stripe invoicing when they're ready, especially for custom orders with deposits.

### Marketplace integration (Etsy, Faire, etc.)

Many makers sell on Etsy or similar marketplaces. The website and marketplace serve different purposes — both are valuable:

- **Marketplace** = discovery. New customers find the maker through Etsy search. Etsy handles payment, shipping labels, and reviews. The trade-off is fees (6.5%+ per transaction) and no control over the customer relationship.
- **Website** = home base. Repeat customers, custom orders, full portfolio, the maker's story. No fees on sales. Full control over branding and customer data.

How to connect them:
- Link to the Etsy shop from the website's Shop page. Don't duplicate every listing — the website shop page can be a curated selection or "available works" with a prominent "Browse the full shop on Etsy" link.
- Drive repeat customers to the website. Include the website URL on Etsy packaging, thank-you cards, and order messages: "Next time, order directly at [website] — same products, no marketplace fees."
- Feature Etsy reviews on the website. Pull standout reviews (manually — copy the text with attribution) into a testimonials section. Social proof from Etsy is powerful.
- Blog posts on the website drive search traffic that Etsy can't. "How to choose wedding cookies" brings the customer to the website, where they find the custom order form.

### Pricing for custom work

Not all makers have a fixed price list. Custom work pricing depends on complexity, size, materials, and timeline. Valid pricing models for the website:

- **"Starting at" pricing** — "$48/dozen for simple designs, $72/dozen for detailed work." Gives customers a ballpark.
- **Price ranges by category** — A table or list showing ranges for different product types.
- **"Request a quote"** — A form that collects project details. Best for highly custom work. Include example pricing on the page so customers know the general range before inquiring.
- **Tiered packages** — "Basic / Standard / Premium" with clear descriptions of what's included at each level.

Pick whichever model matches how the maker already prices their work. The website should make pricing transparent enough that customers self-qualify — they should know if they're in the right budget range before reaching out.

## Compliance

- **Sales tax**: Applies to physical goods sold in most states. Online sales may trigger nexus in multiple states. Market platforms (Etsy, Big Cartel) handle collection in most cases.
- **Resale certificates**: If selling wholesale to galleries or shops, understand resale certificate exemptions.
- **Copyright**: The artist owns copyright to their work by default. Consider adding a copyright notice to the website. If selling prints or reproductions, be clear about edition sizes and licensing.
- **Shipping**: Display shipping policy, turnaround time, and packaging details on the website. Some materials (solvents, certain paints) can't be shipped standard — check carrier restrictions. For fragile items (ceramics, glass), describe the packaging process to build buyer confidence. For perishable items (food, plants), note seasonal restrictions and delivery expectations.
- **Craft fair/market permits**: Many require business licenses, sales tax permits, or liability insurance. Check each venue's requirements.

## Content ideas

New work, process photos, commission availability, exhibition announcements, inspiration and influences, behind-the-scenes of studio life, material spotlights, "from sketch to finished piece" progressions, market and fair schedules, customer stories (who bought what and why), packaging and shipping stories, seasonal collections, collaboration announcements, tips for collectors.

## Key dates

- **World Art Day** (Apr 15) — Share your process, studio tour, or new work.
- **Arts & Humanities Month** (Oct) — Broader cultural celebration. Open studio events, community art projects, exhibition announcements.
- **Small Business Saturday** (Sat after Thanksgiving) — Many makers participate in holiday markets and pop-ups.

## Structured data

Use `ArtGallery` or `Store` with:
- name, address (if studio/gallery), phone
- `makesOffer` for available works
- Use `Product` for individual pieces with `name`, `image`, `price`, `availability`
- Use `VisualArtwork` for portfolio pieces with `artMedium`, `artworkSurface`, `width`, `height`

## Data tracking

- **Customers:** Name, Email, Phone, Type (Collector/Gallery/Wholesale/Commission), Interests, Source, Created Date
- **Works:** Title, Medium, Dimensions, Price, Status (Available/Sold/NFS/Commission), Date Completed, Location, Photo
- **Commissions:** Client (linked), Description, Size, Medium, Price, Deposit Paid, Status (Inquiry/Accepted/In Progress/Complete/Delivered), Due Date, Notes
- **Events:** Name, Type (Exhibition/Market/Fair/Open Studio), Venue, Dates, Status, Notes
