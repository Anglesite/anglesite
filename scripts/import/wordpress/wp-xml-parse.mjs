#!/usr/bin/env node

// WordPress WXR (WordPress eXtended RSS) XML parser.
//
// Parses a WXR export file and extracts posts, pages, media attachments,
// categories, tags, navigation menus, and authors into structured JSON.
//
// Usage (CLI):
//   node wp-xml-parse.mjs <wxr-file.xml>              # Parse everything
//   node wp-xml-parse.mjs <wxr-file.xml> --posts       # Posts only
//   node wp-xml-parse.mjs <wxr-file.xml> --pages       # Pages only
//   node wp-xml-parse.mjs <wxr-file.xml> --media       # Media attachments only
//   node wp-xml-parse.mjs <wxr-file.xml> --taxonomies  # Categories + tags only
//
// All commands output JSON to stdout.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// XML helpers — lightweight tag extraction without a full DOM parser.
// WXR files are well-formed RSS 2.0 with WordPress namespaces, so regex
// extraction on the known tag set is reliable and avoids a dependency.
// ---------------------------------------------------------------------------

function getTagContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function getCdataContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function getAllItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1]);
  }
  return items;
}

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
  '&apos;': "'", '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“',
  '&#8221;': '”', '&#8211;': '–', '&#8212;': '—',
  '&#8230;': '…', '&nbsp;': ' ', '&#160;': ' ',
};

export function decodeEntities(text) {
  if (!text) return '';
  let result = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replaceAll(entity, char);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parse categories and tags from <wp:category> and <wp:tag> channel elements
// ---------------------------------------------------------------------------

export function parseTaxonomies(xml) {
  const categories = [];
  const tags = [];

  const catRe = /<wp:category>([\s\S]*?)<\/wp:category>/gi;
  let m;
  while ((m = catRe.exec(xml)) !== null) {
    const block = m[1];
    const slug = getTagContent(block, 'wp:category_nicename');
    const name = getCdataContent(block, 'wp:cat_name') || slug;
    const parent = getTagContent(block, 'wp:category_parent') || null;
    categories.push({ slug, name: decodeEntities(name), parent });
  }

  const tagRe = /<wp:tag>([\s\S]*?)<\/wp:tag>/gi;
  while ((m = tagRe.exec(xml)) !== null) {
    const block = m[1];
    const slug = getTagContent(block, 'wp:tag_slug');
    const name = getCdataContent(block, 'wp:tag_name') || slug;
    tags.push({ slug, name: decodeEntities(name) });
  }

  return { categories, tags };
}

// ---------------------------------------------------------------------------
// Parse authors from <wp:author> channel elements
// ---------------------------------------------------------------------------

export function parseAuthors(xml) {
  const authors = [];
  const re = /<wp:author>([\s\S]*?)<\/wp:author>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    authors.push({
      login: getCdataContent(block, 'wp:author_login') || getTagContent(block, 'wp:author_login'),
      email: getCdataContent(block, 'wp:author_email') || getTagContent(block, 'wp:author_email'),
      displayName: getCdataContent(block, 'wp:author_display_name') || getTagContent(block, 'wp:author_display_name'),
    });
  }
  return authors;
}

// ---------------------------------------------------------------------------
// Parse a single <item> into a structured object
// ---------------------------------------------------------------------------

export function parseItem(itemXml) {
  const postType = getTagContent(itemXml, 'wp:post_type') || 'post';
  const status = getTagContent(itemXml, 'wp:status') || 'publish';
  const title = decodeEntities(getTagContent(itemXml, 'title'));
  const link = getTagContent(itemXml, 'link');
  const slug = getTagContent(itemXml, 'wp:post_name');
  const content = getCdataContent(itemXml, 'content:encoded');
  const excerpt = getCdataContent(itemXml, 'excerpt:encoded');
  const dateRaw = getTagContent(itemXml, 'wp:post_date');
  const publishDate = dateRaw ? dateRaw.slice(0, 10) : '';
  const postId = getTagContent(itemXml, 'wp:post_id');

  const categories = [];
  const tags = [];
  const catRe = /<category\s+domain="([^"]+)"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/category>/gi;
  let m;
  while ((m = catRe.exec(itemXml)) !== null) {
    const domain = m[1];
    const name = m[2].trim();
    if (domain === 'category') categories.push(name);
    else if (domain === 'post_tag') tags.push(name);
  }

  const attachmentUrl = getTagContent(itemXml, 'wp:attachment_url');

  const metaEntries = [];
  const metaRe = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/gi;
  while ((m = metaRe.exec(itemXml)) !== null) {
    const key = getTagContent(m[1], 'wp:meta_key') || getCdataContent(m[1], 'wp:meta_key');
    const value = getTagContent(m[1], 'wp:meta_value') || getCdataContent(m[1], 'wp:meta_value');
    if (key) metaEntries.push({ key, value });
  }
  const featuredImageId = metaEntries.find((e) => e.key === '_thumbnail_id')?.value || '';

  return {
    postType,
    status,
    postId,
    title,
    link,
    slug,
    content,
    excerpt: excerpt.replace(/<[^>]*>/g, '').trim(),
    publishDate,
    categories,
    tags,
    attachmentUrl,
    featuredImageId,
    meta: metaEntries,
  };
}

