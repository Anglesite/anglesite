#!/usr/bin/env node

// Wix content extraction utilities.
//
// Wix Thunderbolt server-side renders content into deeply nested <span> tags
// inside data-hook="rcv-block*" elements. WebFetch can't parse these, but
// this module can — using regex on the raw HTML returned by curl.
//
// Usage (CLI):
//   node wix-extract.js post   <file.html>   # Extract blog post body + images
//   node wix-extract.js page   <file.html>   # Extract static page body + images
//   node wix-extract.js meta   <file.html>   # Extract JSON-LD / OG metadata
//   node wix-extract.js image  <url>          # Normalize a Wix CDN image URL
//
// All commands output JSON to stdout.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all text from <span> tags in an HTML string (non-greedy). */
function spanTexts(html) {
  const spans = [];
  const re = /<span[^>]*>(.*?)<\/span>/gs;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Strip any nested HTML tags from the captured content
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    spans.push(text);
  }
  return spans;
}

/** True if text is empty, whitespace-only, or just \xa0 */
function isEmpty(text) {
  return !text || /^[\s\u00a0]*$/.test(text);
}

/** Detect if a block contains a heading (bold text at heading font-size). */
function isHeading(blockHtml) {
  return /<span[^>]*font-size:\s*2[4-9]px|font-size:\s*3[0-9]px/i.test(blockHtml)
    && /<span[^>]*font-weight:\s*bold/i.test(blockHtml);
}

/** Extract <img> elements from HTML, returning [{src, alt}]. */
function extractImages(html) {
  const images = [];
  const re = /<img\s[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/src=["']([^"']+)["']/);
    const altMatch = tag.match(/alt=["']([^"']+)["']/);
    if (srcMatch) {
      images.push({
        src: srcMatch[1],
        alt: altMatch ? altMatch[1] : '',
      });
    }
  }
  return images;
}

// Nav items and footer boilerplate to filter from static pages.
const NAV_WORDS = new Set([
  'home', 'blog', 'about', 'contact', 'more', 'menu', 'search',
  'log in', 'sign in', 'sign up',
]);

function isNavItem(text) {
  return NAV_WORDS.has(text.toLowerCase().trim());
}

function isFooterBoilerplate(text) {
  return /^paid for by\b/i.test(text)
    || /all rights reserved/i.test(text)
    || /^\u00a9/i.test(text.trim());
}

// ---------------------------------------------------------------------------
// extractPost — blog post body from data-hook="post-description" region
// ---------------------------------------------------------------------------

export function extractPost(html) {
  // Isolate the region between post-description and post-footer
  const descStart = html.indexOf('data-hook="post-description"');
  const footerStart = html.indexOf('data-hook="post-footer"');

  if (descStart === -1) {
    return { body: '', images: [] };
  }

  const regionEnd = footerStart !== -1 ? footerStart : html.length;
  const region = html.slice(descStart, regionEnd);

  // Extract images from the region
  const images = extractImages(region);

  // Process each rcv-block individually to detect headings vs paragraphs
  const blocks = [];
  const blockRe = /data-hook="rcv-block[^"]*"[^>]*>([\s\S]*?)(?=data-hook="rcv-block|$)/g;
  let bm;
  while ((bm = blockRe.exec(region)) !== null) {
    const blockHtml = bm[1];
    const texts = spanTexts(blockHtml).filter((t) => !isEmpty(t));
    if (texts.length === 0) continue;

    const combined = texts.join(' ');
    if (isHeading(blockHtml)) {
      blocks.push(`## ${combined}`);
    } else {
      blocks.push(combined);
    }
  }

  // If no rcv-blocks found, fall back to extracting all spans from the region
  if (blocks.length === 0) {
    const allTexts = spanTexts(region).filter((t) => !isEmpty(t));
    blocks.push(...allTexts);
  }

  return {
    body: blocks.join('\n\n'),
    images,
  };
}

