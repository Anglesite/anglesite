import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  extractPost,
  extractPage,
  extractMetadata,
  normalizeImageUrl,
  joinSplitWords,
  mergeOrdinals,
  isOpaqueWixSlug,
  slugifyTitle,
  resolvePageSlug,
} from '../scripts/import/wix/wix-extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

describe('extractPost', () => {
  const html = fixture('wix-blog-post.html');

  it('extracts the post body text between post-description and post-footer', () => {
    const result = extractPost(html);
    expect(result.body).toContain('It started with a single reusable bag');
    expect(result.body).toContain('start small, be patient');
  });

  it('filters out empty spans and \\xa0 fragments', () => {
    const result = extractPost(html);
    expect(result.body).not.toContain('\u00a0');
    for (const line of result.body.split('\n')) {
      expect(line.trim()).not.toBe('\u00a0');
    }
  });

  it('extracts headings as markdown headings', () => {
    const result = extractPost(html);
    expect(result.body).toContain('## The First Steps');
    expect(result.body).toContain('## What Actually Worked');
    expect(result.body).toContain('## One Year Later');
  });

  it('extracts inline image URLs', () => {
    const result = extractPost(html);
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images.some((img) => img.src.includes('7986bd_abc123~mv2.png'))).toBe(true);
    expect(result.images.some((img) => img.alt === 'Our backyard compost bin')).toBe(true);
  });

  it('does not include post-footer content in the body', () => {
    const result = extractPost(html);
    expect(result.body).not.toContain('Recent Posts');
    expect(result.body).not.toContain('See All');
  });

  it('does not include post-header content in the body', () => {
    const result = extractPost(html);
    expect(result.body.startsWith('My Journey')).toBe(false);
  });

  it('converts hyperlinks to markdown links', () => {
    const result = extractPost(html);
    expect(result.body).toContain('[Going Zero Waste](https://www.goingzerowaste.com/)');
    expect(result.body).toContain('[here](https://example.com/guide)');
  });

  it('preserves surrounding text around links', () => {
    const result = extractPost(html);
    expect(result.body).toContain('visit [Going Zero Waste]');
    expect(result.body).toContain('guide [here]');
  });

  it('extracts tags from post-footer category links', () => {
    const result = extractPost(html);
    expect(result.tags).toEqual(['sustainability', 'zero-waste', 'lifestyle']);
  });

  it('returns empty tags array when no tags are present', () => {
    const noTagsHtml = html.replace(/<div class="tags-row">[\s\S]*?<\/div>/, '');
    const result = extractPost(noTagsHtml);
    expect(result.tags).toEqual([]);
  });
});

describe('extractPage', () => {
  const html = fixture('wix-static-page.html');

  it('extracts the main page content', () => {
    const result = extractPage(html);
    expect(result.body).toContain("I'm Shiloh Ballard");
    expect(result.body).toContain('sustainable lifestyle');
  });

  it('filters out navigation items', () => {
    const result = extractPage(html);
    const lines = result.body.split('\n').map((l) => l.trim());
    expect(lines).not.toContain('Home');
    expect(lines).not.toContain('Blog');
    expect(lines).not.toContain('More');
  });

  it('filters out footer boilerplate', () => {
    const result = extractPage(html);
    expect(result.body).not.toContain('Paid for by');
    expect(result.body).not.toContain('All rights reserved');
  });

  it('deduplicates repeated text', () => {
    const dupeHtml = fixture('wix-static-page.html');
    const result = extractPage(dupeHtml);
    const lines = result.body.split('\n').map((l) => l.trim()).filter(Boolean);
    const uniqueLines = [...new Set(lines)];
    expect(lines.length).toBe(uniqueLines.length);
  });

  it('extracts headings as markdown', () => {
    const result = extractPage(html);
    expect(result.body).toContain('## Our Mission');
    expect(result.body).toContain('## Get in Touch');
  });

  it('extracts inline images', () => {
    const result = extractPage(html);
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images.some((img) => img.src.includes('profile123~mv2.jpg'))).toBe(true);
  });

  it('converts hyperlinks to markdown links', () => {
    const result = extractPage(html);
    expect(result.body).toContain('[The Local Paper](https://example.com/article)');
  });

  it('extracts links even when text is directly in <a> with no inner span', () => {
    const result = extractPage(html);
    expect(result.body).toContain('[Link without inner span](https://example.com/no-span-link)');
  });
});

