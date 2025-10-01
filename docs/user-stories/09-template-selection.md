# User Story 09: Template Selection and Customization

**Priority:** P1 (High - Post-MVP)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** Mike (Small Business Owner), Sarah (Personal Brand Builder)
**Epic:** Onboarding & Design

## Complexity Assessment

**Points Breakdown:**
- Template creation (4-6 starter templates): 2 points
- Template installation and file copying: 1 point
- Color/font customization system: 1 point
- Template gallery UI: 1 point

**Justification:** Moderate complexity. Creating high-quality templates is time-intensive but not technically complex. Template installation is straightforward file copying. Color scheme customization requires CSS variable management. Most effort is design work rather than engineering.

## Story

**As a** new user creating a website
**I want to** choose from professionally designed templates
**So that** I can start with a polished design instead of a blank page

## Acceptance Criteria

### Given: User is creating a new website
- [ ] Template gallery displayed
- [ ] Templates categorized by type (blog, portfolio, business, etc.)
- [ ] Live preview of each template
- [ ] Filter and search capabilities

### When: User selects a template
- [ ] Full preview with sample content
- [ ] Customization options shown
- [ ] Color scheme selector
- [ ] Font pairing options
- [ ] One-click apply

### Then: Website initialized with template
- [ ] All pages from template created
- [ ] Sample content populated
- [ ] Styling applied
- [ ] User can immediately customize
- [ ] Template attribution (if required)

## Technical Details

### Template Structure

```
templates/
├── blog-minimal/
│   ├── template.json          # Metadata
│   ├── preview.png            # Thumbnail
│   ├── pages/
│   │   ├── index.html
│   │   ├── about.html
│   │   └── blog/
│   ├── assets/
│   │   ├── css/
│   │   └── images/
│   └── config.json            # 11ty config overrides
```

### Template Metadata

```json
{
  "id": "blog-minimal",
  "name": "Minimal Blog",
  "description": "Clean, typography-focused blog template",
  "category": "blog",
  "author": "Anglesite",
  "version": "1.0.0",
  "preview": "preview.png",
  "tags": ["minimal", "typography", "blog"],
  "colors": {
    "primary": "#2563eb",
    "secondary": "#64748b",
    "accent": "#f59e0b"
  },
  "fonts": {
    "heading": "Inter",
    "body": "Georgia"
  },
  "features": [
    "Blog with RSS",
    "Dark mode",
    "Responsive",
    "SEO optimized"
  ]
}
```

## Template Categories

### MVP Templates (4-6)
1. **Blank** - Empty starting point
2. **Personal Portfolio** - Showcase work
3. **Simple Blog** - Writing-focused
4. **Small Business** - Local shop/service
5. **Landing Page** - Single-page marketing
6. **Documentation** - Tech docs/guides

### Post-MVP
- E-commerce (with CloudFlare Workers)
- Restaurant/Menu
- Event/Conference
- Photography Portfolio
- Podcast
- Resume/CV

## Template Gallery UI

```
┌─────────────────────────────────────────┐
│  Choose a Template                      │
│                                         │
│  [All] [Blog] [Portfolio] [Business]    │
│  Search: [______]                       │
│                                         │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │[Prev]  │ │[Prev]  │ │[Prev]  │      │
│  │        │ │        │ │        │      │
│  │Minimal │ │Modern  │ │Business│      │
│  │Blog    │ │Portfolio│ │Pro     │      │
│  │  Free  │ │  Free  │ │  Free  │      │
│  └────────┘ └────────┘ └────────┘      │
│                                         │
│  [Preview]  [Use Template]              │
└─────────────────────────────────────────┘
```

## Customization Options

### Color Schemes
```typescript
interface ColorScheme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

const schemes = [
  { name: 'Blue', primary: '#2563eb', ... },
  { name: 'Green', primary: '#10b981', ... },
  { name: 'Purple', primary: '#8b5cf6', ... },
  // User can customize further
];
```

### Font Pairings
- Classic: Georgia + Arial
- Modern: Inter + Inter
- Editorial: Playfair Display + Source Sans Pro
- Technical: Fira Code + Roboto

## Success Metrics
- **Template Usage**: 70% of new sites use templates
- **Customization Rate**: 50% customize colors/fonts
- **Template Completion**: 80% of template selections complete setup

## Implementation Notes

### Template Installation
1. Copy template files to website directory
2. Apply color/font customizations
3. Replace placeholder content with user data
4. Initialize with user's site name/info

### IPC Handlers
```typescript
'template:list'          // Get available templates
'template:preview'       // Full preview of template
'template:apply'         // Apply template to new site
'template:customize'     // Update colors/fonts
```

## Advanced Features (Future)

### Template Marketplace
- Community-contributed templates
- Premium templates (paid)
- Template ratings and reviews
- One-click install from web

### Template Builder
- Let users create and export templates
- Share templates with others
- Save site as template for reuse

## Related Stories
- [01 - First Website Creation](01-first-website-creation.md)
- [02 - Visual Page Editing](02-visual-page-editing.md)

## Definition of Done
- [ ] 4-6 starter templates created
- [ ] Template selection UI implemented
- [ ] Color scheme customization working
- [ ] Font pairing customization working
- [ ] Template installation < 10 seconds
- [ ] Documentation: Template creation guide
- [ ] User testing: 5 users successfully use template
