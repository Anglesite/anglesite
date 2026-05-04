import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  decodeEntities,
  parseTaxonomies,
  parseAuthors,
  parseItem,
  parseWxr,
  generateRedirects,
} from '../scripts/import/wordpress/wp-xml-parse.mjs';

import {
  stripBlockComments,
  stripShortcodes,
  stripWpClasses,
  extractImages,
  htmlToMarkdown,
  cleanContent,
} from '../scripts/import/wordpress/wp-content-clean.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', 'wordpress', name), 'utf-8');

// ---------------------------------------------------------------------------
// wp-xml-parse.mjs
// ---------------------------------------------------------------------------

describe('decodeEntities', () => {
  it('decodes numeric HTML entities', () => {
    expect(decodeEntities('&#8217;')).toBe('’');
    expect(decodeEntities('&#8220;')).toBe('“');
  });

  it('decodes hex HTML entities', () => {
    expect(decodeEntities('&#x2019;')).toBe('’');
  });

  it('decodes named HTML entities', () => {
    expect(decodeEntities('&amp;')).toBe('&');
    expect(decodeEntities('&lt;')).toBe('<');
    expect(decodeEntities('&gt;')).toBe('>');
    expect(decodeEntities('&quot;')).toBe('"');
  });

  it('decodes mixed entities in a string', () => {
    expect(decodeEntities('A Beginner&#8217;s Guide &amp; More'))
      .toBe('A Beginner’s Guide & More');
  });

  it('returns empty string for falsy input', () => {
    expect(decodeEntities('')).toBe('');
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
  });
});

describe('parseTaxonomies', () => {
  const xml = fixture('wxr-export.xml');
  const { categories, tags } = parseTaxonomies(xml);

  it('extracts all categories', () => {
    expect(categories).toHaveLength(3);
    expect(categories.map((c) => c.name)).toEqual(['Recipes', 'Sourdough', 'Bakery News']);
  });

  it('extracts category slugs', () => {
    expect(categories.map((c) => c.slug)).toEqual(['recipes', 'sourdough', 'news']);
  });

  it('tracks parent-child category relationships', () => {
    const sourdough = categories.find((c) => c.slug === 'sourdough');
    expect(sourdough.parent).toBe('recipes');
    const recipes = categories.find((c) => c.slug === 'recipes');
    expect(recipes.parent).toBeNull();
  });

  it('extracts all tags', () => {
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.name)).toEqual(['Gluten Free', 'Seasonal', 'Beginner']);
  });

  it('extracts tag slugs', () => {
    expect(tags.map((t) => t.slug)).toEqual(['gluten-free', 'seasonal', 'beginner']);
  });
});

describe('parseAuthors', () => {
  const xml = fixture('wxr-export.xml');
  const authors = parseAuthors(xml);

  it('extracts all authors', () => {
    expect(authors).toHaveLength(2);
  });

  it('extracts author display names', () => {
    expect(authors[0].displayName).toBe('Maria Santos');
    expect(authors[1].displayName).toBe('James Chen');
  });

  it('extracts author logins', () => {
    expect(authors[0].login).toBe('maria');
    expect(authors[1].login).toBe('james');
  });

  it('extracts author emails', () => {
    expect(authors[0].email).toBe('maria@greenvalleybakery.com');
  });
});

describe('parseItem', () => {
  const xml = fixture('wxr-export.xml');
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  const postItem = parseItem(items[0]);

  it('extracts post type', () => {
    expect(postItem.postType).toBe('post');
  });

  it('decodes HTML entities in title', () => {
    expect(postItem.title).toBe('The Art of Sourdough: A Beginner’s Guide');
  });

  it('extracts the slug', () => {
    expect(postItem.slug).toBe('sourdough-beginners-guide');
  });

  it('extracts the publish date as YYYY-MM-DD', () => {
    expect(postItem.publishDate).toBe('2024-03-15');
  });

  it('extracts the original link', () => {
    expect(postItem.link).toBe('https://greenvalleybakery.com/2024/03/15/sourdough-beginners-guide/');
  });

  it('extracts categories from item', () => {
    expect(postItem.categories).toEqual(['Recipes', 'Sourdough']);
  });

  it('extracts tags from item', () => {
    expect(postItem.tags).toEqual(['Beginner']);
  });

  it('extracts content:encoded as raw HTML', () => {
    expect(postItem.content).toContain('sourdough bread at home');
    expect(postItem.content).toContain('<!-- wp:paragraph -->');
  });

  it('strips HTML from excerpt', () => {
    expect(postItem.excerpt).toBe('Making sourdough bread at home is one of the most rewarding baking experiences.');
  });

  it('extracts featured image ID from postmeta', () => {
    expect(postItem.featuredImageId).toBe('101');
  });
});