describe('extractMetadata', () => {
  const html = fixture('wix-blog-post.html');

  it('extracts BlogPosting JSON-LD fields', () => {
    const meta = extractMetadata(html);
    expect(meta.title).toBe('My Journey to Sustainable Living');
    expect(meta.date).toBe('2025-08-15');
    expect(meta.author).toBe('Shiloh Ballard');
    expect(meta.description).toContain('zero-waste home');
  });

  it('extracts the hero image URL from JSON-LD', () => {
    const meta = extractMetadata(html);
    expect(meta.image).toContain('7986bd_f56edc6b839c4e3cb8caa6b922bb612a~mv2.jpg');
  });

  it('falls back to og: tags when no JSON-LD is present', () => {
    const noLdHtml = fixture('wix-static-page.html');
    const meta = extractMetadata(noLdHtml);
    expect(meta.title).toBe('About Us');
    expect(meta.description).toContain('Shiloh Ballard');
  });

  it('returns null fields when no metadata is found', () => {
    const meta = extractMetadata('<html><body>nothing</body></html>');
    expect(meta.title).toBeNull();
    expect(meta.date).toBeNull();
    expect(meta.author).toBeNull();
  });
});

describe('normalizeImageUrl', () => {
  it('strips /v1/fill/... transform parameters', () => {
    const url = 'https://static.wixstatic.com/media/7986bd_f56edc6b~mv2.jpg/v1/fill/w_980,h_551,al_c,q_85,usm_0.66_1.00_0.01/file.webp';
    expect(normalizeImageUrl(url)).toBe('https://static.wixstatic.com/media/7986bd_f56edc6b~mv2.jpg?w=1200');
  });

  it('strips /v1/fit/... transform parameters', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png/v1/fit/w_500,h_300/image.png';
    expect(normalizeImageUrl(url)).toBe('https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('handles URLs without /v1/ transforms', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png';
    expect(normalizeImageUrl(url)).toBe('https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('handles URLs that already have query params', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png?token=xyz';
    expect(normalizeImageUrl(url)).toBe('https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('detects the original file extension', () => {
    const jpgUrl = 'https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_100/file.webp';
    expect(normalizeImageUrl(jpgUrl)).toContain('abc~mv2.jpg');

    const pngUrl = 'https://static.wixstatic.com/media/def~mv2.png/v1/fill/w_100/file.webp';
    expect(normalizeImageUrl(pngUrl)).toContain('def~mv2.png');
  });

  it('passes through non-Wix URLs unchanged', () => {
    expect(normalizeImageUrl('https://example.com/image.jpg')).toBe('https://example.com/image.jpg');
  });
});

describe('joinSplitWords', () => {
  it('merges when lowercase precedes uppercase at a mid-word split', () => {
    // "of R" → "of" ends naturally, but "R" is preceded by space+lowercase "f"
    // The actual Wix pattern: "...tion of R [edevelopment..."
    // "R" is mid-word because the continuation starts lowercase
    expect(joinSplitWords('Dissolution of R [edevelopment Agencies](url)'))
      .toBe('Dissolution of R[edevelopment Agencies](url)');
  });

  it('does not merge when text ends at a word boundary with lowercase', () => {
    expect(joinSplitWords('Read more [here](url)'))
      .toBe('Read more [here](url)');
  });

  it('does not merge when next word starts with uppercase', () => {
    expect(joinSplitWords('Chapter R [Evolution](url)'))
      .toBe('Chapter R [Evolution](url)');
  });

  it('handles empty and single-word strings', () => {
    expect(joinSplitWords('')).toBe('');
    expect(joinSplitWords('hello')).toBe('hello');
  });
});

describe('mergeOrdinals', () => {
  it('merges split ordinal suffixes after numbers', () => {
    expect(mergeOrdinals('January 27 th , 2026')).toBe('January 27th, 2026');
    expect(mergeOrdinals('the 1 st time')).toBe('the 1st time');
    expect(mergeOrdinals('on the 2 nd floor')).toBe('on the 2nd floor');
    expect(mergeOrdinals('the 3 rd option')).toBe('the 3rd option');
  });

  it('does not merge ordinal-like words that are not after numbers', () => {
    expect(mergeOrdinals('with the group')).toBe('with the group');
    expect(mergeOrdinals('north wind')).toBe('north wind');
  });

  it('handles multiple ordinals in one string', () => {
    expect(mergeOrdinals('from the 1 st to the 15 th'))
      .toBe('from the 1st to the 15th');
  });
});

describe('isOpaqueWixSlug', () => {
  it('detects general-N pattern', () => {
    expect(isOpaqueWixSlug('general-5')).toBe(true);
    expect(isOpaqueWixSlug('general-12')).toBe(true);
  });

  it('detects page-N pattern', () => {
    expect(isOpaqueWixSlug('page-1')).toBe(true);
    expect(isOpaqueWixSlug('page-99')).toBe(true);
  });

  it('detects blank-N pattern', () => {
    expect(isOpaqueWixSlug('blank-3')).toBe(true);
  });

  it('does not flag meaningful slugs', () => {
    expect(isOpaqueWixSlug('endorsements')).toBe(false);
    expect(isOpaqueWixSlug('about-us')).toBe(false);
    expect(isOpaqueWixSlug('contact')).toBe(false);
    expect(isOpaqueWixSlug('our-mission')).toBe(false);
  });

  it('detects very short slugs (< 4 chars) as opaque', () => {
    expect(isOpaqueWixSlug('x')).toBe(true);
    expect(isOpaqueWixSlug('ab')).toBe(true);
    expect(isOpaqueWixSlug('abc')).toBe(true);
  });

  it('does not flag 4+ char meaningful slugs', () => {
    expect(isOpaqueWixSlug('blog')).toBe(false);
    expect(isOpaqueWixSlug('faq')).toBe(true); // 3 chars, opaque
    expect(isOpaqueWixSlug('faqs')).toBe(false); // 4 chars, fine
  });
});

describe('slugifyTitle', () => {
  it('converts a simple title to a slug', () => {
    expect(slugifyTitle('Endorsements')).toBe('endorsements');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugifyTitle('About Us')).toBe('about-us');
  });

  it('removes special characters', () => {
    expect(slugifyTitle('Our Mission & Vision!')).toBe('our-mission-vision');
  });

  it('collapses multiple hyphens', () => {
    expect(slugifyTitle('Get -- In Touch')).toBe('get-in-touch');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyTitle('  Hello World  ')).toBe('hello-world');
  });

  it('handles titles with numbers', () => {
    expect(slugifyTitle('Top 10 Tips')).toBe('top-10-tips');
  });

  it('strips pipe-separated site name suffixes', () => {
    expect(slugifyTitle('Endorsements | Shiloh Ballard')).toBe('endorsements');
    expect(slugifyTitle('About Us — My Site')).toBe('about-us');
    expect(slugifyTitle('Contact - Company Name')).toBe('contact');
  });
});

