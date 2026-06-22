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
