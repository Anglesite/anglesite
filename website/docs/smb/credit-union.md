# Credit Union

Covers: credit unions, community development financial institutions (CDFIs), lending circles, cooperative banks.

## Pages

- **Accounts** — Checking, savings, money market, CDs. Compare features, rates, and fees clearly. People switch to credit unions for transparency — deliver on that.
- **Loans** — Auto, personal, home, home equity, credit builder. Current rates, calculators, application link. Rates are the #1 reason people visit the site.
- **Rates** — Dedicated rate page updated regularly. Savings APY, loan APR, CD terms. Easy to scan. This page gets bookmarked.
- **Membership** — Who can join (field of membership), how to join, what you need. Credit unions have eligibility requirements — make them clear and welcoming, not gatekeeping.
- **About** — Cooperative structure, history, mission, board of directors, annual report. Emphasize member-owned, not-for-profit — this is the differentiator from banks.
- **Locations / ATMs** — Branches with hours, drive-through availability, ATM locations, shared branching / CO-OP ATM network access
- **Online / mobile banking** — Features, enrollment, app download links, demo screenshots
- **Financial education** — Workshops, webinars, blog posts, calculators, youth programs. Credit unions have a mandate to promote financial literacy.
- **Community** — Sponsorships, scholarships, volunteer activities, charitable giving. Credit unions exist to serve their community — show it.
- **Contact** — Phone, email, branch-specific contacts, lost/stolen card hotline (prominent)
- **Careers** — Open positions, benefits, culture. Credit unions are local employers.

## Tools

- Credit unions use regulated core banking systems (Symitar, Corelation, CU*Answers, etc.) — never suggest replacing these. The website links to online banking; it doesn't provide it.
- **CO-OP Shared Branch / ATM locator** — Embed or link to the CO-OP locator so members can find shared branches and fee-free ATMs nationwide.
- **Financial calculators** — Many free embeddable calculators exist (CalcXML, Bankrate widgets). Add loan payment, savings, and mortgage calculators.
- **Calendly** or **Cal.com** (open source, free tier) — For scheduling loan consultations or financial counseling appointments.
- Most credit unions have a website through their core provider or a CU-specific vendor (CU*Answers, CUNA, etc.). Anglesite may be a fit for very small credit unions or CDFIs that don't have a website yet.

## Compliance

- **NCUA insurance**: Display the NCUA (National Credit Union Administration) logo and "Federally Insured by NCUA" on every page — typically in the footer. This is required. Equivalent to FDIC for banks.
- **Equal Housing Lender**: If the CU offers mortgage or home equity products, display the Equal Housing Lender logo and statement.
- **Truth in Lending / Truth in Savings**: Rate pages must comply with Regulation Z (lending) and Regulation DD (savings). Rates must include APR/APY, terms, and conditions. Consult compliance staff before publishing rates.
- **BSA/AML**: Don't collect account numbers, SSNs, or financial details through website forms. All account opening must go through the core banking system's secure portal.
- **ADA / WCAG**: Financial institution websites face heightened ADA scrutiny. WCAG AA is the minimum. Ensure rate tables, calculators, and PDFs are accessible.
- **Privacy policy**: Required under Gramm-Leach-Bliley Act. Must be prominently linked.
- **NMLS**: If listing loan officers, include NMLS numbers where required.
- **Field of membership**: Clearly state who is eligible to join. This is a regulatory requirement.

## Content ideas

Rate change announcements, financial literacy tips (budgeting, credit building, home buying), community event sponsorships and recaps, member spotlights (with consent), new product or service announcements, scholarship recipient features, fraud and scam alerts, holiday closures, annual meeting announcements, "why credit unions are different" explainers, youth savings program updates, partnership announcements with local organizations.

## Key dates

- **America Saves Week** (Feb) — Savings challenges, financial goal-setting, account promotions.
- **National Financial Literacy Month** (Apr) — Educational workshops, youth programs, budgeting resources.
- **International Credit Union Day** (3rd Thu Oct) — Member appreciation, community impact stories, the credit union difference.

## Structured data

Use `CreditUnion` with:
- name, address, phone, hours
- `areaServed` for field of membership geography
- `memberOf` — link to shared branching network if applicable

## Data tracking

Credit union member data is in the core banking system — never duplicate it externally. Tracking here is limited to non-member-facing operations:

- **Community:** Event Name, Date, Type (Sponsorship/Scholarship/Volunteer/Workshop), Partner, Notes
- **Financial Education:** Workshop Name, Date, Instructor, Attendees, Topic, Notes
