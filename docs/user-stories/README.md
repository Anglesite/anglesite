# Anglesite User Stories

This directory contains user stories organized by priority and feature area. Each story follows the standard format:

**As a** [persona]
**I want to** [action]
**So that** [benefit]

## Story Priority Levels

- **P0 (Critical)**: Must have for MVP launch
- **P1 (High)**: Essential for good user experience
- **P2 (Medium)**: Important but can be deferred
- **P3 (Low)**: Nice to have, future enhancement

## Story Point Estimation

Story points use Fibonacci scale (1, 2, 3, 5, 8, 13, 21) to estimate complexity, not time:

- **1-2 points**: Simple, well-understood task (1-2 days)
- **3-5 points**: Moderate complexity, some unknowns (3-5 days)
- **8-13 points**: Complex, multiple unknowns (1-2 weeks)
- **21+ points**: Very complex, should be broken down further

**Factors considered:**
- Technical complexity
- Integration points
- Unknowns and risks
- Testing requirements
- UI/UX complexity

## Top User Stories (Priority Order)

### P0 Stories (Critical - MVP Launch) - 49 points total

0. [First-Run Onboarding](00-first-run-onboarding.md) - P0 - **3 points** ✨ _New_
1. [First Website Creation](01-first-website-creation.md) - P0 - **5 points**
2. [Visual Page Editing](02-visual-page-editing.md) - P0 - **13 points**
3. [AI Webmaster Agent - Basic](03-ai-webmaster-agent.md) - P0 - **8 points** ⚠️ _Reduced from 13, see split plan_
4. [CloudFlare Workers Deployment](04-cloudflare-deployment.md) - P0 - **8 points**
5. [Custom Domain Configuration](05-custom-domain-setup.md) - P0 - **5 points**
6. [Image Upload and Optimization](06-image-management.md) - P0 - **5 points**
13. [Application Settings](13-application-settings.md) - P0 - **3 points** ✨ _New_

### P1 Stories (High Priority - MVP Enhancement) - 44 points total

7. [SEO Metadata Management](07-seo-metadata.md) - P1 - **8 points**
8. [Responsive Device Preview](08-responsive-preview.md) - P1 - **3 points** ✓ _Expanded_
9. [Template Selection](09-template-selection.md) - P1 - **5 points**
10. [Blog Post Creation](10-blog-creation.md) - P1 - **8 points**
11. [Site Export](11-site-export.md) - P1 - **5 points**
12. [File Explorer](12-file-explorer.md) - P1 - **5 points** ✨ _New_
14. [AI Webmaster - Advanced Features](03-ai-webmaster-split-plan.md) - P1 - **8 points** ✨ _Split from Story 03_

**Core MVP (P0): 49 story points** (~5-6 weeks with 2-person team)
**Full MVP with P1: 93 story points** (~9-12 weeks with 2-person team)

## User Personas Reference

- **Sarah** - Personal Brand Builder (blogger, professional portfolio)
- **Mike** - Small Business Owner (local shop, consultant)
- **Emma** - Privacy-Conscious Creator (writer, artist)
- **Alex** - Technical Hobbyist (side projects, experiments)

## Story Status

| Story | Priority | Points | Status | Target Release | Estimated Days |
|-------|----------|--------|--------|----------------|----------------|
| 00 - First-Run Onboarding | P0 | 3 | Planned | MVP | 2-3 |
| 01 - First Website Creation | P0 | 5 | In Progress | MVP | 3-5 |
| 02 - Visual Page Editing | P0 | 13 | In Progress | MVP | 8-10 |
| 03 - AI Webmaster (Basic) | P0 | 8 | Planned | MVP | 5-6 |
| 04 - CloudFlare Deployment | P0 | 8 | Planned | MVP | 5-6 |
| 05 - Custom Domain Setup | P0 | 5 | Planned | MVP | 3-5 |
| 06 - Image Management | P0 | 5 | Planned | MVP | 3-5 |
| 13 - Application Settings | P0 | 3 | Planned | MVP | 2-3 |
| 07 - SEO Metadata | P1 | 8 | Planned | MVP+ | 5-6 |
| 08 - Responsive Preview | P1 | 3 | Planned | MVP+ | 2-3 |
| 09 - Template Selection | P1 | 5 | Planned | Post-MVP | 3-5 |
| 10 - Blog Creation | P1 | 8 | Planned | Post-MVP | 5-6 |
| 11 - Site Export | P1 | 5 | Planned | Post-MVP | 3-5 |
| 12 - File Explorer | P1 | 5 | Planned | MVP+ | 3-5 |
| 14 - AI Webmaster (Advanced) | P1 | 8 | Planned | Post-MVP | 5-6 |

**Velocity Assumptions:**
- 1 point ≈ 1 day for experienced developer
- 2-person team = ~10 points/week (accounting for overhead)
- MVP (P0 stories): 49 points ≈ 5-6 weeks
- Full MVP with P1: 93 points ≈ 9-12 weeks

## Story Points Distribution

### By Priority
```
P0 (Critical):    49 points (53%)  █████████████████
P1 (High):        44 points (47%)  ███████████████
                  ──────────────
Total:            93 points
```

### By Complexity
```
13 points (Complex):      13 points (14%)  █ story: Visual Editing
8 points (Moderate-High): 48 points (52%)  ██████ stories: AI Basic/Advanced, Deploy, SEO, Blog
5 points (Moderate):      25 points (27%)  █████ stories: Creation, Domain, Images, Templates, Export, File Explorer
3 points (Simple):         6 points (6%)   ██ stories: Onboarding, Settings, Responsive Preview
```

### Development Phases

**Phase 1: Foundation & Onboarding (3 weeks, 24 points)**
- Story 00: First-Run Onboarding (3 pts)
- Story 01: First Website Creation (5 pts)
- Story 13: Application Settings (3 pts)
- Story 02: Visual Page Editing (13 pts)

**Phase 2: Content & Assets (2 weeks, 16 points)**
- Story 06: Image Management (5 pts)
- Story 08: Responsive Preview (3 pts)
- Story 03: AI Webmaster - Basic (8 pts)

**Phase 3: Deployment & Publishing (2 weeks, 21 points)**
- Story 04: CloudFlare Deployment (8 pts)
- Story 05: Custom Domain Setup (5 pts)
- Story 07: SEO Metadata (8 pts)

**Phase 4: Enhancement & Polish (4 weeks, 32 points)**
- Story 12: File Explorer (5 pts)
- Story 09: Template Selection (5 pts)
- Story 10: Blog Creation (8 pts)
- Story 11: Site Export (5 pts)
- Story 14: AI Webmaster - Advanced (8 pts)

**Timeline:**
- **Core MVP (P0)**: 5-6 weeks
- **Full MVP with enhancements**: 11-12 weeks

## Related Documents

- [Marketing Requirements](../marketing-requirements.md)
- [Architecture Documentation](../../CLAUDE.md)
- [TODO List](../../TODO.md)
