// ---------------------------------------------------------------------------
// Experiment configuration types and helpers
// ---------------------------------------------------------------------------

/** A single experiment definition as written in experiments.config.ts */
export interface ExperimentEntry {
  page: string;
  variants: string[];
  weights: number[];
  metric: string;
  active?: boolean;
}

/** The top-level config object keyed by experiment ID */
export type ExperimentConfig = Record<string, ExperimentEntry>;

/** A parsed experiment with its ID attached */
export interface Experiment {
  id: string;
  page: string;
  variants: string[];
  weights: number[];
  metric: string;
  active: boolean;
}

/**
 * Parse an experiment config object into an array of Experiment records.
 * @param config - The raw config keyed by experiment ID
 * @returns Array of parsed experiments with defaults applied
 */
export function parseExperiments(config: ExperimentConfig): Experiment[] {
  return Object.entries(config).map(([id, entry]) => ({
    id,
    page: entry.page,
    variants: entry.variants,
    weights: entry.weights,
    metric: entry.metric,
    active: entry.active ?? true,
  }));
}

/**
 * Find the active experiment for a given URL pathname.
 * @param pathname - The request pathname (e.g. "/pricing")
 * @param experiments - Array of parsed experiments
 * @returns The matching active experiment, or undefined
 */
export function getActiveExperiment(
  pathname: string,
  experiments: Experiment[],
): Experiment | undefined {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return experiments.find(
    (exp) => exp.active && exp.page === normalized,
  );
}

// ---------------------------------------------------------------------------
// Variant assignment
// ---------------------------------------------------------------------------

/**
 * Assign a variant based on weighted random selection.
 * @param variants - Array of variant names (e.g. ["control", "variant-a"])
 * @param weights - Corresponding weights (should sum to ~1.0)
 * @returns The selected variant name
 */
export function assignVariant(variants: string[], weights: number[]): string {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) return variants[i];
  }
  // Rounding-error fallback: return last variant
  return variants[variants.length - 1];
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Parse a variant assignment from a Cookie header.
 * @param cookieHeader - The raw Cookie header string
 * @param experimentId - The experiment ID to look up
 * @returns The assigned variant name, or undefined
 */
export function parseVariantCookie(
  cookieHeader: string,
  experimentId: string,
): string | undefined {
  const name = `exp_${experimentId}`;
  const pairs = cookieHeader.split(/;\s*/);
  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (key.trim() === name) return rest.join("=").trim();
  }
  return undefined;
}

/**
 * Serialize a Set-Cookie header for variant assignment.
 * @param experimentId - The experiment ID
 * @param variant - The assigned variant name
 * @returns A Set-Cookie header value
 */
export function serializeVariantCookie(
  experimentId: string,
  variant: string,
): string {
  return `exp_${experimentId}=${variant}; Path=/; SameSite=Lax; HttpOnly; Secure`;
}

// ---------------------------------------------------------------------------
// Variant path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the file path for a given variant.
 * Control serves the original path; other variants serve e.g. /index.variant-a.html.
 * @param pathname - The original request pathname
 * @param variant - The variant name
 * @returns The resolved path to fetch
 */
export function resolveVariantPath(pathname: string, variant: string): string {
  if (variant === "control") return pathname;
  const normalized = pathname.replace(/\/+$/, "") || "";
  const base = normalized === "" ? "/" : normalized + "/";
  return `${base}index.${variant}.html`;
}