describe('resolvePageSlug', () => {
  it('renames opaque slug to title-derived slug with redirect', () => {
    const result = resolvePageSlug('general-5', 'Endorsements');
    expect(result.slug).toBe('endorsements');
    expect(result.redirect).toBe('/general-5 /endorsements 301');
  });

  it('keeps meaningful slugs unchanged with no redirect', () => {
    const result = resolvePageSlug('endorsements', 'Endorsements');
    expect(result.slug).toBe('endorsements');
    expect(result.redirect).toBeNull();
  });

  it('keeps meaningful slugs that differ from title', () => {
    const result = resolvePageSlug('about-us', 'About Our Company');
    expect(result.slug).toBe('about-us');
    expect(result.redirect).toBeNull();
  });

  it('renames page-N slugs', () => {
    const result = resolvePageSlug('page-3', 'Contact Us');
    expect(result.slug).toBe('contact-us');
    expect(result.redirect).toBe('/page-3 /contact-us 301');
  });

  it('renames blank-N slugs', () => {
    const result = resolvePageSlug('blank-1', 'Our Services');
    expect(result.slug).toBe('our-services');
    expect(result.redirect).toBe('/blank-1 /our-services 301');
  });

  it('falls back to original slug if title is empty', () => {
    const result = resolvePageSlug('general-5', '');
    expect(result.slug).toBe('general-5');
    expect(result.redirect).toBeNull();
  });

  it('strips site name from og:title before slugifying', () => {
    const result = resolvePageSlug('general-5', 'Endorsements | Shiloh Ballard');
    expect(result.slug).toBe('endorsements');
    expect(result.redirect).toBe('/general-5 /endorsements 301');
  });
});
