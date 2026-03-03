# Animal Shelter & Rescue

Covers: animal shelters, humane societies, breed-specific rescues, wildlife rehabilitation, spay/neuter clinics.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Adoptable animals** — The most-visited page by a wide margin. Each animal needs: photo, name, breed/mix, age, sex, temperament notes, and a link or call to action to start the adoption process. Updated frequently.
- **How to adopt** — Process overview, fees, requirements, application link. Remove barriers — make it feel approachable.
- **Foster** — How fostering works, current needs, application. Fosters are the lifeblood of rescues.
- **Donate** — Financial support, wish list (supplies the shelter needs), sponsor an animal
- **Volunteer** — Opportunities (dog walking, cat socializing, events, transport), application or sign-up
- **About** — Mission, history, stats (animals saved), team
- **Services** — Spay/neuter, microchipping, surrendering an animal, lost-and-found, community cat (TNR) programs
- **Events** — Adoption events, fundraisers, galas, pet walks
- **Success stories** — Adopted animals in their new homes. The best fundraising content there is.
- **Contact** — Shelter address, hours, phone, lost pet hotline

## Design

- **Visual mood:** Warm, hopeful, and emotionally engaging. The website should make visitors fall in love with an animal before they ever visit the shelter.
- **Color direction:** Warm greens, soft blues, warm oranges, and earthy tones. Friendly and approachable. Avoid clinical whites or sterile palettes that feel institutional.
- **Typography feel:** Humanist sans-serif (Segoe UI/Roboto stack). Warm, friendly, and readable. The tone should match the animals — approachable and endearing.
- **Layout emphasis:** Pattern 4 (card grid) for adoptable animal listings — this is the most-visited page by far. Pattern 2 (hero + content) for the home page with adoptable animals and an adopt/foster CTA above the fold. Max-width 60rem to accommodate the card grid.
- **Photography style:** Individual pet photos — well-lit, warm, showing personality. Good shelter photos are the single most impactful website optimization for adoption rates. 1:1 or 4:5 for pet portraits, 16:9 for event and facility photos.
- **Key component:** Adoptable animal card — photo, name, breed or mix, age, personality description, and a "Meet Me" button. Each card should make the visitor want to visit.

## Tools

- **Shelterluv** (free for nonprofits, proprietary) — Shelter management with embeddable pet listings, applications, foster management. The website can embed their available animals widget. shelterluv.com
- **PetFinder** and **Adopt-a-Pet** — Listing platforms. Most shelters already use these. Link from the website and keep profiles in sync.
- **Shelterbuddy** or **Animal Shelter Manager** (open source) — Shelter management systems. sheltermanager.com is open source and free.
- **SignUpGenius** (free tier) — Volunteer scheduling.
- **GiveButter** (free, tips-based) — Fundraising with peer-to-peer support.

## Compliance

- **Animal photos and updates**: Animals should be photographed in good light, looking their best. Poor shelter photos reduce adoption rates. This is the most impactful website optimization.
- **Breed labeling**: Some jurisdictions restrict breed-specific legislation (BSL). Be aware of local regulations around labeling dogs by breed, especially pit bull-type dogs.
- **Hold periods**: Don't list animals for adoption before the legally required stray hold period has passed.
- **Spay/neuter requirements**: Most jurisdictions require animals to be spayed/neutered before or shortly after adoption. Note this in adoption info.
- **Disease disclosure**: Be transparent about known medical conditions of adoptable animals.

## Content ideas

New animal arrivals, adoption success stories (the #1 engagement driver), volunteer spotlights, foster family features, "pet of the week" features, seasonal safety tips (heatstroke, fireworks anxiety, antifreeze), spay/neuter awareness, fundraiser announcements, "wish list" updates, community cat program updates, lost-and-found alerts.

## Key dates

- **Spay/Neuter Awareness Month** (Feb) — Low-cost clinic promotions, education on benefits.
- **National Pet Day** (Apr 11) — Adoption spotlights, foster stories, volunteer appreciation.
- **Adopt a Shelter Pet Month** (Oct) — Adoption fee specials, success stories, available animals push.
- **National Animal Shelter Appreciation Week** (1st week Nov) — Volunteer recognition, impact numbers, donation drives.

## Structured data

Use `NGO` with:
- name, address, phone, hours
- `nonprofitStatus` — "Nonprofit501c3"
- `knowsAbout` — "animal welfare", "pet adoption"

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Adopter/Foster/Volunteer/Donor), Status, Notes, Created Date
- **Animals:** Name, Species, Breed, Age, Sex, Status (Available/Adopted/Foster/Hold), Photo URL, Intake Date, Notes
- **Applications:** Contact (linked), Animal (linked), Type (Adoption/Foster), Date, Status (Pending/Approved/Denied), Notes
