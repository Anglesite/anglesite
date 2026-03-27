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

// ---------------------------------------------------------------------------
// CSP directives
// ---------------------------------------------------------------------------

/** CSP directives needed for Paddle */
export interface PaddleCSP {
  "script-src": string[];
  "connect-src": string[];
  "frame-src": string[];
}

/**
 * Build CSP directives required for Paddle.js.
 *
 * Paddle.js loads from cdn.paddle.com (production) or
 * sandbox-cdn.paddle.com (sandbox). The checkout overlay
 * uses checkout.paddle.com / sandbox-checkout.paddle.com.
 * Paddle sends telemetry to log.paddle.com.
 *
 * Both sandbox and production domains are included so sites
 * work in test mode without CSP changes.
 */
export function buildPaddleCSP(): PaddleCSP {
  return {
    "script-src": ["cdn.paddle.com", "sandbox-cdn.paddle.com"],
    "connect-src": ["log.paddle.com"],
    "frame-src": ["checkout.paddle.com", "sandbox-checkout.paddle.com"],
  };
}
