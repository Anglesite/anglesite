# User Story 07: SEO Metadata Management

**Priority:** P1 (High - MVP)
**Story Points:** 8
**Estimated Duration:** 5-6 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Content Creation & SEO

## Complexity Assessment

**Points Breakdown:**
- Two-level metadata system (website.json + page frontmatter): 3 points
- Merge logic and inheritance rules: 2 points
- SEO validation and preview components: 2 points
- Structured data (JSON-LD) generation: 1 point

**Justification:** Moderate-high complexity due to two-level system requiring careful merge logic. Validation rules are numerous but well-defined. Preview components (search result, social cards) require accurate rendering. Testing inheritance across multiple pages is time-intensive.

## Story

**As a** website owner who wants to be found online
**I want to** easily manage SEO metadata at both site-wide and page levels
**So that** my site ranks well in search engines and looks good when shared on social media

## Acceptance Criteria

### Given: User has a website
- [ ] Site-wide SEO settings accessible from website settings
- [ ] Page-level SEO panel accessible from page editor
- [ ] Real-time preview of search result appearance
- [ ] Social media preview (Twitter, Facebook)

### When: User configures site-wide SEO (website.json)
- [ ] Site name and tagline
- [ ] Default social sharing image
- [ ] Twitter handle
- [ ] Author information
- [ ] Organization structured data
- [ ] Analytics verification codes

### When: User edits page-level SEO metadata
- [ ] Page title (with character counter)
- [ ] Meta description (with character counter)
- [ ] Canonical URL
- [ ] Page-specific Open Graph overrides
- [ ] Page-specific Twitter Card overrides
- [ ] robots meta tag options

### Then: Metadata is properly included
- [ ] HTML head tags generated correctly
- [ ] Site-wide defaults merged with page-level overrides
- [ ] Validation checks for common issues
- [ ] Missing page metadata falls back to site defaults
- [ ] Per-page overrides take precedence

## Technical Details

### Two-Level Metadata System

**Site-Wide Metadata** (website.json) → **Page-Level Metadata** (frontmatter) → **Generated HTML**

Pages inherit site-wide defaults and can override specific values.

### Site-Wide SEO Structure (website.json)

```typescript
interface WebsiteSEO {
  // Basic Site Info
  name: string;                     // "Mike's Coffee"
  tagline: string;                  // "Portland's Best Coffee"
  description: string;              // Default meta description
  url: string;                      // https://mikescoffee.com
  language: string;                 // en-US
  locale: string;                   // en_US

  // Social Defaults
  defaultImage: string;             // /assets/images/default-social.jpg
  twitterHandle: string;            // @mikescoffee
  facebookAppId?: string;           // For Facebook insights

  // Author & Copyright
  author: {
    name: string;                   // "Mike Johnson"
    email?: string;
    url?: string;
  };
  copyright: string;                // "© 2025 Mike's Coffee"

  // Search Engine Verification
  verification?: {
    google?: string;                // Google Search Console
    bing?: string;                  // Bing Webmaster Tools
  };

  // Organization Structured Data (JSON-LD)
  organization?: {
    type: 'LocalBusiness' | 'Organization' | 'Corporation';
    name: string;
    logo: string;
    description: string;
    address?: {
      streetAddress: string;
      addressLocality: string;
      addressRegion: string;
      postalCode: string;
      addressCountry: string;
    };
    contactPoint?: {
      telephone: string;
      contactType: string;
    };
    sameAs: string[];               // Social media URLs
  };

  // SEO Preferences
  robots: {
    index: boolean;                 // Default indexing preference
    follow: boolean;                // Default follow preference
  };
}
```

### Page-Level SEO Structure (frontmatter)

```typescript
interface PageSEO {
  // Basic SEO (overrides site defaults)
  title?: string;                   // Page title (50-60 chars)
  description?: string;             // Meta description (150-160 chars)
  canonicalUrl?: string;            // Override canonical URL
  robots?: {
    index?: boolean;                // Override site default
    follow?: boolean;               // Override site default
  };

  // Open Graph Overrides
  og?: {
    title?: string;                 // Defaults to page title → site name
    description?: string;           // Defaults to page description
    image?: string;                 // Override default social image
    type?: 'website' | 'article';   // Page type
  };

  // Twitter Card Overrides
  twitter?: {
    card?: 'summary' | 'summary_large_image';
    title?: string;                 // Defaults to page title
    description?: string;           // Defaults to page description
    image?: string;                 // Override default twitter image
    creator?: string;               // Override for specific author
  };

  // Page-Specific Structured Data
  structuredData?: object;          // Additional Schema.org markup
}
```

