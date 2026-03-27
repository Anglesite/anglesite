// ---------------------------------------------------------------------------
// Lemon Squeezy helpers — config parsing and CSP
// ---------------------------------------------------------------------------

/** Parsed Lemon Squeezy configuration */
export interface LemonSqueezyConfig {
  /** Store slug from the checkout URL */
  storeSlug: string;
  /** Product slug from the checkout URL */
  productSlug: string;
}

/**
 * Parse and validate Lemon Squeezy configuration inputs.
 *
 * @param storeSlug - Store slug (e.g., "my-store")
 * @param productSlug - Product slug (e.g., "my-product")
 * @returns Parsed config or null if inputs are invalid
 */
export function parseLemonSqueezyConfig(
  storeSlug: string,
  productSlug: string,
): LemonSqueezyConfig | null {
  const store = storeSlug.trim();
  const product = productSlug.trim();

  if (!store || !product) return null;

  return {
    storeSlug: store,
    productSlug: product,
  };
}

// ---------------------------------------------------------------------------
// CSP directives
// ---------------------------------------------------------------------------

/** CSP directives needed for Lemon Squeezy */
export interface LemonSqueezyCSP {
  "script-src": string[];
  "connect-src": string[];
  "frame-src": string[];
}

/**
 * Build CSP directives required for Lemon Squeezy.
 *
 * Lemon Squeezy's checkout overlay loads a script from
 * assets.lemonsqueezy.com and opens the checkout in an iframe
 * on *.lemonsqueezy.com (e.g., my-store.lemonsqueezy.com).
 */
export function buildLemonSqueezyCSP(): LemonSqueezyCSP {
  return {
    "script-src": ["assets.lemonsqueezy.com"],
    "connect-src": ["api.lemonsqueezy.com"],
    "frame-src": ["*.lemonsqueezy.com"],
  };
}
