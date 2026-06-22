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
