// PROTOTYPE — network-layer Wix blog extraction via the Safari MCP backend.
// Not wired into the import skill (needs an ADR first; see
// docs/superpowers/specs/2026-07-03-wix-network-extraction-findings.md).
//
// Wix delivers blog-post content as structured JSON via (at least) two
// generations, both carrying the same Ricos rich-content format:
//
//   1. Adapter API (current standard blog OOI): a runtime XHR to
//      _api/blog-frontend-adapter-public/v2/post-page/<slug> whose body has
//      postPage.post.richContent plus resolved categories, owner name, and
//      original-resolution cover media.
//   2. SSR warmup (wix.com-style Studio blogs): the main document embeds a
//      <script id="wix-warmup-data" type="application/json"> tag whose
//      appsWarmupData entry carries ctx.post with the same richContent.
//
// Capturing these via list_network_requests/get_network_request recovers
// structure the DOM TreeWalker cannot see (tables, collapsibles,
// original-resolution image IDs, video URLs, semantic bold/links). The main
// document additionally provides schema.org JSON-LD (author name for the
// warmup generation) and OpenGraph metas.
//
// Intended to become `safari-driver.mjs --network` once that driver lands.
//
// CLI: node wix-network.mjs <url…>          NDJSON, one {url, post} per line
//      node wix-network.mjs --from-file <path> <url>   parse a saved main-document
//      node wix-network.mjs --raw <url>     dump the raw warmup post JSON

import { readFileSync } from 'node:fs';
import { SafariMcp, SafariMcpError, locateSafaridriver } from './safari-mcp.mjs';

const WIX_MEDIA_BASE = 'https://static.wixstatic.com/media/';

/**
 * Pull the structured layers out of a Wix Thunderbolt main-document response:
 * the warmup-data JSON, schema.org JSON-LD blocks, and OpenGraph metas.
 */
export function parseWixDocument(html) {
  const result = { warmupData: null, jsonLd: [], og: {} };

  const warmup = html.match(
    /<script type="application\/json" id="wix-warmup-data">(.*?)<\/script>/s,
  );
  if (warmup) {
    try { result.warmupData = JSON.parse(warmup[1]); } catch { /* leave null */ }
  }

  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try { result.jsonLd.push(JSON.parse(m[1])); } catch { /* skip malformed block */ }
  }

  for (const m of html.matchAll(/<meta[^>]+property="og:([^"]+)"[^>]+content="([^"]*)"/g)) {
    result.og[m[1]] = m[2];
  }

  return result;
}

/**
 * Locate the blog post object inside warmup data. The blog app's key in
 * appsWarmupData is a per-app GUID, so search values instead of hardcoding it.
 * Returns null when the page is not a blog post (static pages keep their
 * content in siteassets page JSON, not warmup data — use the DOM path there).
 */
export function findBlogPost(warmupData) {
  const apps = warmupData?.appsWarmupData;
  if (!apps) return null;
  for (const app of Object.values(apps)) {
    const post = app?.ctx?.post;
    if (post?.richContent?.nodes) return post;
  }
  return null;
}

/** Original-resolution URL for a Wix media ID (no crop/quality params). */
export function wixMediaUrl(id) {
  return WIX_MEDIA_BASE + id;
}

function textToMarkdown(node) {
  const raw = node.textData?.text ?? '';
  // Emphasis markers must hug non-whitespace in GFM, so keep the run's
  // leading/trailing whitespace outside the markers; whitespace-only runs
  // pass through undecorated.
  const [, lead, text, trail] = raw.match(/^(\s*)(.*?)(\s*)$/s) ?? [, '', raw, ''];
  if (!text) return raw;
  const decorations = node.textData?.decorations ?? [];
  const has = (type) => decorations.some((d) => d.type === type);
  let out = text;
  // Escape nothing: Wix prose rarely contains markdown metachars, and escaping
  // would corrupt the common cases (URLs, apostrophes) worse than it helps.
  if (has('BOLD') && decorations.find((d) => d.type === 'BOLD')?.fontWeightValue >= 700) {
    out = `**${out}**`;
  }
  if (has('ITALIC')) out = `*${out}*`;
  const link = decorations.find((d) => d.type === 'LINK')?.linkData?.link?.url;
  if (link) out = `[${out}](${link})`;
  return lead + out + trail;
}

