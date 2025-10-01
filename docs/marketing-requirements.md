# Anglesite Marketing Requirements Document

## Product Vision

Anglesite empowers anyone to create, maintain, and publish their own website on their own domain for free—no hosting costs, no server management, no technical expertise required.

## The Problem

**Current Pain Points:**

- Traditional web hosting costs $5-20/month and requires technical setup
- Website builders lock users into proprietary platforms with monthly fees
- Self-hosting requires managing servers, security, and updates
- Existing static site generators demand command-line proficiency
- Domain + hosting bundles are expensive and inflexible

## The Solution

Anglesite combines:

1. **Local-First WYSIWYG Editor** - Edit websites visually on your computer
2. **Free CloudFlare Workers Deployment** - Publish to your own domain at zero cost
3. **Desktop Application** - No browser required, works offline
4. **Static Site Generation** - Fast, secure, SEO-friendly websites powered by 11ty
5. **True Ownership** - Your domain, your content, your control

## Target Audience

### Primary Personas

**1. The Personal Brand Builder**

- Professionals who want a portfolio/blog on their own domain
- Values: Professional presence, cost savings, ownership
- Pain: Can't justify $10-20/month for a simple personal site

**2. The Small Business Owner**

- Local shops, consultants, freelancers needing web presence
- Values: Low overhead, easy updates, professional appearance
- Pain: Website builders are expensive; developers are more expensive

**3. The Privacy-Conscious Creator**

- Writers, photographers, artists who want platform independence
- Values: Data ownership, no tracking, editorial control
- Pain: Social platforms own their content and audience

**4. The Hobbyist/Enthusiast**

- People who want a website for their passion project
- Values: Learning, creativity, experimentation
- Pain: Hosting costs don't match hobbyist budgets

### Secondary Personas

**5. The Edu/Non-Profit Leader**

- Schools, clubs, organizations with limited budgets
- Values: Sustainability, member empowerment
- Pain: Recurring costs strain budgets

## Unique Value Propositions

### 1. **Truly Free Hosting**

"Host your website on your own domain for $0/month using CloudFlare Workers"

- No hidden costs, no credit card required for hosting
- Only expense: domain registration (~$12/year)
- CloudFlare Workers free tier: 100,000 requests/day

### 2. **Local-First Privacy**

"Your content lives on your computer, not in someone else's cloud"

- Edit offline, publish when ready
- No SaaS lock-in or data mining
- Export to static files anytime

### 3. **WYSIWYG Simplicity**

"See what you're building while you build it"

- Visual editing experience
- Live preview during editing
- No code required (but supported for power users)

### 4. **Professional Results**

"Create fast, SEO-optimized websites that look custom-built"

- Modern responsive designs
- Automatic performance optimization
- Built-in SEO best practices

### 5. **True Ownership**

"Your domain, your content, your platform"

- Export to any host if you change your mind
- No proprietary formats or vendor lock-in
- Git-friendly file structure

## Key Messages

### Tagline Options

1. "Your website. Your domain. Zero hosting costs."
2. "Free website hosting on your own domain."
3. "Build and host your website for free."
4. "The local-first website builder with free deployment."

### Elevator Pitch

"Anglesite is a desktop app that lets you visually build and edit websites with the help of an expert Webmaster AI agent, then deploy them to your own domain using CloudFlare Workers—completely free. No hosting fees, no technical skills required, and your content stays on your computer until you're ready to publish."

## Positioning

### What Anglesite IS

- A desktop application for creating static websites
- A visual editor for non-technical users
- A free deployment solution via CloudFlare Workers
- A local-first, privacy-respecting tool
- Built on proven tech: Electron, 11ty, React

### What Anglesite IS NOT

- A website builder SaaS (no monthly fees)
- A traditional web host
- A dynamic application platform
- A replacement for complex web apps
- A social platform or network

## Competitive Landscape

### Direct Competitors

| Product | Strength | Weakness vs Anglesite |
|---------|----------|----------------------|
| Wix/Squarespace | Easy to use, templates | $12-40/month, lock-in |
| WordPress.com | Familiar, ecosystem | $4-25/month, complex |
| Webflow | Powerful design tools | $12+/month, learning curve |
| GitHub Pages | Free hosting | Requires Git/technical knowledge |
| Netlify/Vercel | Great developer UX | Technical setup required |

### Differentiation Matrix

| Feature | Anglesite | Wix | WordPress.com | GitHub Pages |
|---------|-----------|-----|---------------|--------------|
| Monthly Cost | $0 | $16+ | $4+ | $0 |
| WYSIWYG Editing | ✓ | ✓ | ✓ | ✗ |
| Local-First | ✓ | ✗ | ✗ | ✓ |
| Own Domain (Free) | ✓ | ✗ | ✗ | ✓ |
| No Technical Skills | ✓ | ✓ | ~ | ✗ |
| Export/Ownership | ✓ | ✗ | ~ | ✓ |
| Offline Editing | ✓ | ✗ | ✗ | ✓ |

## Go-to-Market Strategy

### Phase 1: Early Adopters (Beta)

**Target:** Technical early adopters who appreciate local-first software

- Launch on Product Hunt, Hacker News
- Emphasize privacy and ownership
- GitHub repository with open development
- Community-driven feature development

### Phase 2: Prosumer Expansion

**Target:** Bloggers, freelancers, small business owners

- SEO content: "free website hosting", "create website own domain"
- Tutorial content and templates
- Success stories and case studies
- Integration guides (CloudFlare setup)

### Phase 3: Mainstream Accessibility

**Target:** Non-technical users, small organizations

- Video tutorials and onboarding
- Template marketplace
- Streamlined CloudFlare integration
- Word-of-mouth and referrals

## Feature Priorities for Launch

### Must-Have (MVP)