### Metadata Merge Strategy

```typescript
// Pseudocode for merging site-wide and page-level metadata
function generatePageMetadata(websiteSEO: WebsiteSEO, pageSEO: PageSEO, pageUrl: string) {
  return {
    // Title: page override → fallback to site name
    title: pageSEO.title || `${websiteSEO.name}`,
    titleTemplate: pageSEO.title ? `${pageSEO.title} | ${websiteSEO.name}` : websiteSEO.name,

    // Description: page override → site default
    description: pageSEO.description || websiteSEO.description,

    // Canonical: page override → constructed from site URL
    canonicalUrl: pageSEO.canonicalUrl || `${websiteSEO.url}${pageUrl}`,

    // Robots: page override → site default
    robots: {
      index: pageSEO.robots?.index ?? websiteSEO.robots.index,
      follow: pageSEO.robots?.follow ?? websiteSEO.robots.follow,
    },

    // Open Graph: merge page and site defaults
    og: {
      title: pageSEO.og?.title || pageSEO.title || websiteSEO.name,
      description: pageSEO.og?.description || pageSEO.description || websiteSEO.description,
      image: pageSEO.og?.image || websiteSEO.defaultImage,
      url: `${websiteSEO.url}${pageUrl}`,
      type: pageSEO.og?.type || 'website',
      locale: websiteSEO.locale,
      siteName: websiteSEO.name,
    },

    // Twitter: merge page and site defaults
    twitter: {
      card: pageSEO.twitter?.card || 'summary_large_image',
      site: websiteSEO.twitterHandle,
      creator: pageSEO.twitter?.creator || websiteSEO.twitterHandle,
      title: pageSEO.twitter?.title || pageSEO.title || websiteSEO.name,
      description: pageSEO.twitter?.description || pageSEO.description || websiteSEO.description,
      image: pageSEO.twitter?.image || pageSEO.og?.image || websiteSEO.defaultImage,
    },
  };
}
```

### Generated HTML Example

```html
<head>
  <!-- Language and Encoding (from website.json) -->
  <html lang="en-US">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Basic SEO (merged from website.json + page frontmatter) -->
  <title>Best Coffee Shop in Portland | Mike's Coffee</title>
  <meta name="description" content="Award-winning specialty coffee in downtown Portland. Organic beans, expert baristas, cozy atmosphere.">
  <link rel="canonical" href="https://mikescoffee.com/">
  <meta name="author" content="Mike Johnson">
  <meta name="robots" content="index,follow">

  <!-- Search Engine Verification (from website.json) -->
  <meta name="google-site-verification" content="abc123...">

  <!-- Open Graph (merged) -->
  <meta property="og:site_name" content="Mike's Coffee">
  <meta property="og:title" content="Best Coffee Shop in Portland">
  <meta property="og:description" content="Award-winning specialty coffee in downtown Portland.">
  <meta property="og:image" content="https://mikescoffee.com/assets/images/shop-front.jpg">
  <meta property="og:url" content="https://mikescoffee.com/">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">

  <!-- Twitter Card (merged) -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@mikescoffee">
  <meta name="twitter:title" content="Best Coffee Shop in Portland">
  <meta name="twitter:description" content="Award-winning specialty coffee in downtown Portland.">
  <meta name="twitter:image" content="https://mikescoffee.com/assets/images/shop-front.jpg">

  <!-- Structured Data: Organization (from website.json) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Mike's Coffee",
    "description": "Portland's Best Coffee",
    "logo": "https://mikescoffee.com/assets/images/logo.png",
    "url": "https://mikescoffee.com",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Main St",
      "addressLocality": "Portland",
      "addressRegion": "OR",
      "postalCode": "97201",
      "addressCountry": "US"
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "telephone": "+1-503-555-0123",
      "contactType": "Customer Service"
    },
    "sameAs": [
      "https://twitter.com/mikescoffee",
      "https://facebook.com/mikescoffee",
      "https://instagram.com/mikescoffee"
    ]
  }
  </script>
</head>
```