function inlineText(node) {
  return (node.nodes ?? []).map(textToMarkdown).join('');
}

/** Plain text of a node subtree (for table cells and collapsible titles). */
function plainText(node) {
  if (node.type === 'TEXT') return node.textData?.text ?? '';
  return (node.nodes ?? []).map(plainText).join('');
}

/**
 * Convert a Ricos rich-content tree to Markdown. Collects image references
 * (original media URL + alt + dimensions) into `images` as it goes.
 */
export function ricosToMarkdown(richContent) {
  const images = [];
  const blocks = [];

  const renderNodes = (nodes, listStack = []) => {
    for (const node of nodes) renderNode(node, listStack);
  };

  const renderNode = (node, listStack) => {
    switch (node.type) {
      case 'PARAGRAPH': {
        const text = inlineText(node).trim();
        if (text) blocks.push(text);
        break;
      }
      case 'HEADING': {
        const level = node.headingData?.level ?? 2;
        blocks.push(`${'#'.repeat(level)} ${inlineText(node).trim()}`);
        break;
      }
      case 'IMAGE': {
        const data = node.imageData ?? {};
        const id = data.image?.src?.id;
        if (id) {
          const src = wixMediaUrl(id);
          const alt = data.altText ?? '';
          images.push({
            src,
            alt,
            width: data.image?.width,
            height: data.image?.height,
          });
          blocks.push(`![${alt}](${src})`);
        }
        break;
      }
      case 'ORDERED_LIST':
      case 'BULLETED_LIST': {
        const ordered = node.type === 'ORDERED_LIST';
        const indent = '  '.repeat(listStack.length);
        const lines = [];
        (node.nodes ?? []).forEach((item, i) => {
          const marker = ordered ? `${i + 1}.` : '-';
          // A list item's paragraphs collapse onto one line; nested lists
          // recurse through the shared block collector.
          const itemText = (item.nodes ?? [])
            .filter((n) => n.type === 'PARAGRAPH')
            .map(inlineText)
            .join(' ')
            .trim();
          lines.push(`${indent}${marker} ${itemText}`);
          const nested = (item.nodes ?? []).filter((n) => /_LIST$/.test(n.type ?? ''));
          for (const sub of nested) {
            const saved = blocks.length;
            renderNode(sub, [...listStack, node.type]);
            lines.push(...blocks.splice(saved));
          }
        });
        blocks.push(lines.join('\n'));
        break;
      }
      case 'BLOCKQUOTE': {
        const inner = (node.nodes ?? []).map(inlineText).join(' ').trim();
        if (inner) blocks.push(`> ${inner}`);
        break;
      }
      case 'TABLE': {
        const rows = (node.nodes ?? []).filter((n) => n.type === 'TABLE_ROW');
        const toCells = (row) =>
          (row.nodes ?? [])
            .filter((n) => n.type === 'TABLE_CELL')
            .map((cell) => plainText(cell).trim().replace(/\|/g, '\\|'));
        if (rows.length) {
          const header = toCells(rows[0]);
          const lines = [
            `| ${header.join(' | ')} |`,
            `| ${header.map(() => '---').join(' | ')} |`,
            ...rows.slice(1).map((r) => `| ${toCells(r).join(' | ')} |`),
          ];
          blocks.push(lines.join('\n'));
        }
        break;
      }
      case 'COLLAPSIBLE_LIST':
        renderNodes(node.nodes ?? [], listStack);
        break;
      case 'COLLAPSIBLE_ITEM': {
        const title = node.nodes?.find((n) => n.type === 'COLLAPSIBLE_ITEM_TITLE');
        const body = node.nodes?.find((n) => n.type === 'COLLAPSIBLE_ITEM_BODY');
        if (title) blocks.push(`### ${plainText(title).trim()}`);
        if (body) renderNodes(body.nodes ?? [], listStack);
        break;
      }
      case 'VIDEO': {
        const url = node.videoData?.video?.src?.url;
        if (url) blocks.push(url);
        break;
      }
      case 'BUTTON': {
        const { text, link } = node.buttonData ?? {};
        if (text && link?.url) blocks.push(`[${text}](${link.url})`);
        break;
      }
      case 'DIVIDER':
        blocks.push('---');
        break;
      default:
        // Unknown container nodes: descend so nothing silently disappears.
        if (node.nodes?.length) renderNodes(node.nodes, listStack);
    }
  };

  renderNodes(richContent?.nodes ?? []);
  return { markdown: blocks.join('\n\n'), images };
}