describe('parseWxr', () => {
  const xml = fixture('wxr-export.xml');
  const result = parseWxr(xml);

  it('separates posts from pages', () => {
    expect(result.posts).toHaveLength(2);
    expect(result.pages).toHaveLength(2);
  });

  it('filters out draft posts', () => {
    const titles = result.posts.map((p) => p.title);
    expect(titles).not.toContain('Unpublished Recipe Draft');
  });

  it('extracts media attachments', () => {
    expect(result.media).toHaveLength(2);
    expect(result.media[0].url).toContain('wp-content/uploads');
  });

  it('resolves featured images from media map', () => {
    const sourdoughPost = result.posts.find((p) => p.slug === 'sourdough-beginners-guide');
    expect(sourdoughPost.featuredImage).toBe(
      'https://greenvalleybakery.com/wp-content/uploads/2024/03/sourdough-starter.jpg'
    );
  });

  it('does not add featuredImage when no _thumbnail_id exists', () => {
    const holidayPost = result.posts.find((p) => p.slug === 'holiday-hours');
    expect(holidayPost.featuredImage).toBeUndefined();
  });

  it('extracts navigation items', () => {
    expect(result.navigation.length).toBeGreaterThanOrEqual(2);
    const homeNav = result.navigation.find((n) => n.title === 'Home');
    expect(homeNav.url).toBe('https://greenvalleybakery.com/');
  });

  it('reports custom post types in skipped', () => {
    expect(result.customTypes).toContain('portfolio');
    const portfolioSkipped = result.skipped.find((s) => s.postType === 'portfolio');
    expect(portfolioSkipped.title).toBe('Spring Tasting Menu');
  });

  it('reports draft posts in skipped', () => {
    const draftSkipped = result.skipped.find((s) => s.reason === 'draft');
    expect(draftSkipped.title).toBe('Unpublished Recipe Draft');
  });

  it('provides accurate stats', () => {
    expect(result.stats.posts).toBe(2);
    expect(result.stats.pages).toBe(2);
    expect(result.stats.media).toBe(2);
    expect(result.stats.drafts).toBe(1);
    expect(result.stats.customTypeItems).toBe(1);
  });

  it('includes taxonomies and authors', () => {
    expect(result.taxonomies.categories).toHaveLength(3);
    expect(result.taxonomies.tags).toHaveLength(3);
    expect(result.authors).toHaveLength(2);
  });
});

