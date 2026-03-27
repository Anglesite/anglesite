// ---------------------------------------------------------------------------
// Snipcart helpers — product attributes, CSP, price formatting
// ---------------------------------------------------------------------------

/** Product data required for Snipcart data-item-* attributes */
export interface SnipcartProduct {
  id: string;
  name: string;
  /** Price in cents (e.g., 4500 = $45.00) */
  price: number;
  /** Crawlable URL path for product validation (e.g., "/products/leather-bag") */
  url: string;
  description: string;
  /** Image path relative to public/ */
  image?: string;
  /** Weight in grams (for shipping calculation) */
  weight?: number;
}

/** Map of data-item-* attributes for a Snipcart buy button */
export type SnipcartAttrs = Record<string, string | number>;

/**
 * Build Snipcart `data-item-*` attributes for a product.
 * @param product - Product data
 * @returns Object with data-item-* keys and their values
 */
export function buildSnipcartAttrs(product: SnipcartProduct): SnipcartAttrs {
  const attrs: SnipcartAttrs = {
    "data-item-id": product.id,
    "data-item-name": product.name,
    "data-item-price": formatPrice(product.price),
    "data-item-url": product.url,
    "data-item-description": product.description,
  };
  if (product.image) {
    attrs["data-item-image"] = product.image;
  }
  if (product.weight !== undefined) {
    attrs["data-item-weight"] = product.weight;
  }
  return attrs;
}

/**
 * Format a price in cents to a dollar string with two decimal places.
 * @param cents - Price in cents
 * @returns Formatted price string (e.g., "45.00")
 */
export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// CSP directives
// ---------------------------------------------------------------------------

/** CSP directives needed for Snipcart */
export interface SnipcartCSP {
  "script-src": string[];
  "style-src": string[];
  "connect-src": string[];
  "frame-src": string[];
}

/**
 * Build CSP directives required for Snipcart.
 * @returns Object with arrays of domains to add to each CSP directive
 */
export function buildSnipcartCSP(): SnipcartCSP {
  return {
    "script-src": ["cdn.snipcart.com"],
    "style-src": ["cdn.snipcart.com"],
    "connect-src": ["app.snipcart.com"],
    "frame-src": ["app.snipcart.com"],
  };
}
