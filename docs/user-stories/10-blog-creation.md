# User Story 10: Blog Post Creation and Management

**Priority:** P1 (High - Post-MVP)
**Story Points:** 8
**Estimated Duration:** 5-6 days
**Persona:** Sarah (Personal Brand Builder), Emma (Privacy-Conscious Creator)
**Epic:** Content Creation & Blogging

## Complexity Assessment

**Points Breakdown:**
- Blog post editor and frontmatter management: 2 points
- RSS feed generation: 2 points
- Category/tag system and archives: 2 points
- Post list UI and filtering: 1 point
- Auto-save and draft system: 1 point

**Justification:** Moderate-high complexity with multiple interconnected features. RSS generation is well-understood. Archive generation requires date-based grouping. Auto-save builds on existing editor infrastructure. Testing with many posts and categories is time-consuming.

## Story

**As a** blogger or content creator
**I want to** easily create, organize, and publish blog posts
**So that** I can maintain an active blog without managing complex infrastructure

## Acceptance Criteria

### Given: User has a website with blog enabled
- [ ] "New Blog Post" action available
- [ ] Blog post editor with writing-focused UI
- [ ] Draft/published status management
- [ ] Post list view with filtering

### When: User creates a blog post
- [ ] Title and content editor
- [ ] Publication date selector
- [ ] Category and tag management
- [ ] Featured image selection
- [ ] SEO metadata (from Story 06)
- [ ] Markdown or WYSIWYG editing modes

### Then: Blog post is ready
- [ ] Post added to blog index automatically
- [ ] RSS feed updated
- [ ] Archive pages regenerated
- [ ] Social sharing metadata included
- [ ] Previous/next navigation added

## Technical Details

### Blog Post Structure

```typescript
interface BlogPost {
  title: string;
  slug: string;                    // URL-friendly: "my-first-post"
  content: string;                 // Markdown or HTML
  excerpt?: string;                // Optional summary
  publishDate: Date;
  updatedDate?: Date;
  status: 'draft' | 'published';
  author: string;
  featuredImage?: string;
  categories: string[];
  tags: string[];
  seo: PageSEO;                    // From Story 06
}
```

### File Storage

```
src/
└── blog/
    ├── 2025-09-30-my-first-post.md
    ├── 2025-10-01-another-post.md
    └── drafts/
        └── work-in-progress.md
```

### Frontmatter Example

```markdown
---
title: "Getting Started with Anglesite"
slug: "getting-started-anglesite"
date: 2025-09-30
status: published
author: Sarah Johnson
featuredImage: "/assets/images/getting-started.jpg"
categories: ["Tutorial", "Guides"]
tags: ["beginner", "setup", "static-site"]
excerpt: "Learn how to build your first website with Anglesite in minutes"
seo:
  title: "Getting Started with Anglesite - Complete Guide"
  description: "Step-by-step tutorial for building your first website..."
---

# Getting Started with Anglesite

Your blog content here...
```

## Blog Management UI

