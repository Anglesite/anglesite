// ---------------------------------------------------------------------------
// Analytics Engine helpers for A/B testing
// ---------------------------------------------------------------------------

/** Shape of a data point written to Analytics Engine */
export interface AnalyticsDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

/**
 * Build an Analytics Engine data point for an impression event.
 * @param experimentId - The experiment ID
 * @param variant - The assigned variant name
 * @param sessionId - Hashed session identifier (no PII)
 * @returns Data point ready for env.ANALYTICS.writeDataPoint()
 */
export function buildImpressionDataPoint(
  experimentId: string,
  variant: string,
  sessionId: string,
): AnalyticsDataPoint {
  return {
    indexes: [experimentId],
    blobs: [variant, "impression", sessionId],
    doubles: [1],
  };
}

/**
 * Build an Analytics Engine data point for a conversion event.
 * @param experimentId - The experiment ID
 * @param variant - The assigned variant name
 * @param eventType - The conversion metric (e.g. "contact-form-submit")
 * @param sessionId - Hashed session identifier (no PII)
 * @returns Data point ready for env.ANALYTICS.writeDataPoint()
 */
export function buildConversionDataPoint(
  experimentId: string,
  variant: string,
  eventType: string,
  sessionId: string,
): AnalyticsDataPoint {
  return {
    indexes: [experimentId],
    blobs: [variant, eventType, sessionId],
    doubles: [1],
  };
}

/**
 * Build an Analytics Engine SQL query to aggregate conversion rates per variant.
 * Accounts for _sample_interval for correctness at high traffic volumes.
 * @param experimentId - The experiment ID to query
 * @param lookbackDays - Number of days to look back (default 14)
 * @returns SQL string for the Analytics Engine SQL API
 */
/** Sanitize an experiment ID to alphanumeric + hyphens only */
function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "");
}

export function buildConversionQuery(
  experimentId: string,
  lookbackDays = 14,
): string {
  const safeId = sanitizeId(experimentId);
  const safeDays = Math.max(1, Math.floor(lookbackDays));
  return `SELECT
  blob1 AS variant,
  SUM(IF(blob2 = 'impression', _sample_interval, 0)) AS impressions,
  SUM(IF(blob2 != 'impression', _sample_interval, 0)) AS conversions,
  conversions / impressions AS conversion_rate
FROM anglesite_events
WHERE index1 = '${safeId}'
  AND timestamp > NOW() - INTERVAL '${safeDays}' DAY
GROUP BY variant`;
}
