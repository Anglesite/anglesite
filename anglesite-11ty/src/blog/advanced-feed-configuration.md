---
title: 'Advanced Feed Configuration Guide'
date: 2025-01-15
tags: ['blog']
author: 'Tech Writer'
description: 'Deep dive into customizing and optimizing your Anglesite 11ty feeds'
---

Now that you've got the basics of feed generation working, let's explore the advanced configuration options available in Anglesite 11ty.

## Per-Collection Configuration

Each collection can have its own feed settings:

```json
{
  "feeds": {
    "collections": {
      "blog": {
        "enabled": true,
        "types": ["rss", "json"],
        "title": "My Tech Blog",
        "description": "Technical articles and tutorials",
        "limit": 25,
        "filename": "blog-feed"
      },
      "news": {
        "enabled": true,
        "types": ["atom"],
        "title": "Company News",
        "description": "Latest company updates",
        "limit": 10
      }
    }
  }
}
```

## Feed Metadata Options

### Author Information

Configure default author details for all feeds:

```json
{
  "feeds": {
    "author": {
      "name": "John Doe",
      "email": "john@example.com",
      "url": "https://johndoe.com"
    }
  }
}
```

### Copyright and Categorization

Add legal and organizational metadata:

```json
{
  "feeds": {
    "copyright": "© 2025 My Company",
    "category": "Technology",
    "image": "https://example.com/feed-icon.png",
    "ttl": 1440
  }
}
```

## Main Site Feed

The `mainCollection` setting creates site-wide feeds at `/feed.rss.xml`, `/feed.atom.xml`, and `/feed.json`:

```json
{
  "feeds": {
    "mainCollection": "blog",
    "collections": {
      "blog": {
        "enabled": true,
        "title": "Site-wide Blog Feed"
      }
    }
  }
}
```

## Best Practices

1. **Keep descriptions under 160 characters** for better compatibility
2. **Use consistent author information** across your content
3. **Set reasonable limits** (10-25 items) for performance
4. **Choose appropriate TTL values** based on your update frequency
5. **Test feeds** with popular feed readers

## Performance Considerations

- Feeds are generated during the build process, not on-demand
- Large collections are automatically optimized with sorting and limiting
- All three formats are generated in parallel for efficiency

Happy feed building! 📡