/**
 * Assemble the import-facing post object from a blog-frontend-adapter-public
 * post-page response body — the current-generation source, with categories,
 * owner name, and cover media resolved inline.
 */
export function buildPostFromAdapter(adapterBody, url) {
  const page = adapterBody?.postPage;
  const post = page?.post;
  if (!post?.richContent?.nodes) return null;

  const { markdown, images } = ricosToMarkdown(post.richContent);
  const cover = post.media?.wixMedia?.image;
  return {
    url,
    title: post.title ?? '',
    slug: post.slug ?? '',
    excerpt: post.customExcerpt ?? post.excerpt ?? '',
    author: post.owner?.name ?? null,
    publishedDate: post.firstPublishedDate ?? null,
    lastPublishedDate: post.lastPublishedDate ?? null,
    coverImage: cover?.url ?? (cover?.id ? wixMediaUrl(cover.id) : null),
    timeToRead: post.minutesToRead ?? null,
    categories: (page.categories ?? []).map((c) => c.label).filter(Boolean),
    tags: (page.tags ?? []).map((t) => t.label ?? t).filter(Boolean),
    markdown,
    images,
  };
}

/**
 * Assemble the import-facing post object from the parsed document layers.
 * Author name and article dates come from the BlogPosting JSON-LD (warmup data
 * only has the author GUID); everything else from the warmup post.
 */
