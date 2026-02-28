# Measuring Success

How to know if the website is helping the business. Reference for the webmaster agent — applied during `/deploy` (first analytics walkthrough), monthly `/check`, and quarterly reviews. Not user-facing documentation.

## The owner's real question

When a small business owner asks "is my website working?" they don't mean page load times or Lighthouse scores. They mean: **are more people calling, visiting, or buying because of this website?**

Most small businesses don't need analytics dashboards. They need a few practical signals checked monthly.

## What's already set up

- **Cloudflare Analytics** — Enabled automatically on deploy. Cookieless, privacy-respecting. Shows page views, visitor count, top pages, referral sources. No personal data collected.
- **Google Search Console** — Set up during `/domain` if the owner has a custom domain. Shows search queries, click-through rates, indexing status.
- **Google Business Profile insights** — Available if the owner has claimed their listing. Shows discovery searches, direct searches, and actions (calls, directions, website clicks).

No paid tools needed. These three free services cover everything a small business needs to know.

## Monthly check (during `/check`)

Ask the owner these questions. Don't show them dashboards — translate the data into answers.

### 1. Are people finding you?

Check Cloudflare Analytics:
- **Total visitors this month** — Is the number going up, down, or flat compared to last month? Small businesses often see 50–500 monthly visitors. Don't compare to large companies.
- **Referral sources** — Where are visitors coming from? Google search, Google Maps, social media, direct? This tells the owner which channels are working.

If traffic is near zero after 2–3 months:
- Is the site indexed? Check Google Search Console → Coverage
- Is the Google Business Profile claimed and complete?
- Are there any blog posts?
- Has the owner shared the URL anywhere?

### 2. Which pages are people looking at?

Check Cloudflare Analytics → Top pages:
- Are people visiting the pages that matter? (Services, menu, portfolio, contact — not just the home page)
- Are blog posts getting traffic? Which topics resonate?
- Is the contact page getting visits? (People who visit the contact page are warm leads)

If important pages aren't getting traffic:
- Check internal linking — can visitors find the page from the home page in 1–2 clicks?
- Check navigation — is the page in the main menu?
- Check page titles and descriptions — are they compelling in search results?

### 3. Are people taking action?

This is the question that actually matters. The website's job is to turn visitors into customers.

Ask the owner directly:
- "Are you getting contact form submissions?" — If the form works and people are filling it out, the site is doing its job.
- "Are people mentioning the website when they call or visit?" — "I found you online" or "I saw your website" is a direct signal.
- "Are you getting more calls or emails than before the website?" — The owner knows their baseline better than any analytics tool.
- "Has anyone booked/ordered/signed up through the website?" — For businesses with online booking or ordering.

If the answer is "I don't know" — that's useful too. Set up a simple tracking habit:
- Ask the owner to note when a new customer says "I found you online"
- Check contact form submissions monthly (the owner's email inbox)
- Review booking platform data if applicable

### 4. What are people searching for?

Check Google Search Console → Performance:
- **Search queries** — What terms bring people to the site? Are they relevant to the business?
- **Click-through rate** — Are people clicking when they see the site in results? Low CTR means the title and description need to be more compelling.
- **Impressions without clicks** — Pages that appear in search but don't get clicked are opportunities to improve titles and descriptions.

Surprising search queries are content opportunities. If people find the site by searching for something the owner hasn't written about — write about it.

## Quarterly review

Every 3 months (aligned with the `/update` schedule in `docs/webmaster.md`), do a deeper check:

### Traffic trend

Is traffic growing, flat, or declining? For a new site:
- **Months 1–3:** Minimal traffic. Search engines are still discovering the site. This is normal.
- **Months 3–6:** Gradual increase if content is being added and the Google Business Profile is active.
- **Months 6–12:** Should see steady organic traffic if the site has useful content and the business is active.

If traffic is flat after 6 months with regular content, investigate: Is the Google Business Profile complete? Are blog posts targeting questions customers actually ask? Is the site linked from social media and directories?

### Content performance

Which blog posts are getting traffic? This reveals what the audience cares about. Double down on topics that work:
- Write follow-up posts on popular topics
- Update and expand high-performing posts
- Stop writing about topics nobody reads (or reconsider the angle)

### Goal check

During `/start`, the owner shared their goals. Revisit them:
- "You said you wanted more phone calls from new customers. Are you getting them?"
- "You wanted people to find your CSA signup. Is that page getting traffic?"
- "You wanted to stop answering the same questions. Are people reading your FAQ page?"

If goals aren't being met, adjust the strategy — not the goals. The site may need better content, better navigation, or better promotion on the channels where customers actually are.

## What good looks like

Small business owners often have unrealistic expectations from "digital marketing" content that targets large companies. Set expectations:

| Metric | Realistic for a small local business |
|---|---|
| Monthly visitors | 100–1,000 (depends on market size) |
| Google Business Profile views | 500–5,000/month |
| Contact form submissions | 2–20/month |
| New reviews per month | 1–3 |
| Blog post traffic | 10–100 visits per post is good |

A plumber in a small town getting 5 contact form submissions per month is doing great. A restaurant in a city getting 500 monthly visitors to their menu page is doing great. Don't let the owner feel like they need enterprise-level traffic.

## What NOT to track

Don't burden the owner with vanity metrics or complex analytics:

- **Bounce rate** — Misleading for small sites. Someone who visits the contact page, gets the phone number, and calls is a "bounce" but a perfect outcome.
- **Session duration** — Same problem. A visitor who finds what they need quickly and leaves is a success.
- **Social media followers** — Followers don't pay bills. Customers do. A business with 50 followers and regular customers from them is better than 5,000 followers and no conversions.
- **Search rankings for specific keywords** — Rankings fluctuate daily and vary by location. Track traffic and actions, not positions.
- **Competitor traffic estimates** — Third-party tools that estimate competitor traffic are wildly inaccurate. Don't use them.

## What to tell the owner

Keep analytics conversations grounded and brief:

"Your site got [X] visitors this month, mostly from [Google/Maps/social]. Your [services/menu/about] page is the most popular after the home page. Are people calling or filling out the contact form? That's the real measure of whether the site is working."