### Implementation Components

**Main Process:**
- `SEOService` - Manages SEO metadata
- `ValidationService` - Validates metadata
- `TemplateService` - Injects metadata into HTML

**Renderer Process:**
- `<SEOPanel>` - Metadata editor UI
- `<SearchPreview>` - Google SERP preview
- `<SocialPreview>` - Twitter/Facebook preview
- `<StructuredDataEditor>` - JSON-LD editor (advanced)

**IPC Handlers:**
```typescript
// Site-wide SEO
'seo:website:get'         // Get website.json SEO config
'seo:website:update'      // Update website.json SEO config
'seo:website:validate'    // Validate site-wide settings

// Page-level SEO
'seo:page:get'            // Get page SEO metadata
'seo:page:update'         // Update page SEO metadata
'seo:page:validate'       // Validate page settings
'seo:page:preview'        // Generate preview data (merged)
'seo:page:analyze'        // SEO audit for page
```

### Storage Structure

**Site-Wide Configuration (website.json)**
```json
{
  "name": "Mike's Coffee",
  "tagline": "Portland's Best Coffee",
  "description": "Award-winning specialty coffee shop in downtown Portland",
  "url": "https://mikescoffee.com",
  "language": "en-US",
  "locale": "en_US",

  "seo": {
    "defaultImage": "/assets/images/default-social.jpg",
    "twitterHandle": "@mikescoffee",
    "author": {
      "name": "Mike Johnson",
      "email": "mike@mikescoffee.com"
    },
    "copyright": "© 2025 Mike's Coffee",
    "verification": {
      "google": "abc123xyz..."
    },
    "organization": {
      "type": "LocalBusiness",
      "name": "Mike's Coffee",
      "logo": "/assets/images/logo.png",
      "description": "Award-winning specialty coffee shop",
      "address": {
        "streetAddress": "123 Main St",
        "addressLocality": "Portland",
        "addressRegion": "OR",
        "postalCode": "97201",
        "addressCountry": "US"
      },
      "contactPoint": {
        "telephone": "+1-503-555-0123",
        "contactType": "Customer Service"
      },
      "sameAs": [
        "https://twitter.com/mikescoffee",
        "https://facebook.com/mikescoffee",
        "https://instagram.com/mikescoffee"
      ]
    },
    "robots": {
      "index": true,
      "follow": true
    }
  }
}
```

**Page-Level Metadata (src/pages/index.html frontmatter)**
```yaml
---
title: Home
seo:
  title: "Best Coffee Shop in Portland"
  description: "Award-winning specialty coffee in downtown Portland. Organic beans, expert baristas, cozy atmosphere."
  og:
    image: "/assets/images/shop-front.jpg"
    type: "website"
  twitter:
    card: "summary_large_image"
---
```

**Page with SEO Overrides (src/pages/about.html)**
```yaml
---
title: About Us
seo:
  title: "About Mike's Coffee - Our Story"
  description: "Learn about Mike's Coffee, Portland's award-winning specialty coffee shop since 2010."
  robots:
    index: true
    follow: true
  og:
    image: "/assets/images/about-team.jpg"
  twitter:
    creator: "@mikejohnson"
---
```

## User Flow Diagram

### Site-Wide SEO Setup (First-Time)
```
[Create Website]
    ↓
[Initial Setup Wizard]
    ↓
[Enter Site Name, URL, Description]
    ↓
[Upload Default Social Image]
    ↓
[Add Twitter Handle (optional)]
    ↓
[Configure Organization Info (optional)]
    ↓
[Save to website.json]
```

### Page-Level SEO Editing
```
[Editing Page]
    ↓
[Click "SEO Settings" Button]
    ↓
[SEO Panel Opens]
    ├─ Shows site-wide defaults (grayed out)
    └─ Shows page-level overrides (editable)
    ↓
[Edit Title] → [Preview Updates (merged with site defaults)]
    ↓
[Edit Description] → [Preview Updates]
    ↓
[Upload Page-Specific Social Image] → [Social Preview Updates]
    ↓
[Validate] → [Show Warnings/Errors]
    ↓
[Save] → [Update Frontmatter] → [Regenerate HTML]
```

