# Retail Shop

Covers: gift shops, boutiques, clothing stores, toy stores, antique shops, thrift stores, specialty retail, general merchandise. See also [bookshop.md](bookshop.md), [grocery.md](grocery.md), [hardware.md](hardware.md), [florist.md](florist.md) for specific retail subtypes.

## Pages

- **Shop / products** — Even if they don't sell online, showcasing products brings people to the store. Categories with photos and price ranges. If they sell online, link to their e-commerce platform.
- **Hours / location** — Essential. Include holiday hours, parking info, and landmarks for wayfinding.
- **About** — The story of the shop. How it started, what makes it different from a big-box store, the owner's expertise.
- **New arrivals** — A regularly updated page or section. Gives repeat visitors a reason to come back.
- **Gift guide / registry** — If applicable. Seasonal gift guides are great for search traffic.
- **Events** — Trunk shows, workshops, sidewalk sales, holiday open houses.
- **Contact** — Phone, email, directions. "Can I check if you have something in stock?" is a common reason to call.

## Tools

- **Square** (free POS, proprietary) — Good for in-person and simple online sales. Easy setup, no monthly fee for basic POS. square.com
- **WooCommerce** (open source, self-hosted) — Full online store. More setup but no monthly fees. Best if they want e-commerce on their own website.
- **Shopify** ($39/mo, proprietary) — Polished but expensive. Only recommend if WooCommerce is too complex and they need a full e-commerce platform.
- **Big Cartel** (free for 5 products, proprietary) — Lightweight option for shops with a small product line.

## Compliance

- **Sales tax collection**: Must collect and remit state/local sales tax. If selling online, nexus rules may require collecting tax in multiple states.
- **Return/refund policy**: Must be posted (many states require it). Display on the website — builds buyer confidence.
- **Consumer protection**: Truth-in-advertising rules apply to pricing, "sale" claims, and product descriptions.
- **PCI compliance**: If accepting credit cards online, ensure the payment processor handles PCI requirements (Square, Shopify, etc. do this).
- **ADA compliance**: Physical store accessibility should be noted on the website for customers with mobility needs.

## Content ideas

New products, restocks, sale announcements, how-to guides for products, customer stories, local event participation, behind-the-scenes of buying trips, product spotlights, gift guides (Mother's Day, holidays, graduation), "staff picks" features, seasonal merchandising, small business Saturday prep, collaboration with other local shops.

## Key dates

- **Small Business Saturday** (Sat after Thanksgiving) — The biggest day for independent retail. Plan promotions, window displays, social media campaign. Lead time: 3 weeks.
- **National Shop Local Week** (varies) — Extended version of Small Business Saturday. Cross-promote with neighboring shops.

## Structured data

Use `Store` (or `ClothingStore`, `BookStore`, `HobbyShop`, etc.) with:
- name, address, phone, `openingHoursSpecification`
- `priceRange`
- `paymentAccepted`
- `currenciesAccepted`

For products displayed online, add `Product` schema with `name`, `price`, `availability`.

## Data tracking

- **Customers:** Name, Email, Phone, Interests/Preferences, Source, Mailing List (checkbox), Created Date
- **Products:** Name, Category, Price, Cost, Inventory, Supplier, Status
- **Orders:** Customer (linked), Date, Items, Total, Status, Channel (In-store/Online)