describe('generateRedirects', () => {
  const xml = fixture('wxr-export.xml');
  const result = parseWxr(xml);

  it('generates 301 redirects from old WordPress URLs', () => {
    const redirects = generateRedirects(result.posts);
    expect(redirects).toContain('/2024/03/15/sourdough-beginners-guide /blog/sourdough-beginners-guide 301');
    expect(redirects).toContain('/2024/12/20/holiday-hours /blog/holiday-hours 301');
  });

  it('generates page redirects without /blog prefix', () => {
    const redirects = generateRedirects(result.pages);
    const aboutRedirect = redirects.find((r) => r.includes('/about'));
    expect(aboutRedirect).toBeUndefined();
  });

  it('skips items without a link', () => {
    const redirects = generateRedirects([{ slug: 'test', postType: 'post' }]);
    expect(redirects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// wp-content-clean.mjs
// ---------------------------------------------------------------------------

describe('stripBlockComments', () => {
  it('removes simple block comments', () => {
    expect(stripBlockComments('<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->'))
      .toBe('<p>Hello</p>');
  });

  it('removes block comments with JSON attributes', () => {
    expect(stripBlockComments('<!-- wp:image {"id":101,"sizeSlug":"large"} --><img/><!-- /wp:image -->'))
      .toBe('<img/>');
  });

  it('removes nested namespace blocks', () => {
    expect(stripBlockComments('<!-- wp:heading {"level":3} -->'))
      .toBe('');
  });

  it('preserves non-WordPress comments', () => {
    expect(stripBlockComments('<!-- This is a regular comment -->'))
      .toBe('<!-- This is a regular comment -->');
  });

  it('handles empty input', () => {
    expect(stripBlockComments('')).toBe('');
    expect(stripBlockComments(null)).toBe('');
  });
});

describe('stripShortcodes', () => {
  it('removes self-closing gallery shortcodes', () => {
    expect(stripShortcodes('[gallery ids="1,2,3"]')).toBe('');
  });

  it('removes shortcodes with content, preserving inner text', () => {
    expect(stripShortcodes('[caption id="att_1"]A nice photo[/caption]'))
      .toBe('A nice photo');
  });

  it('removes contact-form shortcodes', () => {
    expect(stripShortcodes('[contact-form to="a@b.com" subject="Hi"]')).toBe('');
  });

  it('removes embed shortcodes with content, preserving URL', () => {
    expect(stripShortcodes('[embed]https://youtube.com/watch?v=abc[/embed]'))
      .toBe('https://youtube.com/watch?v=abc');
  });

  it('removes page builder shortcodes', () => {
    expect(stripShortcodes('[vc_column width="1/2"]')).toBe('');
    expect(stripShortcodes('[fusion_text]')).toBe('');
    expect(stripShortcodes('[et_pb_section]')).toBe('');
  });

  it('preserves text around shortcodes', () => {
    expect(stripShortcodes('Before [gallery ids="1"] After')).toBe('Before  After');
  });
});

describe('stripWpClasses', () => {
  it('removes wp-block-* classes', () => {
    expect(stripWpClasses('<h2 class="wp-block-heading">Title</h2>'))
      .toBe('<h2>Title</h2>');
  });

  it('removes wp-image-* classes', () => {
    expect(stripWpClasses('<img class="wp-image-101" src="test.jpg"/>'))
      .toBe('<img src="test.jpg"/>');
  });

  it('removes alignment classes', () => {
    expect(stripWpClasses('<div class="aligncenter">Content</div>'))
      .toBe('<div>Content</div>');
  });

  it('removes inline styles', () => {
    expect(stripWpClasses('<p style="color: red;">Text</p>'))
      .toBe('<p>Text</p>');
  });

  it('removes data attributes', () => {
    expect(stripWpClasses('<div data-id="123" data-type="block">Text</div>'))
      .toBe('<div>Text</div>');
  });
});

describe('extractImages', () => {
  it('extracts image src and alt from HTML', () => {
    const images = extractImages('<img src="https://example.com/photo.jpg" alt="A photo"/>');
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/photo.jpg');
    expect(images[0].alt).toBe('A photo');
  });

  it('handles images without alt text', () => {
    const images = extractImages('<img src="https://example.com/photo.jpg"/>');
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('');
  });

  it('extracts multiple images', () => {
    const html = '<img src="a.jpg" alt="A"/><p>text</p><img src="b.jpg" alt="B"/>';
    const images = extractImages(html);
    expect(images).toHaveLength(2);
  });

  it('decodes HTML entities in URLs', () => {
    const images = extractImages('<img src="https://example.com/photo.jpg?w=100&amp;h=200" alt="Test"/>');
    expect(images[0].src).toBe('https://example.com/photo.jpg?w=100&h=200');
  });

  it('returns empty array for no images', () => {
    expect(extractImages('<p>No images here</p>')).toEqual([]);
    expect(extractImages('')).toEqual([]);
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings', () => {
    expect(htmlToMarkdown('<h2>Title</h2>')).toContain('## Title');
    expect(htmlToMarkdown('<h3>Subtitle</h3>')).toContain('### Subtitle');
  });

  it('converts paragraphs to separated text', () => {
    const md = htmlToMarkdown('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(md).toContain('First paragraph.');
    expect(md).toContain('Second paragraph.');
  });

  it('converts links to markdown links', () => {
    expect(htmlToMarkdown('<a href="https://example.com">Click here</a>'))
      .toContain('[Click here](https://example.com)');
  });

  it('converts images to markdown images', () => {
    expect(htmlToMarkdown('<img src="photo.jpg" alt="A photo"/>'))
      .toContain('![A photo](photo.jpg)');
  });

  it('converts bold and italic', () => {
    expect(htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**');
    expect(htmlToMarkdown('<em>italic</em>')).toContain('*italic*');
    expect(htmlToMarkdown('<b>bold</b>')).toContain('**bold**');
    expect(htmlToMarkdown('<i>italic</i>')).toContain('*italic*');
  });

  it('converts inline code', () => {
    expect(htmlToMarkdown('<code>npm install</code>')).toContain('`npm install`');
  });

  it('converts code blocks', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  it('converts lists', () => {
    const md = htmlToMarkdown('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(md).toContain('- Item 1');
    expect(md).toContain('- Item 2');
  });

  it('converts blockquotes', () => {
    expect(htmlToMarkdown('<blockquote><p>A quote</p></blockquote>'))
      .toContain('> A quote');
  });

  it('converts horizontal rules', () => {
    expect(htmlToMarkdown('<hr/>')).toContain('---');
  });

  it('strips all block comments', () => {
    const md = htmlToMarkdown('<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->');
    expect(md).not.toContain('wp:paragraph');
    expect(md).toContain('Hello');
  });

  it('strips shortcodes', () => {
    const md = htmlToMarkdown('<p>Before</p>[gallery ids="1,2"]<p>After</p>');
    expect(md).not.toContain('[gallery');
    expect(md).toContain('Before');
    expect(md).toContain('After');
  });

  it('strips wp-block-* classes', () => {
    const md = htmlToMarkdown('<h2 class="wp-block-heading">Title</h2>');
    expect(md).not.toContain('wp-block');
    expect(md).toContain('## Title');
  });

  it('decodes HTML entities in output', () => {
    const md = htmlToMarkdown('<p>It&#8217;s great &amp; wonderful</p>');
    expect(md).toContain('’s great & wonderful');
  });

  it('handles figure elements with captions', () => {
    const md = htmlToMarkdown(
      '<figure><img src="photo.jpg" alt="test"/><figcaption>Caption text</figcaption></figure>'
    );
    expect(md).toContain('![test](photo.jpg)');
    expect(md).toContain('*Caption text*');
  });

  it('removes script and style elements', () => {
    const md = htmlToMarkdown('<script>alert("x")</script><style>.x{}</style><p>Keep</p>');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('.x{}');
    expect(md).toContain('Keep');
  });

  it('collapses excessive newlines', () => {
    const md = htmlToMarkdown('<p>A</p>\n\n\n\n<p>B</p>');
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('handles empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown(null)).toBe('');
  });
});

describe('cleanContent', () => {
  const html = fixture('wp-post-content.html');

  it('returns both markdown and images', () => {
    const result = cleanContent(html);
    expect(result).toHaveProperty('markdown');
    expect(result).toHaveProperty('images');
  });

  it('extracts images from the content', () => {
    const { images } = cleanContent(html);
    expect(images).toHaveLength(1);
    expect(images[0].src).toContain('sourdough-starter.jpg');
    expect(images[0].alt).toBe('A bubbling sourdough starter in a glass jar');
  });

  it('produces clean markdown without block comments', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).not.toContain('<!-- wp:');
    expect(markdown).not.toContain('wp:paragraph');
  });

  it('produces markdown without shortcodes', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).not.toContain('[gallery');
  });

  it('preserves heading structure', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).toContain('## Getting Started with Your Starter');
    expect(markdown).toContain('## The Basic Recipe');
    expect(markdown).toContain('### Pro Tips');
  });

  it('preserves inline formatting', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).toContain('**wild yeast**');
    expect(markdown).toContain('*beneficial bacteria*');
    expect(markdown).toContain('`Dutch oven`');
  });

  it('preserves links', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).toContain('[our baking classes](https://greenvalleybakery.com/classes)');
  });

  it('preserves list items', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).toContain('- 500g bread flour');
    expect(markdown).toContain('- 10g salt');
  });

  it('converts blockquotes', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).toContain('> The secret to great bread is time and patience.');
  });

  it('decodes HTML entities throughout', () => {
    const { markdown } = cleanContent(html);
    expect(markdown).not.toContain('&#8217;');
    expect(markdown).not.toContain('&#8220;');
    expect(markdown).toContain('— Maria');
  });
});

