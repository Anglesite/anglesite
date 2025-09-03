---
title: 'Welcome to RSS/Atom/JSON Feeds'
date: 2025-01-01
tags: ['blog']
author: 'Anglesite Team'
description: 'Introduction to the new feeds functionality in Anglesite 11ty'
---

Welcome to the new RSS, Atom, and JSON feeds feature in Anglesite 11ty! This post introduces the powerful feed generation capabilities that have been added to the framework.

## What Are Web Feeds?

Web feeds are standardized formats that allow websites to syndicate their content automatically. They enable:

- **RSS readers** to aggregate content from multiple sources
- **Social media platforms** to automatically pull in new posts
- **API integrations** to consume website updates programmatically
- **SEO benefits** through structured content discovery

## Supported Feed Formats

Anglesite 11ty now supports three popular feed formats:

### RSS 2.0

The classic feed format that's been around since 2002. Widely supported by feed readers and aggregation services.

### Atom 1.0

A more modern XML-based format with better internationalization and extensibility features.

### JSON Feed 1.1

A JSON-based format that's easier for modern applications to parse and consume.

## Getting Started

To enable feeds for your collections, simply configure them in your `website.json`:

```json
{
  "feeds": {
    "enabled": true,
    "defaultTypes": ["rss", "atom", "json"],
    "mainCollection": "blog",
    "collections": {
      "blog": {
        "enabled": true,
        "title": "My Blog",
        "description": "Latest blog posts",
        "limit": 20
      }
    }
  }
}
```

## What's Next?

Stay tuned for more posts about advanced feed configuration, customization options, and integration patterns!