## SEO Panel UI

### Site-Wide SEO Settings (Website Settings)
```
┌─────────────────────────────────────────┐
│  Website SEO Configuration              │
│                                         │
│  Site Name *                            │
│  ┌─────────────────────────────────────┐│
│  │ Mike's Coffee                       ││
│  └─────────────────────────────────────┘│
│                                         │
│  Site Tagline                           │
│  ┌─────────────────────────────────────┐│
│  │ Portland's Best Coffee              ││
│  └─────────────────────────────────────┘│
│                                         │
│  Default Description                    │
│  ┌─────────────────────────────────────┐│
│  │ Award-winning specialty coffee shop ││
│  │ in downtown Portland                ││
│  └─────────────────────────────────────┘│
│                                         │
│  Default Social Image                   │
│  [default-social.jpg] [Change]          │
│  ℹ️ Used when pages don't have their own │
│                                         │
│  Twitter Handle                         │
│  ┌─────────────────────────────────────┐│
│  │ @mikescoffee                        ││
│  └─────────────────────────────────────┘│
│                                         │
│  [Organization Details ▼]               │
│                                         │
│  [Save Changes]                         │
└─────────────────────────────────────────┘
```

### Page-Level SEO Editor
```
┌─────────────────────────────────────────┐
│  SEO Settings for: Home Page            │
│                                         │
│  ℹ️ Site defaults: Mike's Coffee        │
│  [Edit Site-Wide Settings]              │
│                                         │
│  Page Title                    48/60    │
│  ┌─────────────────────────────────────┐│
│  │ Best Coffee Shop in Portland      × ││
│  └─────────────────────────────────────┘│
│  Will display as: "Best Coffee Shop in  │
│  Portland | Mike's Coffee"              │
│                                         │
│  Meta Description             152/160   │
│  ┌─────────────────────────────────────┐│
│  │ Award-winning specialty coffee in   ││
│  │ downtown Portland. Organic beans... ││
│  └─────────────────────────────────────┘│
│  ⚠️ Empty = uses site default           │
│                                         │
│  Social Sharing Image                   │
│  ○ Use site default (default-social.jpg)│
│  ● Use custom image for this page       │
│    [shop-front.jpg] [Change]            │
│                                         │
│  ✓ Good length                          │
│  ⚠ Consider adding location keywords   │
│                                         │
│  [Advanced Settings ▼]                  │
│                                         │
│  [Save]  [Cancel]  [Preview]            │
└─────────────────────────────────────────┘
```

### Search Result Preview
```
┌─────────────────────────────────────────┐
│  Google Preview                         │
│                                         │
│  https://mikescoffee.com                │
│  Best Coffee Shop in Portland | Mike's  │
│  Award-winning specialty coffee in      │
│  downtown Portland. Organic beans,      │
│  expert baristas, cozy atmosphere.      │
│                                         │
└─────────────────────────────────────────┘
```

