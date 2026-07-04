// Browser-context extraction functions shared by every rendered-page backend
// (Playwright driver at scripts/import/wix/wix-playwright.mjs, Safari MCP
// driver at scripts/import/browser/safari-driver.mjs). These functions are
// serialized with String(fn) and executed INSIDE the page — they must not
// close over module scope or use Node APIs.

/** Extract computed styles from visible elements on the page. */
export const extractStylesSrc = function () {
  const samples = {
    bg: [],
    text: [],
    heading: [],
  };
  const fonts = {
    heading: [],
    body: [],
  };

  // Sample background colors. Wix nests backgrounds in deep containers,
  // so check explicit candidates AND walk ancestors of the content area.
  const isOpaque = (bg) => bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';

  const bgCandidates = [
    document.body,
    document.querySelector('#SITE_CONTAINER'),
    document.querySelector('#PAGES_CONTAINER'),
    document.querySelector('[data-hook="post-page"]'),
    document.querySelector('#siteWrapper'), // Squarespace 7.x
    document.querySelector('#page'), // Squarespace 7.1 main content
    document.querySelector('.content-wrapper'), // Squarespace 7.0 templates
    document.querySelector('main'),
  ].filter(Boolean);

  // Also sample all section-level wrappers (Wix uses deeply nested divs
  // with background colors for page sections)
  for (const el of document.querySelectorAll('section, [data-mesh-id], [data-testid]')) {
    if (el.offsetHeight > 100) bgCandidates.push(el);
  }

  // Walk ancestors of the first content area to find the nearest opaque bg
  const contentRoot = document.querySelector('[data-hook="post-description"]')
    || document.querySelector('#PAGES_CONTAINER')
    || document.querySelector('main');
  if (contentRoot) {
    let ancestor = contentRoot.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      bgCandidates.push(ancestor);
      ancestor = ancestor.parentElement;
    }
  }

  for (const el of bgCandidates) {
    const style = getComputedStyle(el);
    if (isOpaque(style.backgroundColor)) {
      samples.bg.push(style.backgroundColor);
    }
  }

  // Sample text colors and fonts from paragraphs and spans
  const textEls = document.querySelectorAll('p, span, li, td, a, div');
  const seen = new Set();
  for (const el of textEls) {
    // Skip invisible elements
    if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;
    // Skip elements with no direct text content
    const text = el.textContent?.trim();
    if (!text || text.length < 3) continue;
    // Deduplicate by element
    if (seen.has(el)) continue;
    seen.add(el);

    const style = getComputedStyle(el);
    const color = style.color;
    if (color) samples.text.push(color);

    const fontFamily = style.fontFamily?.split(',')[0]?.trim().replace(/['"]/g, '');
    if (fontFamily) fonts.body.push(fontFamily);
  }

  // Sample heading styles
  const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
  for (const el of headingEls) {
    if (el.offsetHeight === 0) continue;
    const style = getComputedStyle(el);
    if (style.color) samples.heading.push(style.color);
    const fontFamily = style.fontFamily?.split(',')[0]?.trim().replace(/['"]/g, '');
    if (fontFamily) fonts.heading.push(fontFamily);
  }

  return { samples, fonts };
};

/**
 * Extract text content from the rendered page via TreeWalker.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fullPage] - When true, also extract header images
 *   (logos, badges) and footer content. Use for homepage/branding extraction.
 *   Default body-only mode is correct for blog post extraction.
 */
export const extractContentSrc = function (options) {
  const result = { body: '', images: [], title: '', navLinks: [], tags: [] };

  // Try blog post region first
  const postDesc = document.querySelector('[data-hook="post-description"]');
  const postFooter = document.querySelector('[data-hook="post-footer"]');

  let container;
  if (postDesc) {
    container = postDesc;
  } else {
    // Static page: use PAGES_CONTAINER or main
    container = document.querySelector('#PAGES_CONTAINER')
      || document.querySelector('main#page') // Squarespace 7.1
      || document.querySelector('.content-wrapper') // Squarespace 7.0
      || document.querySelector('main')
      || document.body;
  }

  // Walk text nodes
  const blocks = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip script/style content
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip post-footer region
      if (postFooter && postFooter.contains(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent.trim();
      if (!text || text === ' ') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let currentBlock = [];
  let lastParent = null;
  let headingEl = null;

  const flushHeading = () => {
    if (!headingEl) return;
    const level = headingEl.tagName?.match(/H(\d)/)?.[1] || '2';
    blocks.push('#'.repeat(Number(level)) + ' ' + currentBlock.join(' '));
    currentBlock = [];
    headingEl = null;
  };

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    if (!text) continue;

    // Detect block boundaries (different parent block element)
    const blockParent = node.parentElement?.closest('div, p, h1, h2, h3, h4, h5, h6, li, blockquote');
    if (blockParent !== lastParent && currentBlock.length > 0) {
      if (headingEl) {
        flushHeading();
      } else {
        blocks.push(currentBlock.join(' '));
        currentBlock = [];
      }
    }
    lastParent = blockParent;

    // Check if this text is inside a hyperlink
    const link = node.parentElement?.closest('a[href]');
    const piece = link ? `[${text}](${link.href})` : text;

    // Check if this is a heading: accumulate into currentBlock (same as
    // paragraphs) and only flush once, when the walker moves past the
    // heading element (handled by the block-boundary check above).
    const heading = node.parentElement?.closest('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading) {
      headingEl = heading;
      currentBlock.push(piece);
      continue;
    }

    currentBlock.push(piece);
  }
  if (currentBlock.length > 0) {
    if (headingEl) {
      flushHeading();
    } else {
      blocks.push(currentBlock.join(' '));
    }
  }

  result.body = blocks.join('\n\n');

  // Extract images from the container
  const imgs = container.querySelectorAll('img');
  for (const img of imgs) {
    if (img.src) {
      result.images.push({
        src: img.src,
        alt: img.alt || '',
      });
    }
  }

  // Extract title
  const titleEl = document.querySelector('[data-hook="post-title"], h1');
  if (titleEl) result.title = titleEl.textContent?.trim() || '';

  // Extract navigation links (complete, including JS-rendered sub-navs)
  const navLinks = document.querySelectorAll('nav a, [role="navigation"] a');
  for (const a of navLinks) {
    const text = a.textContent?.trim();
    const href = a.href;
    if (text && href) {
      result.navLinks.push({ text, href });
    }
  }

  // Extract tags from the post footer
  if (postFooter) {
    // Pattern 1: category/hashtag links
    const tagLinks = postFooter.querySelectorAll(
      'a[href*="categories/"], a[href*="hashtags/"], [data-hook="tag"]',
    );
    for (const el of tagLinks) {
      const text = el.textContent?.trim();
      if (text) result.tags.push(text);
    }
    // Pattern 2: "Tagged: tag1, tag2" plain text
    if (result.tags.length === 0) {
      const footerText = postFooter.textContent || '';
      const taggedMatch = footerText.match(/Tagged:\s*(.+)/i);
      if (taggedMatch) {
        result.tags.push(
          ...taggedMatch[1].split(',').map((t) => t.trim()).filter(Boolean),
        );
      }
    }
  }

  // Full-page mode: extract header images (logo, branding) and footer content.
  // Used by the import skill's homepage/branding pass (Steps 3a/3b) where
  // site chrome is needed, unlike the body-only blog post extraction.
  if (options?.fullPage) {
    const siteHeader = document.querySelector('#SITE_HEADER, [id*="SITE_HEADER"], header');
    const headerImages = [];
    let logo = null;

    if (siteHeader) {
      for (const img of siteHeader.querySelectorAll('img')) {
        if (!img.src) continue;
        const entry = { src: img.src, alt: img.alt || '' };
        headerImages.push(entry);
        // First image in header is typically the logo
        if (!logo) logo = entry;
      }
    }

    const siteFooter = document.querySelector('#SITE_FOOTER, [id*="SITE_FOOTER"], footer');
    const footerImages = [];
    let footerText = '';

    if (siteFooter) {
      footerText = siteFooter.textContent?.trim() || '';
      for (const img of siteFooter.querySelectorAll('img')) {
        if (!img.src) continue;
        footerImages.push({ src: img.src, alt: img.alt || '' });
      }
    }

    result.header = { logo, images: headerImages };
    result.footer = { text: footerText, images: footerImages };
  }

  return result;
};

/**
 * Expand accordion/FAQ items so collapsed content is visible.
 * Returns the number of items expanded; callers should wait ~500 ms for
 * animations when the count is > 0.
 */
export const expandAccordionsSrc = function () {
  let count = 0;
  const triggers = document.querySelectorAll(
    '[aria-expanded="false"]:not([role="menuitem"])',
  );
  for (const el of triggers) {
    el.click();
    count++;
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    details.open = true;
    count++;
  }
  for (const el of document.querySelectorAll('[data-hook="faq-question"]')) {
    if (el.getAttribute('aria-expanded') !== 'true') {
      el.click();
      count++;
    }
  }
  return count;
};
