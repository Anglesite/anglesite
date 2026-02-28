# Printing & Signage

Covers: print shops, sign makers, screen printers, embroidery shops, custom apparel (t-shirts, hats, uniforms), promotional products, large format printing, vehicle wraps, banner and decal shops, engraving shops, trophy and award shops. See also [artist.md](artist.md) for custom design studios and [retail.md](retail.md) for shops that primarily sell finished goods.

## Pages

- **Services** — Everything you offer, organized by category: business printing (cards, letterhead, forms, envelopes), marketing materials (flyers, brochures, postcards, posters), signs (yard signs, banners, window graphics, vehicle wraps, monument signs), apparel (screen printing, embroidery, heat transfer, DTG), promotional products (pens, mugs, bags, stickers), specialty (engraving, trophies, plaques, wide format). Each service should note minimum order quantities and typical turnaround.
- **Portfolio / gallery** — Photos of completed work. Organize by category. Vehicle wraps, storefront signs, custom t-shirts, business card designs, event banners. Before-and-after for sign installations. This is the page that sells — show the range and quality.
- **How to order** — The process from start to finish. File submission requirements (formats accepted, resolution, bleed, color mode), proofing process, turnaround times, delivery/pickup options. For sign shops: site survey, design, permitting, fabrication, installation timeline.
- **File guidelines** — Technical page for designers and returning customers: accepted file formats (.pdf, .ai, .eps, .png), minimum resolution (300 DPI for print, 150 DPI for large format), color space (CMYK for print, Pantone for screen printing), bleed requirements, template downloads if available. This saves back-and-forth on every order.
- **Request a quote** — Form with: project type, quantity, size, colors, material preferences, deadline. Upload field for artwork. The quote request form is the primary conversion tool. Keep it simple — don't require fields you don't need.
- **About** — Shop history, team, equipment capabilities, certifications. "Family-owned since 1987" or "union shop" are differentiators. Show the shop and equipment — customers want to see where their work is produced.
- **Blog** — Design tips, material comparisons, project spotlights, industry trends, seasonal marketing tips for businesses. "How to prepare artwork for screen printing" is evergreen search content.
- **Contact** — Phone, email, address, hours, directions. Walk-in vs. appointment. Parking. Note if the shop has a front counter or is production-only.

## Tools

- **Printavo** (~$49/mo, proprietary) — Shop management for screen printers and custom apparel. Quotes, invoices, production workflow, customer management. printavo.com
- **ShopVOX** (~$49/mo, proprietary) — Sign shop and print shop management. Estimates, production scheduling, job tracking. shopvox.com
- **InkSoft** (pricing varies, proprietary) — Online stores for custom apparel. Customers design and order directly. Good for screen print shops offering team stores or fundraisers. inksoft.com
- **Square** (free POS, 2.6% per transaction) — For walk-in counter sales and simple invoicing.
- **Canva** (free tier, proprietary) — Some shops use Canva to collaborate on designs with customers who don't have design software.
- **Google Business Profile** — Essential. People search "printing near me," "custom t-shirts [town]," "sign shop near me." Complete with photos of work.

## Compliance

- **Sign permits**: Most municipalities require permits for permanent exterior signs. The sign shop often handles permitting as part of the job, but the property owner or tenant is the applicant. Note on the website: "We handle sign permits for most jurisdictions in the [area]." Permit requirements vary wildly by municipality — size limits, lighting restrictions, height limits, historic district rules.
- **Vehicle wrap regulations**: Most states allow vehicle wraps, but some municipalities restrict wraps on commercial vehicles (window coverage, reflective materials). Note any known restrictions for the service area.
- **Zoning for sign installation**: Some areas restrict sign installation businesses to commercial/industrial zones. If the shop does off-site installations, verify contractor licensing requirements.
- **Copyright and trademark**: The shop may be asked to reproduce copyrighted logos, images, or trademarked materials. The shop should verify that the customer has rights to reproduce the material. Note on the website or in the order form: "Customer certifies they have the right to reproduce all submitted artwork."
- **OSHA and chemical safety**: Screen printing involves chemicals (inks, solvents, emulsions). OSHA compliance for ventilation, PPE, and chemical storage. Not a website concern, but worth knowing.
- **Sales tax**: Custom printing may or may not be taxable depending on the state and the type of product. Some states tax finished goods but exempt services. Consult a tax advisor.

## Content ideas

Project spotlights with photos (with client permission), material comparisons (vinyl vs. coroplast, screen print vs. DTG, matte vs. glossy), file preparation tips, design trends, seasonal product promotions (graduation banners, election yard signs, holiday cards, team uniforms), customer success stories ("how a new sign increased foot traffic"), equipment and process behind-the-scenes, tips for choosing colors and fonts, community event sponsorships, trade show recaps, staff spotlights.

## Key dates

- **Election season** (varies, especially Sep–Nov in even years) — Yard signs, banners, bumper stickers. The biggest rush for many sign and print shops. Start promoting early.
- **Graduation season** (May–Jun) — Custom banners, lawn signs, announcements, party decorations.
- **Back to school** (Aug–Sep) — Team uniforms, spirit wear, school event printing.
- **Holiday season** (Nov–Dec) — Holiday cards, gift items, promotional products for corporate gifts.
- **Trade show season** (varies) — Banners, booth graphics, promotional giveaways. Often planned months in advance.
- **Small Business Saturday** (Saturday after Thanksgiving) — Local business promotions. Cross-promote with other local businesses.
- **Spring sports** (Mar–May) — Team uniforms, tournament banners, sponsor signs.

## Structured data

Use `LocalBusiness` with `additionalType` of `ProfessionalService`:
- `name`, `address`, `telephone`
- `openingHours`
- `areaServed` — delivery/installation area
- `hasOfferCatalog` — list services with descriptions and pricing if available

## Data tracking

- **Jobs:** Job Number, Customer, Project Type, Description, Quantity, Due Date, Status (Quote/Approved/In Production/Ready/Picked Up/Shipped), Total, Payment Status, Notes
- **Customers:** Name, Company, Email, Phone, Type (Business/Individual/Nonprofit/School), Projects (linked), Notes
- **Quotes:** Quote Number, Customer, Project Type, Description, Quantity, Price, Status (Sent/Accepted/Declined/Expired), Date, Notes
