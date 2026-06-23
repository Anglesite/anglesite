/**
 * Layout heuristics for classifying Canva sections into semantic types.
 *
 * Canva uses absolute positioning — no semantic HTML. This module classifies
 * sections by spatial patterns and content so we can generate semantic Astro pages.
 */

/**
 * Cluster elements by x-position within 50px tolerance.
 * Returns the number of clusters if they are evenly spaced (gaps within 20% of
 * the average gap), or 0 if not evenly spaced / fewer than 2 clusters.
 *
 * @param {Array<{bounds: {x: number}}>} elements
 * @returns {number} number of evenly-spaced clusters, or 0
 */
function detectEvenlySpacedGroups(elements) {
  if (elements.length === 0) return 0;

  // Sort elements by x position
  const sorted = [...elements].sort((a, b) => a.bounds.x - b.bounds.x);

  // Cluster by x within 50px tolerance
  const clusters = [];
  for (const el of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    if (lastCluster && el.bounds.x - lastCluster[lastCluster.length - 1].bounds.x <= 50) {
      lastCluster.push(el);
    } else {
      clusters.push([el]);
    }
  }

  if (clusters.length < 2) return 0;

  // Compute cluster representative x (first element's x)
  const clusterXs = clusters.map((c) => c[0].bounds.x);

  // Compute gaps between cluster representatives
  const gaps = [];
  for (let i = 1; i < clusterXs.length; i++) {
    gaps.push(clusterXs[i] - clusterXs[i - 1]);
  }

  if (gaps.length === 0) return 0;

  // Check if gaps are within 20% of average gap
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avgGap === 0) return clusters.length;
  const evenly = gaps.every((g) => Math.abs(g - avgGap) / avgGap <= 0.2);

  return evenly ? clusters.length : 0;
}

/**
 * Classify a section into a semantic type.
 *
 * Classification order:
 * 1. gallery      — 3+ images
 * 2. hero         — index === 0 AND text with fontSize >= 32
 * 3. footer       — ALL text fontSize <= 14 AND footer keywords present
 * 4. testimonial  — quote-mark text + dash-attribution text
 * 5. feature-grid — 4+ text elements AND 2–4 evenly-spaced x clusters
 * 6. cta          — button elements AND <= 3 text elements
 * 7. content      — exactly 1 text with fontSize <= 18 and length > 100
 * 8. generic      — anything else
 *
 * @param {{index: number, bounds: object, elements: Array}} section
 * @returns {string}
 */
export function classifySection(section) {
  const { index, elements } = section;

  const images = elements.filter((el) => el.type === "image");
  const texts = elements.filter((el) => el.type === "text");
  const buttons = elements.filter((el) => el.type === "button");

  // 1. Gallery: 3+ images
  if (images.length >= 3) {
    return "gallery";
  }

  // 2. Hero: first section with text fontSize >= 32
  if (index === 0) {
    const hasLargeText = texts.some(
      (el) => el.style && el.style.fontSize >= 32
    );
    if (hasLargeText) {
      return "hero";
    }
  }

  // 3. Footer: ALL text <= 14px AND footer keywords
  if (texts.length > 0) {
    const allSmall = texts.every((el) => el.style && el.style.fontSize <= 14);
    if (allSmall) {
      const footerKeywords = /rights reserved|privacy|terms|copyright|©/i;
      const hasKeyword = texts.some((el) => footerKeywords.test(el.content));
      if (hasKeyword) {
        return "footer";
      }
    }
  }

  // 4. Testimonial: quote-mark text AND dash-attribution text
  const QUOTE_START = /^[""\u201c\u201d]/;
  const DASH_START = /^[-\u2014\u2013]/;
  const hasQuote = texts.some((el) => QUOTE_START.test(el.content));
  const hasDash = texts.some((el) => DASH_START.test(el.content));
  if (hasQuote && hasDash) {
    return "testimonial";
  }

  // 5. Feature-grid: 4+ text elements AND 2–4 evenly-spaced x clusters
  if (texts.length >= 4) {
    const clusterCount = detectEvenlySpacedGroups(texts);
    if (clusterCount >= 2 && clusterCount <= 4) {
      return "feature-grid";
    }
  }

  // 6. CTA: has button AND <= 3 text elements
  if (buttons.length > 0 && texts.length <= 3) {
    return "cta";
  }

  // 7. Content: exactly 1 text with fontSize <= 18 and length > 100
  if (
    texts.length === 1 &&
    texts[0].style &&
    texts[0].style.fontSize <= 18 &&
    texts[0].content.length > 100
  ) {
    return "content";
  }

  // 8. Generic
  return "generic";
}

/**
 * Classify an array of sections.
 *
 * @param {Array} sections
 * @returns {Array<{type: string, section: object}>}
 */
export function classifyAllSections(sections) {
  return sections.map((section) => ({
    type: classifySection(section),
    section,
  }));
}
