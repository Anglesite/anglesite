// ---------------------------------------------------------------------------
// Shopify Buy Button helpers — embed parsing and CSP
// ---------------------------------------------------------------------------

/** Parsed data from a Shopify Buy Button embed snippet */
export interface ShopifyEmbedData {
  /** The shop's myshopify.com domain (e.g., "my-store.myshopify.com") */
  domain: string;
  /** Storefront API access token (public, safe to embed in HTML) */
  storefrontAccessToken: string;
  /** Shopify product ID */
  productId: string;
}

/**
 * Parse a Shopify Buy Button embed snippet to extract shop domain,
 * storefront access token, and product ID.
 *
 * Shopify generates embed code in their admin UI that contains these
 * values in JavaScript. This function extracts them via regex.
 *
 * @param embedCode - The full embed code pasted from Shopify admin
 * @returns Parsed data or null if the code is not a valid embed snippet
 */
export function parseShopifyEmbed(embedCode: string): ShopifyEmbedData | null {
  const domainMatch = embedCode.match(/domain:\s*['"]([^'"]+)['"]/);
  const tokenMatch = embedCode.match(
    /storefrontAccessToken:\s*['"]([^'"]+)['"]/,
  );
  const idMatch = embedCode.match(
    /id:\s*['"](\d+)['"]/,
  );

  if (!domainMatch || !tokenMatch || !idMatch) {
    return null;
  }

  return {
    domain: domainMatch[1],
    storefrontAccessToken: tokenMatch[1],
    productId: idMatch[1],
  };
}

// ---------------------------------------------------------------------------
// CSP directives
// ---------------------------------------------------------------------------

/** CSP directives needed for Shopify Buy Button */
export interface ShopifyCSP {
  "script-src": string[];
  "style-src": string[];
  "img-src": string[];
  "connect-src": string[];
  "frame-src": string[];
}

/**
 * Build CSP directives required for the Shopify Buy Button SDK.
 *
 * The Buy Button SDK loads from sdks.shopifycdn.com, fetches product
 * data from the store's myshopify.com domain via the Storefront API,
 * loads images from cdn.shopify.com, and sends analytics to
 * monorail-edge.shopifysvc.com.
 *
 * @returns Object with arrays of domains to add to each CSP directive
 */
export function buildShopifyCSP(): ShopifyCSP {
  return {
    "script-src": ["cdn.shopify.com", "sdks.shopifycdn.com"],
    "style-src": ["cdn.shopify.com"],
    "img-src": ["cdn.shopify.com"],
    "connect-src": [
      "*.myshopify.com",
      "monorail-edge.shopifysvc.com",
    ],
    "frame-src": [],
  };
}