// ---------------------------------------------------------------------------
// extractPage — static page content (no post-description region)
// ---------------------------------------------------------------------------

export function extractPage(html) {
  // Remove <script> and <style> blocks
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Remove <nav> blocks
  cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '');

  // Remove <footer> blocks
  cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Extract images before stripping tags
  const images = extractImages(cleaned);

  // Process blocks with heading detection
  const blocks = [];
  const seen = new Set();

  // Split by top-level divs that contain spans
  const divRe = /<div[^>]*>([\s\S]*?)<\/div>(?=\s*<div|$)/g;
  let dm;
  while ((dm = divRe.exec(cleaned)) !== null) {
    const divHtml = dm[0];
    const texts = spanTexts(divHtml).filter((t) => !isEmpty(t));
    if (texts.length === 0) continue;

    const combined = texts.join(' ');

    // Skip nav items and footer boilerplate
    if (isNavItem(combined)) continue;
    if (isFooterBoilerplate(combined)) continue;

    // Deduplicate
    if (seen.has(combined)) continue;
    seen.add(combined);

    if (isHeading(divHtml)) {
      blocks.push(`## ${combined}`);
    } else {
      blocks.push(combined);
    }
  }

  return {
    body: blocks.join('\n\n'),
    images,
  };
}

// ---------------------------------------------------------------------------
// extractMetadata — JSON-LD and OG tag parsing
// ---------------------------------------------------------------------------

export function extractMetadata(html) {
  const result = { title: null, date: null, description: null, author: null, image: null };

  // Try JSON-LD first
  const ldRe = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = ldRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(ldMatch[1]);
      if (data['@type'] === 'BlogPosting' || data['@type'] === 'Article') {
        result.title = data.headline || data.name || null;
        if (data.datePublished) {
          result.date = data.datePublished.slice(0, 10); // YYYY-MM-DD
        }
        result.description = data.description || null;
        if (data.author) {
          result.author = typeof data.author === 'string'
            ? data.author
            : data.author.name || null;
        }
        if (data.image) {
          result.image = typeof data.image === 'string'
            ? data.image
            : data.image.url || null;
        }
        return result; // BlogPosting found, use it
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  // Fall back to OG tags
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);

  result.title = ogTitle ? ogTitle[1] : null;
  result.description = ogDesc ? ogDesc[1] : (metaDesc ? metaDesc[1] : null);
  result.image = ogImage ? ogImage[1] : null;

  return result;
}

// ---------------------------------------------------------------------------
// normalizeImageUrl — strip Wix CDN transforms, append ?w=1200
// ---------------------------------------------------------------------------

export function normalizeImageUrl(url) {
  // Only process Wix static URLs
  if (!url.includes('static.wixstatic.com/media/')) {
    return url;
  }

  // Extract the base media path (everything before /v1/ or ?)
  const mediaPrefix = 'static.wixstatic.com/media/';
  const mediaStart = url.indexOf(mediaPrefix) + mediaPrefix.length;
  const afterMedia = url.slice(mediaStart);

  // The asset ID is everything up to /v1/, ?, or end of string
  const assetEnd = afterMedia.search(/[/?]/);
  const assetId = assetEnd === -1 ? afterMedia : afterMedia.slice(0, assetEnd);

  return `https://static.wixstatic.com/media/${assetId}?w=1200`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const [,, command, arg] = process.argv;

if (command) {
  if (command === 'image') {
    console.log(JSON.stringify(normalizeImageUrl(arg)));
  } else {
    const html = readFileSync(arg, 'utf-8');
    let output;
    switch (command) {
      case 'post':
        output = extractPost(html);
        break;
      case 'page':
        output = extractPage(html);
        break;
      case 'meta':
        output = extractMetadata(html);
        break;
      default:
        console.error(`Unknown command: ${command}. Use: post, page, meta, image`);
        process.exitCode = 1;
    }
    if (output) {
      console.log(JSON.stringify(output, null, 2));
    }
  }
}