### Social Media Preview
```
┌─────────────────────────────────────────┐
│  Social Media Preview                   │
│                                         │
│  [Twitter] [Facebook] [LinkedIn]        │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ [Shop Front Image]                 │ │
│  │                                    │ │
│  │ Best Coffee Shop in Portland       │ │
│  │ Award-winning specialty coffee in  │ │
│  │ mikescoffee.com                    │ │
│  └────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Advanced Settings
```
┌─────────────────────────────────────────┐
│  Advanced SEO                           │
│                                         │
│  Canonical URL                          │
│  ┌─────────────────────────────────────┐│
│  │ https://mikescoffee.com/            ││
│  └─────────────────────────────────────┘│
│                                         │
│  Robots                                 │
│  ☑ Allow search engines to index       │
│  ☑ Allow search engines to follow links│
│                                         │
│  Social Image                           │
│  [shop-front.jpg] [Change]              │
│                                         │
│  Twitter Handle                         │
│  ┌─────────────────────────────────────┐│
│  │ @mikescoffee                        ││
│  └─────────────────────────────────────┘│
│                                         │
│  [Edit Structured Data]                 │
│                                         │
└─────────────────────────────────────────┘
```

## Success Metrics

- **SEO Completeness**: > 90% of pages have title and description
- **Title Length**: 80% of titles within 50-60 characters
- **Description Length**: 80% of descriptions within 150-160 characters
- **Social Images**: > 70% of pages have Open Graph images
- **Validation**: < 5% of pages with SEO errors

## Validation Rules

### Title
- [ ] Length: 50-60 characters (warning if outside range)
- [ ] Not empty
- [ ] Unique across site
- [ ] Contains brand name (recommended)
- [ ] Not all caps (warning)

### Description
- [ ] Length: 150-160 characters (warning if outside range)
- [ ] Not empty
- [ ] Unique across site
- [ ] Contains call-to-action (recommended)
- [ ] Not duplicate of title

### Images
- [ ] Open Graph image exists
- [ ] Dimensions: 1200x630 recommended
- [ ] File size: < 5 MB
- [ ] Alt text present

### URLs
- [ ] Canonical URL is absolute (https://)
- [ ] No broken links
- [ ] Consistent with site structure

## Metadata Inheritance & Override Behavior

### Inheritance Rules

1. **Site defaults** are defined once in `website.json`
2. **Pages inherit** all site defaults automatically
3. **Pages can override** any specific field
4. **Empty page fields** fall back to site defaults
5. **Explicit page values** always take precedence

### Override Examples

| Field | website.json | Page Frontmatter | Final HTML Output |
|-------|--------------|------------------|-------------------|
| Site Name | "Mike's Coffee" | - | Site name used in og:site_name |
| Page Title | - | "Best Coffee" | "Best Coffee \| Mike's Coffee" |
| Description | "Default desc" | "Page desc" | "Page desc" (override) |
| Description | "Default desc" | (empty) | "Default desc" (fallback) |
| Social Image | "/default.jpg" | "/custom.jpg" | "/custom.jpg" (override) |
| Social Image | "/default.jpg" | (empty) | "/default.jpg" (fallback) |
| Twitter Handle | "@mikescoffee" | - | "@mikescoffee" (always from site) |
| Author | "Mike Johnson" | - | "Mike Johnson" (always from site) |

### Clear UI Indicators

The page-level SEO editor should clearly show:
- **Inherited values** (grayed out, not editable)
- **Default fallbacks** (shown as placeholders)
- **Active overrides** (highlighted in blue or with badge)
- **Link to edit site-wide settings** for inherited values

## SEO Audit Features

### On-Page SEO Checklist
```
┌─────────────────────────────────────────┐
│  SEO Audit: Home Page                   │
│                                         │
│  ✓ Title tag present (58 chars)        │
│  ✓ Meta description present (152)      │
│  ✓ H1 heading present                   │
│  ✓ Images have alt text (8/8)          │
│  ✓ Internal links (12)                  │
│  ✓ Open Graph tags present              │
│  ✓ Mobile-friendly                      │
│  ⚠ No outbound links                    │
│  ✗ Missing structured data              │
│                                         │
│  Overall Score: 85/100                  │
│                                         │
│  [View Details] [Fix Issues]            │
└─────────────────────────────────────────┘
```

### Common Issues Detection
1. Missing or empty title tags
2. Duplicate titles across pages
3. Missing meta descriptions
4. Descriptions too short/long
5. Missing social media images
6. Broken canonical URLs
7. Multiple H1 tags
8. Missing alt text on images

## Structured Data Support (Post-MVP)

### Templates for Common Types
- **LocalBusiness**: For shops, restaurants
- **Article**: For blog posts
- **Product**: For e-commerce
- **Person**: For personal sites
- **Organization**: For companies
- **Event**: For event pages

### Visual Editor
```
┌─────────────────────────────────────────┐
│  Structured Data: LocalBusiness         │
│                                         │
│  Business Name *                        │
│  ┌─────────────────────────────────────┐│
│  │ Mike's Coffee                       ││
│  └─────────────────────────────────────┘│
│                                         │
│  Type                                   │
│  [CoffeeShop ▼]                         │
│                                         │
│  Address *                              │
│  Street: [123 Main St              ]    │
│  City:   [Portland                 ]    │
│  State:  [OR ▼]                         │
│  Zip:    [97201                    ]    │
│                                         │
│  [Preview JSON-LD] [Validate]           │
│                                         │
└─────────────────────────────────────────┘
```

## Edge Cases & Error Handling

### 1. Missing Required Fields
```
Warning: "Meta description is empty"
Impact: "Search engines will generate one automatically (may not be ideal)"
Action: "Add a description to control how your page appears in search results"
```

### 2. Title Too Long
```
Warning: "Title is 72 characters (recommended: 50-60)"
Impact: "Search engines may truncate the title"
Preview: "Best Coffee Shop in Portland Oregon with Organic..."
Action: [Shorten Title]
```

### 3. Duplicate Metadata
```
Error: "This title is used on 3 other pages"
Impact: "Search engines prefer unique titles"
Pages: home, about, contact
Action: "Make titles unique to each page"
```

### 4. Invalid Canonical URL
```
Error: "Canonical URL must be absolute (https://...)"
Current: "/about"
Should be: "https://mikescoffee.com/about"
Action: [Fix URL]
```

### 5. Missing Social Image
```
Warning: "No Open Graph image specified"
Impact: "Social shares may not display properly"
Action: "Add a social media image (1200x630 recommended)"
```

## Related Stories

- [02 - Visual Page Editing](02-visual-page-editing.md) - Integrated SEO panel
- [04 - Custom Domain Setup](05-custom-domain-setup.md) - Canonical URLs
- [09 - Blog Creation](10-blog-creation.md) - Article-specific SEO

## Advanced Features (Post-MVP)

### 1. AI-Powered Suggestions
- Generate meta descriptions from content
- Suggest title improvements
- Keyword recommendations

### 2. Competitor Analysis
- Compare your SEO to similar sites
- Keyword gap analysis

### 3. SEO History
- Track changes to metadata over time
- A/B test different titles/descriptions

### 4. International SEO
- Hreflang tags for multi-language sites
- Region-specific metadata

## Open Questions

- Q: Should we include keyword research tools?
  - A: Post-MVP, integrate with external APIs

- Q: Auto-generate meta descriptions from content?
  - A: Yes, as a fallback when not manually set

- Q: Support for multiple Open Graph images?
  - A: Not in MVP, single image per page

- Q: Validate structured data against Schema.org?
  - A: Yes, use Google's Structured Data Testing Tool API

## Testing Scenarios

### Site-Wide SEO Tests
1. **Initial Setup**: Create website, configure site-wide SEO in website.json
2. **Organization Data**: Add full LocalBusiness structured data, validate
3. **Site Defaults**: Verify all pages inherit site name, author, default image
4. **Update Propagation**: Change site-wide setting, verify all pages update

### Page-Level SEO Tests
5. **Complete Metadata**: Fill all SEO fields on page, verify HTML output
6. **Validation**: Enter invalid values, verify warnings
7. **Previews**: Check search/social previews update live with merged data
8. **Fallbacks**: Leave page fields empty, verify site defaults used
9. **Overrides**: Set page-specific values, verify they override site defaults
10. **Character Limits**: Test boundary cases (59, 60, 61 chars)
11. **Duplicates**: Create duplicate titles across pages, verify detection

### Integration Tests
12. **Merge Logic**: Test complex inheritance scenarios
13. **Structured Data**: Generate combined organization + page JSON-LD
14. **Multi-Page**: Update SEO for 10 pages, verify independence
15. **website.json Updates**: Change site SEO, verify pages regenerate

## Definition of Done

- [ ] Code implemented with two-level SEO metadata system
- [ ] Site-wide SEO configuration UI (website.json editor)
- [ ] Page-level SEO editor with inheritance indicators
- [ ] Metadata merge logic implemented and tested
- [ ] Unit tests for SEOService (>90% coverage)
- [ ] Integration tests for site-wide + page-level merging
- [ ] Validation rules tested for all edge cases
- [ ] Search preview rendering tested with merged data
- [ ] Social preview rendering tested (Twitter, Facebook)
- [ ] Performance: SEO panel opens in < 500ms
- [ ] Documentation: Two-level SEO system guide
- [ ] QA: Both site-wide and page-level SEO verified on deployed site
- [ ] User testing: 5 users successfully configure site-wide + page SEO
