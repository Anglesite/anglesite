# Auto Dealer

Covers: used car dealerships, independent auto dealers, specialty/classic car dealers, motorcycle dealers, RV dealers, powersports.

## Pages

- **Inventory** — Current vehicles with photos, price, mileage, features, VIN, vehicle history report link. This is the most important page. For small dealers, a well-organized gallery works. For larger inventories, link to a listing platform rather than maintaining a full inventory system on the website.
- **Financing** — Finance options, credit application link (to a secure portal, not a website form), buy-here-pay-here terms if applicable. Pre-approval process.
- **About** — Dealer story, values, years in business, team. Independent dealers compete on trust — especially against the "used car salesman" stereotype.
- **Testimonials** — Customer reviews with photos of happy buyers. Reviews on Google, Yelp, Facebook, and DealerRater all matter — encourage customers to leave reviews where they already have accounts.
- **Services** — If offering maintenance, detailing, inspections. Service department hours.
- **Trade-in** — How to get a trade-in value, what to bring.
- **Contact / visit** — Hours, directions, test drive scheduling.

## Design

**Visual mood:** Bold, trustworthy, and inventory-focused. The site should feel confident and professional — combating the "used car lot" stereotype with clean design and transparency.

**Color direction:** Dark backgrounds (black, dark gray) with a bright accent color (red, blue, or white). High contrast and modern. Avoid anything that feels cheap or cluttered.

**Typography feel:** Modern stack (system-ui) with heavy headings. Bold and direct. The typography should convey confidence and clarity.

**Layout emphasis:** Current inventory and search above the fold — visitors come to browse vehicles. Pattern 4 (card grid) for vehicle listings. Max-width 64rem to give vehicle cards room.

**Photography style:** Vehicle photography on clean backgrounds with multiple angles. Consistent framing across the inventory. 16:9 for the hero image, 4:3 for vehicle cards.

**Key component:** Vehicle listing card — photo, year/make/model, mileage, price, and a "View Details" button. Clean, scannable, and honest. Every card should answer: "What is it, how many miles, and how much?"

## Tools

- **DealerSocket** / **vAuto** / **Frazer** — Dealer management and inventory systems. Industry-specific. Don't replace these.
- **AutoTrader** / **Cars.com** / **CarGurus** — Listing platforms. The website complements these, it doesn't replace them.
- **Square** (free POS, proprietary) — For smaller operations, down payments, accessories.
- For very small dealers (10–20 cars), the website is primarily a credibility tool. Most actual inventory browsing happens on listing platforms.

## Compliance

- **State dealer licensing**: All states require dealer licenses. Display your license number.
- **FTC Used Car Rule (Buyers Guide)**: Every used car must have a Buyers Guide displayed on the vehicle. The website should mention your warranty policy (as-is vs. limited warranty).
- **Truth in Lending (Reg Z)**: If advertising financing terms, specific disclosures are required (APR, down payment, terms). If you say "low monthly payments," you must include the full terms.
- **Odometer disclosure**: Federal and state law. Don't misrepresent mileage.
- **Lemon laws**: Vary by state. Know your state's used vehicle lemon law and note any applicable warranties.
- **As-is sales**: If selling as-is, this must be clearly disclosed. Some states restrict as-is sales.
- **Privacy**: Credit applications collect sensitive data (SSN, income). Never collect this through website forms — link to a secure finance portal.

## Content ideas

New inventory spotlights, vehicle comparison guides, financing tips, "what to look for in a used car," maintenance tips by vehicle type, customer delivery photos, local car show events, seasonal driving tips, vehicle recall alerts, "trade-in vs. sell privately" guides.

## Key dates

- **National Car Care Month** (Apr, Oct) — Maintenance tips, service specials, inspection reminders.

## Structured data

Use `AutoDealer` (schema.org) with:
- name, address, phone, hours
- `hasOfferCatalog` for inventory categories

## Data tracking

- **Inventory:** Year, Make, Model, VIN, Mileage, Price, Status (Available/Pending/Sold), Date Acquired, Notes
- **Leads:** Name, Phone, Email, Vehicle Interest, Source, Status (New/Contacted/Test Drive/Sold/Lost), Notes
