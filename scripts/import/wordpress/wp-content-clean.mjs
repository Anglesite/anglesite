#!/usr/bin/env node

// WordPress content cleaning utilities.
//
// Converts WordPress post/page HTML (from content.rendered or
// content:encoded) into clean Markdown suitable for .mdoc files.
//
// Handles WordPress-specific patterns: Gutenberg block comments,
// shortcodes, wp-block-* classes, and HTML entity encoding.
//
// Usage (CLI):
//   node wp-content-clean.mjs html <file.html>   # Clean HTML → Markdown
//   node wp-content-clean.mjs images <file.html>  # Extract image URLs
//
// All commands output JSON to stdout.

import { readFileSync } from 'node:fs';
import { decodeEntities } from './wp-xml-parse.mjs';

// ---------------------------------------------------------------------------
// Strip WordPress block comments (Gutenberg)
// ---------------------------------------------------------------------------

export function stripBlockComments(html) {
  if (!html) return '';
  return html.replace(/<!--\s*\/?wp:[a-z][a-z0-9-/]*(?:\s+\{[^}]*\})?\s*-->/g, '');
}

// ---------------------------------------------------------------------------
// Strip WordPress shortcodes
// ---------------------------------------------------------------------------

const SHORTCODE_WITH_CONTENT = /\[(gallery|caption|embed|audio|video|playlist)\b[^\]]*\]([\s\S]*?)\[\/\1\]/gi;
const SHORTCODE_SELF_CLOSING = /\[(gallery|caption|embed|audio|video|playlist|wp_caption|jetpack[_-]\w+|contact-form|gravityform|woocommerce_[a-z_]+|vc_\w+|fusion_\w+|et_pb_\w+)\b[^\]]*\/?]/gi;

export function stripShortcodes(html) {
  if (!html) return '';
  let result = html.replace(SHORTCODE_WITH_CONTENT, (_, tag, inner) => {
    const cleaned = inner.replace(/<[^>]*>/g, '').trim();
    return cleaned || '';
  });
  result = result.replace(SHORTCODE_SELF_CLOSING, '');
  return result;
}

// ---------------------------------------------------------------------------
// Strip wp-block-* class attributes and other WordPress-specific attributes
// ---------------------------------------------------------------------------

export function stripWpClasses(html) {
  if (!html) return '';
  return html
    .replace(/\s+class="[^"]*wp-block-[^"]*"/gi, '')
    .replace(/\s+class="[^"]*wp-image-[^"]*"/gi, '')
    .replace(/\s+class="[^"]*aligncenter[^"]*"/gi, '')
    .replace(/\s+class="[^"]*alignleft[^"]*"/gi, '')
    .replace(/\s+class="[^"]*alignright[^"]*"/gi, '')
    .replace(/\s+class="[^"]*alignnone[^"]*"/gi, '')
    .replace(/\s+class="[^"]*size-[a-z]+[^"]*"/gi, '')
    .replace(/\s+class="[^"]*has-[a-z]+-[a-z]+-color[^"]*"/gi, '')
    .replace(/\s+id="[^"]*"/gi, '')
    .replace(/\s+style="[^"]*"/gi, '')
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, '');
}

// ---------------------------------------------------------------------------
// Extract image URLs from WordPress HTML content
// ---------------------------------------------------------------------------

export function extractImages(html) {
  if (!html) return [];
  const images = [];
  const re = /<img\s[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/src=["']([^"']+)["']/);
    const altMatch = tag.match(/alt=["']([^"']*?)["']/);
    if (srcMatch) {
      images.push({
        src: decodeEntities(srcMatch[1]),
        alt: altMatch ? decodeEntities(altMatch[1]) : '',
      });
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// HTML-to-Markdown conversion
// ---------------------------------------------------------------------------

export function htmlToMarkdown(html) {
  if (!html) return '';

  let md = html;

  md = stripBlockComments(md);
  md = stripShortcodes(md);
  md = stripWpClasses(md);

  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, '');

  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    const text = content.replace(/<[^>]*>/g, '').trim();
    return `\n${'#'.repeat(Number(level))} ${text}\n`;
  });

  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const text = content.replace(/<[^>]*>/g, '').trim();
    return text.split('\n').map((line) => `> ${line}`).join('\n');
  });

  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    const text = content.replace(/<[^>]*>/g, '').trim();
    return `- ${text}`;
  });
  md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  md = md.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    return text ? `[${text}](${href})` : '';
  });

  md = md.replace(/<img\s[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*?)["'][^>]*\/?>/gi,
    (_, src, alt) => `![${alt}](${src})`);
  md = md.replace(/<img\s[^>]*alt=["']([^"']*?)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
    (_, alt, src) => `![${alt}](${src})`);
  md = md.replace(/<img\s[^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
    (_, src) => `![](${src})`);

  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${t.replace(/<[^>]*>/g, '').trim()}**`);
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${t.replace(/<[^>]*>/g, '').trim()}**`);
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${t.replace(/<[^>]*>/g, '').trim()}*`);
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${t.replace(/<[^>]*>/g, '').trim()}*`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${t.replace(/<[^>]*>/g, '').trim()}\``);

  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const code = content.replace(/<[^>]*>/g, '').trim();
    return `\n\`\`\`\n${code}\n\`\`\`\n`;
  });

  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  md = md.replace(/<br\s*\/?>/gi, '\n');

  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p[^>]*>/gi, '');

  md = md.replace(/<\/div>/gi, '\n');
  md = md.replace(/<div[^>]*>/gi, '');

  md = md.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, content) => {
    const imgMatch = content.match(/!\[[^\]]*\]\([^)]+\)/);
    const captionMatch = content.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch) {
      const caption = captionMatch ? captionMatch[1].replace(/<[^>]*>/g, '').trim() : '';
      return caption ? `${imgMatch[0]}\n*${caption}*` : imgMatch[0];
    }
    return content.replace(/<[^>]*>/g, '').trim();
  });

  md = md.replace(/<[^>]+>/g, '');

  md = decodeEntities(md);

  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

// ---------------------------------------------------------------------------
// Full content pipeline: WXR content → clean Markdown + images
// ---------------------------------------------------------------------------

export function cleanContent(rawHtml) {
  const images = extractImages(rawHtml);
  const markdown = htmlToMarkdown(rawHtml);
  return { markdown, images };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const [,, command, arg] = process.argv;

if (command && arg) {
  const html = readFileSync(arg, 'utf-8');
  let output;
  switch (command) {
    case 'html':
      output = cleanContent(html);
      break;
    case 'images':
      output = extractImages(html);
      break;
    default:
      console.error(`Unknown command: ${command}. Use: html, images`);
      process.exitCode = 1;
  }
  if (output) {
    console.log(JSON.stringify(output, null, 2));
  }
}