export function buildPost(parsed, url) {
  const post = findBlogPost(parsed.warmupData);
  if (!post) return null;

  const article = parsed.jsonLd.find((d) =>
    ['BlogPosting', 'Article', 'NewsArticle'].includes(d?.['@type']),
  );
  const { markdown, images } = ricosToMarkdown(post.richContent);

  const coverImageId = post.coverImage?.match(/^wix:image:\/\/v1\/([^/]+)\//)?.[1];
  return {
    url,
    title: post.title ?? article?.headline ?? parsed.og.title ?? '',
    slug: post.slug ?? '',
    excerpt: post.excerpt ?? parsed.og.description ?? '',
    author: article?.author?.name ?? null,
    publishedDate: post.publishedDate ?? article?.datePublished ?? null,
    lastPublishedDate: post.lastPublishedDate ?? article?.dateModified ?? null,
    coverImage: coverImageId ? wixMediaUrl(coverImageId) : parsed.og.image ?? null,
    timeToRead: post.timeToRead ?? null,
    // Warmup data only carries category/tag GUIDs; keep the shape aligned
    // with buildPostFromAdapter and let the skill fall back to keywords in
    // the BlogPosting JSON-LD when it needs names.
    categories: [],
    tags: [],
    markdown,
    images,
  };
}

const ADAPTER_PATH = 'blog-frontend-adapter-public/v2/post-page/';

async function requestBody(mcp, requestId) {
  const detail = JSON.parse(
    await mcp.call('get_network_request', { request_id: requestId }, 60000),
  );
  return detail.request?.response_body ?? '';
}

/**
 * Capture a page's network traffic over a running Safari MCP session and
 * extract the blog post from it: the adapter-API XHR when present (current
 * blog generation), else the warmup data embedded in the main document.
 * Returns null for non-blog pages — callers should fall back to the DOM path.
 */
export async function extractPostViaNetwork(mcp, url, { settleMs = 5000 } = {}) {
  await mcp.call('list_network_requests', { clear: true }, 15000);
  await mcp.call('navigate_to_url', { url }, 60000);
  // navigate_to_url resolves on navigation; give post-load XHRs time to land.
  await new Promise((r) => setTimeout(r, settleMs));

  const adapterList = JSON.parse(
    await mcp.call('list_network_requests', { filter: { url_substring: ADAPTER_PATH } }, 30000),
  );
  const adapterReq = adapterList.requests.find(
    (r) => r.method === 'GET' && !r.url.includes('post-page-metadata'),
  );
  if (adapterReq) {
    try {
      const post = buildPostFromAdapter(JSON.parse(await requestBody(mcp, adapterReq.request_id)), url);
      if (post) return post;
    } catch { /* fall through to the warmup path */ }
  }

  const { host, pathname } = new URL(url);
  const listed = JSON.parse(
    await mcp.call('list_network_requests', { filter: { url_substring: host } }, 30000),
  );
  const docReq = listed.requests.find((r) => {
    if (r.method !== 'GET') return false;
    try {
      const u = new URL(r.url);
      return u.host === host && u.pathname === pathname;
    } catch {
      return false;
    }
  });
  if (!docReq) throw new SafariMcpError('page-failure', `main document not captured for ${url}`);

  return buildPost(parseWixDocument(await requestBody(mcp, docReq.request_id)), url);
}

// --- CLI ---------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);

  if (args[0] === '--from-file') {
    // Offline mode: parse a previously captured main-document body.
    const [, path, url] = args;
    const raw = readFileSync(path, 'utf8');
    let html = raw;
    try {
      const detail = JSON.parse(raw);
      html = detail.request?.response_body ?? raw;
    } catch { /* treat as plain HTML */ }
    const post = buildPost(parseWixDocument(html), url ?? 'file://' + path);
    console.log(JSON.stringify(post, null, 2));
    process.exit(post ? 0 : 1);
  }

  const raw = args[0] === '--raw';
  const urls = args.filter((a) => !a.startsWith('--'));
  if (!urls.length) {
    console.error('usage: node wix-network.mjs [--raw] <url…>');
    process.exit(1);
  }

  const binary = locateSafaridriver();
  if (!binary) {
    console.error('no safaridriver with --mcp support found');
    process.exit(2);
  }

  const mcp = new SafariMcp(binary);
  await mcp.start();
  // Arming requires an active browsing context; recording covers later navigations.
  await mcp.call('navigate_to_url', { url: 'about:blank' }, 30000);
  let failures = 0;
  try {
    for (const url of urls) {
      try {
        if (raw) {
          await mcp.call('list_network_requests', { clear: true }, 15000);
          await mcp.call('navigate_to_url', { url }, 60000);
          const listed = JSON.parse(
            await mcp.call('list_network_requests', { filter: { url_substring: new URL(url).host } }, 30000),
          );
          const docReq = listed.requests.find((r) => r.method === 'GET' && r.url.split('?')[0] === url.split('?')[0]);
          const detail = JSON.parse(await mcp.call('get_network_request', { request_id: docReq.request_id }, 60000));
          const parsed = parseWixDocument(detail.request?.response_body ?? '');
          console.log(JSON.stringify(findBlogPost(parsed.warmupData)));
        } else {
          const post = await extractPostViaNetwork(mcp, url);
          console.log(JSON.stringify({ url, post }));
        }
      } catch (err) {
        failures++;
        console.log(JSON.stringify({ url, error: err.message }));
      }
    }
  } finally {
    mcp.close();
  }
  process.exit(failures ? 1 : 0);
}
