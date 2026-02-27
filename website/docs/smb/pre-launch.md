# Pre-Launch Businesses

Not every owner who runs `/start` has an established business. Some are just getting started — they might not have a name, a license, or even a clear plan yet. The website is their first step. That's fine. Meet them where they are.

## How to detect a pre-launch business

Listen for clues during Step 1 of `/start`:

- "I'm still figuring out the name"
- "I haven't officially started yet"
- "I don't have customers yet"
- "I'm thinking about starting a..."
- "I just have an idea right now"
- No business phone, no address, no hours
- Answers to "how do customers find you?" are blank or aspirational

Don't press for details they don't have. A website doesn't require a business license. Build what they have now and tell them the site will grow with them.

## What to do differently

### During /start

- Skip questions they can't answer yet (address, phone, hours). These can be added later.
- For `BUSINESS_TYPE`, use their best description. If they're unsure, use `service` as a default — it's the most flexible.
- For goals, listen for pre-launch signals: "build credibility," "look professional," "have something to share," "test the idea." These are different from "get phone calls" or "book appointments."

### During design

- Keep the site simple. Home page, about page, contact page, blog. Don't create pages for services or products they haven't defined yet.
- The about page is the most important page for a new business. It answers "who is this person and why should I trust them?"
- A blog is especially valuable for new businesses — it builds search presence before the business has customers to generate word-of-mouth.

### After setup

Share relevant resources from the list below. Don't dump the entire list — pick 2–3 that match their situation.

## Free resources for new business owners

### Business formation

- **SBA.gov** — U.S. Small Business Administration. Business plan templates, legal structure guidance (LLC vs. sole proprietor vs. S-corp), state-specific registration links. sba.gov/business-guide
- **SCORE** — Free mentoring from experienced business owners. Virtual and in-person. 1,000+ chapters. score.org
- **Small Business Development Centers (SBDCs)** — Free consulting and low-cost training. Hosted by universities. One in every state. americassbdc.org
- **State Secretary of State website** — Where to actually register the business. Search "[state] business registration" or "[state] secretary of state business."

### Legal basics

- **EIN (Employer Identification Number)** — Free from the IRS. Needed for a business bank account. Takes 5 minutes online. irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online
- **Business license** — Requirements vary by city and county. Search "[city] business license" for the local process.
- **Permits** — Industry-specific. Food requires health permits, childcare requires licensing, contractors need trade licenses. Check `docs/smb/` for the business type's compliance section.
- **Insurance** — General liability at minimum. Some industries require specific coverage (professional liability, workers' comp). Talk to a local insurance agent.

### Financial

- **Business bank account** — Separate from personal. Most banks and credit unions offer free or low-cost business checking. Needed before accepting payments.
- **Bookkeeping** — Wave (free, proprietary) for invoicing and accounting. waveapps.com. Or a spreadsheet — don't overcomplicate it at the start.
- **Taxes** — Sole proprietors file on Schedule C. LLCs and S-corps have different requirements. The SBA and SCORE can help navigate this. Consider a local CPA for the first year.

### Local support

- **Public library** — Business resource centers, free databases (ReferenceUSA, Gale), meeting rooms, workshops. Underrated.
- **Chamber of Commerce** — Networking, local directory listing, business events. Worth joining once the business is active.
- **Community college** — Small business courses, continuing education, sometimes free workshops.
- **Local economic development office** — Grants, incentives, startup programs. Search "[city/county] economic development."

### Brand and identity

- **Business name** — If they don't have one yet, that's OK. The website can launch with a working name and update later. Don't let naming block progress.
- **Logo** — A logo helps but isn't required to start. Free options:
  - **Canva** (free tier) — Logo maker with templates. Good enough to start. canva.com
  - **Looka** (free to design, paid to download) — AI-assisted logo generator. looka.com
  - **Hatchful by Shopify** (free) — Simple logo maker. hatchful.shopify.com
- **Professional design** — When they're ready to invest (~$200–$2,000 range):
  - **99designs by Vistaprint** — Design contests and 1:1 projects. 99designs.com
  - **Local graphic designer** — Ask at the Chamber of Commerce, SBDC, or community college design program. Supporting local is on-brand.
  - **Fiverr / Upwork** — Budget option. Quality varies — review portfolios carefully.
- **Brand colors and fonts** — Canva's brand kit tool can help choose a palette. During `/design-interview`, the agent will set up CSS custom properties for colors and typography.

### Online presence basics

- **Google Business Profile** — Free. Claim it as soon as the business has a name, phone number, and either an address or service area. business.google.com
- **Domain name** — Can buy one during `/deploy` even before the business is officially registered. The domain doesn't need to match the legal business name.
- **Social media** — Claim the business name on relevant platforms before someone else does. Even if inactive, it reserves the name.

## What NOT to recommend

- **Don't recommend paid tools** to someone who doesn't have revenue yet. Free tiers only.
- **Don't recommend business formation services** (LegalZoom, Incfile, etc.) — the owner can file directly with the state for less money. SCORE or an SBDC advisor can help for free.
- **Don't recommend building a full e-commerce site** before they have products or customers. Start with a simple site and add commerce later.
- **Don't overwhelm them.** Two or three next steps, not twenty. The website is already a great first step — celebrate that.

## Revisiting later

Once the business is up and running, the owner can:
- Run `/design-interview` to add pages for new services or products
- Run `/setup-customers` to set up customer management
- Run `/deploy` to put the site on the internet
- Add address, phone, and hours to `.site-config` when they're ready