### Post List View
```
┌─────────────────────────────────────────┐
│  Blog Posts                             │
│                                         │
│  [+ New Post]  [All] [Published] [Drafts]│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ ● Getting Started with Anglesite    ││
│  │   Published Sep 30, 2025            ││
│  │   Tutorial, Guides                  ││
│  │   [Edit] [View] [Delete]            ││
│  ├─────────────────────────────────────┤│
│  │ ○ My Second Post (Draft)            ││
│  │   Last edited Oct 1, 2025           ││
│  │   [Edit] [Publish]                  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### Post Editor
```
┌─────────────────────────────────────────┐
│  [Save Draft] [Preview] [Publish]       │
├─────────────────────────────────────────┤
│  Title                                  │
│  ┌─────────────────────────────────────┐│
│  │ My Blog Post Title                  ││
│  └─────────────────────────────────────┘│
│                                         │
│  Slug: my-blog-post-title [Edit]        │
│                                         │
│  [Write] [Preview]                      │
│  ┌─────────────────────────────────────┐│
│  │ # Heading                           ││
│  │                                     ││
│  │ Your content here...                ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  Sidebar:                               │
│  📅 Publish Date: [Oct 1, 2025]         │
│  📁 Categories: [Tutorial] [+ Add]      │
│  🏷️ Tags: [beginner, setup] [+ Add]    │
│  🖼️ Featured Image: [Choose...]        │
│  ⚙️ [SEO Settings]                      │
│                                         │
└─────────────────────────────────────────┘
```

## Blog Features

### Automatic Generation
1. **Blog Index** - List of all posts
2. **Category Pages** - Posts grouped by category
3. **Tag Pages** - Posts grouped by tag
4. **Date Archives** - Posts by year/month
5. **RSS Feed** - XML feed for subscribers
6. **Sitemap** - Updated with new posts

### Post Navigation
- Previous/Next links on posts
- Related posts (by category/tags)
- Author bio (if configured)
- Share buttons (Twitter, Facebook, LinkedIn)

### Writing Enhancements
- Auto-save drafts every 30 seconds
- Markdown shortcuts (bold, italic, links)
- Image insertion inline
- Code syntax highlighting
- Table of contents generation

## Implementation Components

**Services:**
- `BlogService` - Post management
- `MarkdownService` - Parsing and rendering
- `RSSService` - Feed generation
- `ArchiveService` - Date-based archives

**IPC Handlers:**
```typescript
'blog:create'           // Create new post
'blog:update'           // Update existing post
'blog:delete'           // Delete post
'blog:list'             // Get all posts
'blog:publish'          // Change draft to published
'blog:categories'       // Get/create categories
'blog:tags'             // Get/create tags
```

## Blog Configuration

```json
// .anglesite/blog-config.json
{
  "enabled": true,
  "postsPerPage": 10,
  "dateFormat": "MMMM DD, YYYY",
  "excerptLength": 200,
  "author": {
    "name": "Sarah Johnson",
    "bio": "Content creator and blogger",
    "avatar": "/assets/images/avatar.jpg",
    "social": {
      "twitter": "@sarahjohnson",
      "github": "sarahjohnson"
    }
  },
  "features": {
    "rss": true,
    "comments": false,
    "relatedPosts": true,
    "tableOfContents": true
  }
}
```

## RSS Feed Generation

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Sarah's Blog</title>
    <link>https://sarahjohnson.com</link>
    <description>Thoughts on design, code, and creativity</description>
    <atom:link href="https://sarahjohnson.com/feed.xml" rel="self"/>
    <item>
      <title>Getting Started with Anglesite</title>
      <link>https://sarahjohnson.com/blog/getting-started-anglesite</link>
      <guid>https://sarahjohnson.com/blog/getting-started-anglesite</guid>
      <pubDate>Wed, 30 Sep 2025 00:00:00 GMT</pubDate>
      <description>Learn how to build your first website...</description>
    </item>
  </channel>
</rss>
```

## Success Metrics
- **Post Creation Time**: < 5 minutes from idea to published
- **Draft Usage**: 40% of posts start as drafts
- **Publishing Frequency**: Users publish ≥1 post/week
- **RSS Subscribers**: Track feed subscriptions

## Advanced Features (Future)

### Content Scheduling
- Schedule posts for future publication
- Queue system for regular posting
- Timezone-aware scheduling

### Series/Collections
- Group related posts into series
- Multi-part articles with navigation
- Reading progress tracking

### Comments Integration
- CloudFlare Workers-based comments
- Or integrate with external service (Disqus, Commento)

### Newsletter Integration
- Convert RSS to email newsletter
- Integration with services (Mailchimp, ConvertKit)

### Analytics
- Post view tracking
- Most popular posts
- Reading time estimation

## Related Stories
- [02 - Visual Page Editing](02-visual-page-editing.md) - Editor foundation
- [06 - SEO Metadata](07-seo-metadata.md) - Post SEO
- [05 - Image Management](06-image-management.md) - Featured images

## Open Questions

- Q: Support Markdown, HTML, or both?
  - A: Markdown primary, HTML fallback for power users

- Q: Client-side search for posts?
  - A: Post-MVP, use Pagefind or Lunr.js

- Q: Import from existing blog platforms?
  - A: Post-MVP, support WordPress, Medium, Ghost exports

## Definition of Done
- [ ] Post creation and editing implemented
- [ ] Draft/published status working
- [ ] Categories and tags functional
- [ ] RSS feed generation tested
- [ ] Blog index and archives generated
- [ ] Auto-save working (< 5s data loss max)
- [ ] Markdown rendering with syntax highlighting
- [ ] User testing: 5 users create and publish posts