// ---------------------------------------------------------------------------
// Full WXR parse — returns posts, pages, media, taxonomies, authors, nav
// ---------------------------------------------------------------------------

export function parseWxr(xml) {
  const items = getAllItems(xml);
  const parsed = items.map(parseItem);

  const posts = parsed.filter((i) => i.postType === 'post' && i.status === 'publish');
  const pages = parsed.filter((i) => i.postType === 'page' && i.status === 'publish');
  const attachments = parsed.filter((i) => i.postType === 'attachment');
  const navItems = parsed.filter((i) => i.postType === 'nav_menu_item');
  const drafts = parsed.filter((i) => i.status === 'draft');

  const mediaMap = new Map();
  for (const att of attachments) {
    if (att.postId && att.attachmentUrl) {
      mediaMap.set(att.postId, {
        id: att.postId,
        url: att.attachmentUrl,
        title: att.title,
        slug: att.slug,
      });
    }
  }

  for (const item of [...posts, ...pages]) {
    if (item.featuredImageId && mediaMap.has(item.featuredImageId)) {
      item.featuredImage = mediaMap.get(item.featuredImageId).url;
    }
  }

  const taxonomies = parseTaxonomies(xml);
  const authors = parseAuthors(xml);

  const navigation = navItems
    .map((n) => {
      const urlMeta = n.meta.find((m) => m.key === '_menu_item_url');
      const objectIdMeta = n.meta.find((m) => m.key === '_menu_item_object_id');
      const typeMeta = n.meta.find((m) => m.key === '_menu_item_type');
      return {
        title: n.title,
        url: urlMeta?.value || '',
        objectId: objectIdMeta?.value || '',
        type: typeMeta?.value || '',
        order: n.meta.find((m) => m.key === '_menu_item_menu_item_parent')?.value || '0',
      };
    })
    .filter((n) => n.title || n.url);

  const skipped = [];
  const customTypes = new Set();
  for (const item of parsed) {
    if (!['post', 'page', 'attachment', 'nav_menu_item'].includes(item.postType)) {
      customTypes.add(item.postType);
      skipped.push({ postType: item.postType, title: item.title, slug: item.slug });
    }
  }
  if (drafts.length > 0) {
    for (const d of drafts) {
      skipped.push({ postType: d.postType, title: d.title, slug: d.slug, reason: 'draft' });
    }
  }

  return {
    posts,
    pages,
    media: [...mediaMap.values()],
    taxonomies,
    authors,
    navigation,
    skipped,
    customTypes: [...customTypes],
    stats: {
      posts: posts.length,
      pages: pages.length,
      media: mediaMap.size,
      navigation: navigation.length,
      drafts: drafts.length,
      customTypeItems: skipped.filter((s) => !s.reason).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Redirect generation from WordPress URLs to Anglesite paths
// ---------------------------------------------------------------------------

export function generateRedirects(items, pathPrefix = '/blog') {
  const redirects = [];
  for (const item of items) {
    if (!item.link) continue;
    try {
      const url = new URL(item.link);
      const oldPath = url.pathname.replace(/\/$/, '') || '/';
      const newPath = item.postType === 'page'
        ? `/${item.slug}`
        : `${pathPrefix}/${item.slug}`;
      if (oldPath !== newPath) {
        redirects.push(`${oldPath} ${newPath} 301`);
      }
    } catch {
      // malformed URL, skip
    }
  }
  return redirects;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);
const cliFile = cliArgs.find((a) => !a.startsWith('--'));

if (cliFile) {
  const xml = readFileSync(cliFile, 'utf-8');
  const flag = cliArgs.find((a) => a.startsWith('--'));

  let output;
  const result = parseWxr(xml);

  switch (flag) {
    case '--posts':
      output = result.posts;
      break;
    case '--pages':
      output = result.pages;
      break;
    case '--media':
      output = result.media;
      break;
    case '--taxonomies':
      output = result.taxonomies;
      break;
    default:
      output = result;
  }

  console.log(JSON.stringify(output, null, 2));
}