1. Visual page editor with live preview
2. CloudFlare Workers deployment integration
3. Basic responsive templates
4. Image optimization
5. SEO metadata controls
6. Custom domain configuration
7. Local development server
8. AI Webmaster Agent

### Should-Have (Post-MVP)

1. Blog/RSS functionality
2. Contact form integration (CloudFlare Workers)
3. Theme customization
4. Component library
5. Multi-site management
6. Version history

### Nice-to-Have (Future)

1. Template marketplace
2. Analytics integration
3. A/B testing
4. Collaboration features
5. Plugin ecosystem
6. Mobile app for quick edits

## Success Metrics

### Adoption Metrics (First 90 Days Post-Launch)

- **Monthly Active Users (MAU)**: 500 users by Month 3
- **Websites Deployed**: 300+ sites deployed to CloudFlare Workers
- **CloudFlare Workers Connections**: 250+ active CloudFlare integrations
- **User Retention**:
  - 30-day: > 40% (200 returning users)
  - 60-day: > 25% (125 users)
  - 90-day: > 15% (75 users)

### Engagement Metrics

- **Average Sites Per User**: 1.5 sites (target: power users create 2-3)
- **Publish Frequency**: 60% of users publish within first week
- **Feature Usage**:
  - Visual editor: 90% of users
  - AI Webmaster: 50% of users try it
  - CloudFlare deployment: 60% of sites deployed
  - Custom domains: 30% configure custom domains
- **Support Ticket Volume**: < 10 tickets per 100 users per month

### Community Metrics (Open Source)

- **GitHub Stars**: 500 stars by Month 3, 2000+ by Month 12
- **Contributors**: 10+ contributors by Month 6
- **Discord/Community**: 200+ members by Month 3
- **Forum Activity**: 50+ active community members
- **Documentation Contributions**: 5+ community-contributed guides

### Quality Metrics

- **Average Site Performance**: Lighthouse score > 90 for deployed sites
- **Deployment Success Rate**: > 95% of deployments succeed
- **Error Rates**: < 1% of user sessions encounter crashes
- **Crash-Free Sessions**: > 99.5% of sessions
- **Time-to-First-Publish**: < 30 minutes from download to deployed site

### User Satisfaction (First 90 Days)

- **Net Promoter Score (NPS)**: > 40 (promoters - detractors)
- **User Ratings**: Average 4+ stars on download platforms
- **Feature Satisfaction**: > 75% users satisfied with core features
- **Would Recommend**: > 60% would recommend to a friend

## Marketing Channels

### Owned

- Product website (built with Anglesite, naturally)
- Documentation site
- Blog with tutorials and case studies
- Email newsletter

### Earned

- Product Hunt launch
- Hacker News discussion
- Tech blog coverage (The Verge, Ars Technica)
- Developer community (Dev.to, Hashnode)

### Shared

- GitHub community
- Discord/Slack community
- Twitter/X presence
- YouTube tutorials

### Paid (Future)

- Google Ads: "free website hosting"
- Reddit ads in relevant communities
- Sponsorships of complementary tools

## Brand Personality

**Voice:** Empowering, straightforward, friendly
**Tone:** Confident but not arrogant; technical but accessible
**Values:** Privacy, ownership, simplicity, sustainability

**Do Say:**

- "Your website, your way"
- "Free forever"
- "No hidden costs"
- "Own your content"

**Don't Say:**

- "Enterprise-grade" (too corporate)
- "Disruptive" (too buzzword-y)
- "Revolutionary" (overpromising)

## Messaging Framework

### For Non-Technical Users

**Promise:** "Create a professional website without code or monthly fees"
**Proof:** Visual editor + free CloudFlare deployment
**Call-to-Action:** "Download and build your first page in 10 minutes"

### For Technical Users

**Promise:** "Local-first static site generator with zero-cost deployment"
**Proof:** Built on 11ty + CloudFlare Workers + open source
**Call-to-Action:** "Star us on GitHub and try the beta"

### For Small Businesses

**Promise:** "Professional web presence without the professional price tag"
**Proof:** Real examples of businesses saving $200+/year
**Call-to-Action:** "Get your business online today—free"

### For Privacy Advocates

**Promise:** "Build and host websites without surrendering your data"
**Proof:** Local-first architecture, no tracking, open source
**Call-to-Action:** "Take back control of your web presence"

## Risk Analysis

### Challenges

#### 1. CloudFlare Dependency Risk

- Mitigation: Build export functionality for any static host
- Alternative: Support Netlify, Vercel, GitHub Pages

#### 2. Technical Complexity

- CloudFlare Workers setup may intimidate users
- Mitigation: One-click integration wizard, detailed guides

#### 3. Market Education

- Users may not know CloudFlare Workers is free
- Mitigation: Clear messaging, comparison charts

#### 4. Support Scaling

- Free product may generate high support volume
- Mitigation: Comprehensive docs, community support, FAQ

## Launch Timeline

### Pre-Launch (Months -3 to 0)

- Finalize MVP features
- Create product website
- Prepare documentation
- Build email list
- Create launch video/demo

### Launch Week

- Product Hunt launch
- Hacker News post
- Social media announcement
- Email to waitlist
- Press outreach

### Post-Launch (Months 1-3)

- Collect user feedback
- Iterate on onboarding
- Publish case studies
- Expand documentation
- Build community

## Open Questions

1. Should we target developers first or non-technical users?
2. What premium features could fund development long-term?
3. Should we support platforms beyond CloudFlare Workers at launch?
4. How do we handle support volume with a free product?
5. What partnerships could accelerate adoption (domain registrars, CloudFlare)?

---

**Document Version:** 1.0
**Last Updated:** 2025-09-30
**Owner:** Product/Marketing Team
**Status:** Draft - Awaiting Review
