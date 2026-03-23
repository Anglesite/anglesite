import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.ok(result.body.includes('It started with a single reusable bag'));
    assert.ok(result.body.includes('start small, be patient'));
  });

  it('filters out empty spans and \\xa0 fragments', () => {
    const result = extractPost(html);
    assert.ok(!result.body.includes('\u00a0'));
    // No lines that are just whitespace between paragraphs
    const lines = result.body.split('\n').filter((l) => l.trim() === '');
    // Empty lines are fine as paragraph separators, but no \xa0 content
    for (const line of result.body.split('\n')) {
      assert.ok(line.trim() !== '\u00a0', 'Should not contain \\xa0-only lines');
    }
  });

  it('extracts headings as markdown headings', () => {
    const result = extractPost(html);
    assert.ok(result.body.includes('## The First Steps'));
    assert.ok(result.body.includes('## What Actually Worked'));
    assert.ok(result.body.includes('## One Year Later'));
  });

  it('extracts inline image URLs', () => {
    const result = extractPost(html);
    assert.ok(result.images.length > 0);
    assert.ok(result.images.some((img) => img.src.includes('7986bd_abc123~mv2.png')));
    assert.ok(result.images.some((img) => img.alt === 'Our backyard compost bin'));
  });

  it('does not include post-footer content in the body', () => {
    const result = extractPost(html);
    assert.ok(!result.body.includes('Recent Posts'));
    assert.ok(!result.body.includes('See All'));
  });

  it('does not include post-header content in the body', () => {
    const result = extractPost(html);
    // The title should be in the title field, not duplicated in body
    assert.ok(!result.body.startsWith('My Journey'));
  });
});

describe('extractPage', () => {
  const html = fixture('wix-static-page.html');

  it('extracts the main page content', () => {
    const result = extractPage(html);
    assert.ok(result.body.includes("I'm Shiloh Ballard"));
    assert.ok(result.body.includes('sustainable lifestyle'));
  });

  it('filters out navigation items', () => {
    const result = extractPage(html);
    // Nav items should not appear as standalone content lines
    const lines = result.body.split('\n').map((l) => l.trim());
    assert.ok(!lines.includes('Home'));
    assert.ok(!lines.includes('Blog'));
    assert.ok(!lines.includes('More'));
  });

  it('filters out footer boilerplate', () => {
    const result = extractPage(html);
    assert.ok(!result.body.includes('Paid for by'));
    assert.ok(!result.body.includes('All rights reserved'));
  });

  it('deduplicates repeated text', () => {
    // Wix often renders the same string multiple times in nested spans
    const dupeHtml = fixture('wix-static-page.html');
    const result = extractPage(dupeHtml);
    const lines = result.body.split('\n').map((l) => l.trim()).filter(Boolean);
    const uniqueLines = [...new Set(lines)];
    assert.equal(lines.length, uniqueLines.length, 'No duplicate lines');
  });

  it('extracts headings as markdown', () => {
    const result = extractPage(html);
    assert.ok(result.body.includes('## Our Mission'));
    assert.ok(result.body.includes('## Get in Touch'));
  });

  it('extracts inline images', () => {
    const result = extractPage(html);
    assert.ok(result.images.length > 0);
    assert.ok(result.images.some((img) => img.src.includes('profile123~mv2.jpg')));
  });
});

describe('extractMetadata', () => {
  const html = fixture('wix-blog-post.html');

  it('extracts BlogPosting JSON-LD fields', () => {
    const meta = extractMetadata(html);
    assert.equal(meta.title, 'My Journey to Sustainable Living');
    assert.equal(meta.date, '2025-08-15');
    assert.equal(meta.author, 'Shiloh Ballard');
    assert.ok(meta.description.includes('zero-waste home'));
  });

  it('extracts the hero image URL from JSON-LD', () => {
    const meta = extractMetadata(html);
    assert.ok(meta.image.includes('7986bd_f56edc6b839c4e3cb8caa6b922bb612a~mv2.jpg'));
  });

  it('falls back to og: tags when no JSON-LD is present', () => {
    const noLdHtml = fixture('wix-static-page.html');
    const meta = extractMetadata(noLdHtml);
    assert.equal(meta.title, 'About Us');
    assert.ok(meta.description.includes('Shiloh Ballard'));
  });

  it('returns null fields when no metadata is found', () => {
    const meta = extractMetadata('<html><body>nothing</body></html>');
    assert.equal(meta.title, null);
    assert.equal(meta.date, null);
    assert.equal(meta.author, null);
  });
});

describe('normalizeImageUrl', () => {
  it('strips /v1/fill/... transform parameters', () => {
    const url = 'https://static.wixstatic.com/media/7986bd_f56edc6b~mv2.jpg/v1/fill/w_980,h_551,al_c,q_85,usm_0.66_1.00_0.01/file.webp';
    const result = normalizeImageUrl(url);
    assert.equal(result, 'https://static.wixstatic.com/media/7986bd_f56edc6b~mv2.jpg?w=1200');
  });

  it('strips /v1/fit/... transform parameters', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png/v1/fit/w_500,h_300/image.png';
    const result = normalizeImageUrl(url);
    assert.equal(result, 'https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('handles URLs without /v1/ transforms', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png';
    const result = normalizeImageUrl(url);
    assert.equal(result, 'https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('handles URLs that already have query params', () => {
    const url = 'https://static.wixstatic.com/media/abc123~mv2.png?token=xyz';
    const result = normalizeImageUrl(url);
    assert.equal(result, 'https://static.wixstatic.com/media/abc123~mv2.png?w=1200');
  });

  it('detects the original file extension', () => {
    const jpgUrl = 'https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_100/file.webp';
    assert.ok(normalizeImageUrl(jpgUrl).includes('abc~mv2.jpg'));

    const pngUrl = 'https://static.wixstatic.com/media/def~mv2.png/v1/fill/w_100/file.webp';
    assert.ok(normalizeImageUrl(pngUrl).includes('def~mv2.png'));
  });

  it('passes through non-Wix URLs unchanged', () => {
    const url = 'https://example.com/image.jpg';
    assert.equal(normalizeImageUrl(url), 'https://example.com/image.jpg');
  });
});
