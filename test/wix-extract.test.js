import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  extractPost,
  extractPage,
  extractMetadata,
  normalizeImageUrl,
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
    expect(result.images.length).toBeGreaterThanOrEqual(2);
    expect(result.images.some((img) => img.src.includes('7986bd_abc123~mv2.png'))).toBe(true);
    expect(result.images.some((img) => img.alt === 'Our backyard compost bin')).toBe(true);
    expect(result.images.some((img) => img.src.includes('7986bd_def456~mv2.jpg'))).toBe(true);
    expect(result.images.some((img) => img.alt === 'Monthly waste reduction chart')).toBe(true);
  });

  it('inserts inline images into body as markdown at the correct position', () => {
    const result = extractPost(html);
    // Images should appear as ![alt](src) in the body
    expect(result.body).toContain('![Our backyard compost bin]');
    expect(result.body).toContain('![Monthly waste reduction chart]');
  });

  it('places inline images between surrounding text blocks', () => {
    const result = extractPost(html);
    const lines = result.body.split('\n\n');
    // The compost bin image should appear after the cloth rags paragraph
    const ragIndex = lines.findIndex((l) => l.includes('cloth rags'));
    const compostImgIndex = lines.findIndex((l) => l.includes('![Our backyard compost bin]'));
    expect(compostImgIndex).toBeGreaterThan(ragIndex);
    // The chart image should appear before "One Year Later"
    const chartImgIndex = lines.findIndex((l) => l.includes('![Monthly waste reduction chart]'));
    const oneYearIndex = lines.findIndex((l) => l.includes('One Year Later'));
    expect(chartImgIndex).toBeLessThan(oneYearIndex);
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

  it('inserts inline images into body as markdown', () => {
    const result = extractPage(html);
    expect(result.body).toContain('![Shiloh Ballard portrait]');
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
