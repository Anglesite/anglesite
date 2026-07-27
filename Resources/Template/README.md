# Anglesite website template

This directory is the Anglesite website template: an Astro project that gets scaffolded into
a new site's `Source/` directory when you create a site in the app.

## Content licensing

`src/data/licensing.json` declares the license applied to your content. It holds a site-wide
default plus optional per-collection overrides:

```json
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": {
    "photos": { "url": "https://creativecommons.org/licenses/by-nc/4.0/", "name": "CC BY-NC 4.0" },
    "notes": null
  }
}
```

- `"default": null` (the scaffolded value) means **all rights reserved** — nothing is emitted.
- A collection set to `null` asserts nothing, overriding the site default.
- `bookmarks`, `replies`, `likes`, and `reviews` assert nothing **by default**, because those
  entries are about someone else's work. Set an explicit override if you want a license on them.

The resolved license is emitted three ways: `license` in the page's schema.org JSON-LD,
`u-license` in the entry's Microformats2 markup, and `<link rel="license">` in `<head>`.
Set `COPYRIGHT_HOLDER` in `.site-config` to name the rights holder in the footer; it falls back
to your profile name.
