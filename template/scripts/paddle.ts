// ---------------------------------------------------------------------------
// Paddle helpers — config parsing and CSP
// ---------------------------------------------------------------------------

/** Parsed Paddle configuration */
export interface PaddleConfig {
  /** Paddle client-side token (test_ or live_ prefix) */
  clientToken: string;
  /** Paddle price ID (pri_...) */
  priceId: string;
  /** Whether the token is a sandbox/test token */
  sandbox: boolean;
}

/**
 * Parse and validate Paddle configuration inputs.
 *
 * @param clientToken - Paddle client-side token (test_... or live_...)
 * @param priceId - Paddle price ID (pri_...)
 * @returns Parsed config or null if inputs are invalid
 */
export function parsePaddleConfig(
  clientToken: string,
  priceId: string,
): PaddleConfig | null {
  const token = clientToken.trim();
  const price = priceId.trim();

  if (!token || !price) return null;

  return {
    clientToken: token,
    priceId: price,
    sandbox: token.startsWith("test_"),
  };
}
