// ---------------------------------------------------------------------------
// Analytics Engine helpers for ecommerce revenue tracking
// ---------------------------------------------------------------------------

/** Shape of a data point written to Analytics Engine */
export interface AnalyticsDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

/** Supported ecommerce providers */
export type EcommerceProvider =
  | "snipcart"
  | "stripe"
  | "shopify"
  | "polar"
  | "lemonsqueezy"
  | "paddle";

/**
 * Build an Analytics Engine data point for a completed order.
 * Written by the webhook worker when a platform sends an order notification.
 *
 * Index: "ecommerce-revenue" (fixed, for querying)
 * Blobs: [provider, currency, orderId]
 * Doubles: [amountCents]
 */
export function buildRevenueDataPoint(
  provider: EcommerceProvider,
  amountCents: number,
  currency: string,
  orderId: string,
): AnalyticsDataPoint {
  return {
    indexes: ["ecommerce-revenue"],
    blobs: [provider, currency.toUpperCase(), orderId],
    doubles: [amountCents],
  };
}

/**
 * Build an Analytics Engine SQL query to aggregate monthly revenue.
 * Returns total revenue in cents grouped by provider and currency.
 *
 * @param lookbackDays - Number of days to look back (default 30)
 * @returns SQL string for the Analytics Engine SQL API
 */
export function buildRevenueQuery(lookbackDays = 30): string {
  const safeDays = Math.max(1, Math.floor(lookbackDays));
  return `SELECT
  blob1 AS provider,
  blob2 AS currency,
  SUM(double1 * _sample_interval) AS total_cents,
  COUNT(*) AS order_count
FROM anglesite_events
WHERE index1 = 'ecommerce-revenue'
  AND timestamp > NOW() - INTERVAL '${safeDays}' DAY
GROUP BY provider, currency
ORDER BY total_cents DESC`;
}

/** Parsed result from a revenue query row */
export interface RevenueRow {
  provider: EcommerceProvider;
  currency: string;
  totalCents: number;
  orderCount: number;
}

/**
 * Parse a row from the revenue query result into a typed object.
 */
export function parseRevenueRow(row: Record<string, unknown>): RevenueRow {
  return {
    provider: row.provider as EcommerceProvider,
    currency: String(row.currency),
    totalCents: Number(row.total_cents),
    orderCount: Number(row.order_count),
  };
}