// ---------------------------------------------------------------------------
// Integration: full WXR parse + content cleaning pipeline
// ---------------------------------------------------------------------------

describe('integration: WXR parse + content clean', () => {
  const xml = fixture('wxr-export.xml');
  const result = parseWxr(xml);

  it('cleans each post content into markdown', () => {
    for (const post of result.posts) {
      const { markdown } = cleanContent(post.content);
      expect(markdown).not.toContain('<!-- wp:');
    }
  });

  it('produces a complete "what didn\'t import" report', () => {
    const report = [];
    if (result.customTypes.length > 0) {
      report.push(`Custom post types not imported: ${result.customTypes.join(', ')}`);
    }
    for (const s of result.skipped) {
      const reason = s.reason === 'draft' ? ' (draft)' : ` (custom type: ${s.postType})`;
      report.push(`  - ${s.title}${reason}`);
    }
    expect(report.length).toBeGreaterThan(0);
    expect(report[0]).toContain('portfolio');
    expect(report.some((r) => r.includes('draft'))).toBe(true);
  });

  it('maps posts with categories and tags to Anglesite format', () => {
    const sourdough = result.posts.find((p) => p.slug === 'sourdough-beginners-guide');
    const angleTags = [...sourdough.categories, ...sourdough.tags];
    expect(angleTags).toContain('Recipes');
    expect(angleTags).toContain('Sourdough');
    expect(angleTags).toContain('Beginner');
  });

  it('generates redirect map for all imported content', () => {
    const postRedirects = generateRedirects(result.posts);
    const pageRedirects = generateRedirects(result.pages);
    const allRedirects = [...postRedirects, ...pageRedirects];
    expect(allRedirects.length).toBeGreaterThan(0);
    expect(allRedirects.every((r) => r.endsWith('301'))).toBe(true);
  });
});
