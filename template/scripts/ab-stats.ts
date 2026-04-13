// ---------------------------------------------------------------------------
// Bayesian A/B test statistics
// ---------------------------------------------------------------------------

/** Conversion stats for a single variant */
export interface VariantStats {
  name: string;
  impressions: number;
  conversions: number;
}

/** Result of a Bayesian A/B test comparison */
export interface ABTestResult {
  winner: string;
  probabilityBeatControl: number;
  liftPct: number;
  controlRate: number;
  variantRate: number;
}

// ---------------------------------------------------------------------------
// Beta distribution helpers
// ---------------------------------------------------------------------------

/**
 * Mean of a Beta(alpha, beta) distribution.
 * @param alpha - Successes + 1
 * @param beta - Failures + 1
 * @returns The expected value
 */
export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Variance of a Beta(alpha, beta) distribution.
 * @param alpha - Successes + 1
 * @param beta - Failures + 1
 * @returns The variance
 */
export function betaVariance(alpha: number, beta: number): number {
  return (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
}

// ---------------------------------------------------------------------------
// Monte Carlo simulation for P(B > A)
// ---------------------------------------------------------------------------

/**
 * Sample from a Beta distribution using the Joehnk algorithm.
 * Suitable for small alpha/beta values typical in A/B testing.
 */
function sampleBeta(alpha: number, beta: number): number {
  // Use the gamma-ratio method: Beta(a,b) = Ga/(Ga+Gb)
  const ga = sampleGamma(alpha);
  const gb = sampleGamma(beta);
  return ga / (ga + gb);
}

/** Sample from a Gamma(shape, 1) distribution using Marsaglia & Tsang's method */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return sampleGamma(shape + 1) * Math.random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = boxMullerNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal sample via Box-Muller transform */
function boxMullerNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

const SIMULATION_RUNS = 20_000;

/**
 * Run a Bayesian A/B test comparing the first variant (control) against
 * the second (treatment).
 *
 * Uses Beta-Binomial conjugate model with uniform prior Beta(1,1).
 * Monte Carlo simulation estimates P(treatment > control).
 *
 * @param variants - Array of exactly 2 VariantStats [control, treatment]
 * @param confidenceThreshold - Threshold for declaring a winner (default 0.95)
 * @returns ABTestResult with winner, probability, and lift
 */
export function bayesianABTest(
  variants: VariantStats[],
  confidenceThreshold = 0.95,
): ABTestResult {
  const control = variants[0];
  const treatment = variants[1];

  // Beta posterior parameters: prior Beta(1,1) + observed data
  const alphaC = 1 + control.conversions;
  const betaC = 1 + (control.impressions - control.conversions);
  const alphaT = 1 + treatment.conversions;
  const betaT = 1 + (treatment.impressions - treatment.conversions);

  // Monte Carlo: estimate P(treatment rate > control rate)
  let treatmentWins = 0;
  for (let i = 0; i < SIMULATION_RUNS; i++) {
    const sC = sampleBeta(alphaC, betaC);
    const sT = sampleBeta(alphaT, betaT);
    if (sT > sC) treatmentWins++;
  }
  const probabilityBeatControl = treatmentWins / SIMULATION_RUNS;

  // Point estimates
  const controlRate = betaMean(alphaC, betaC);
  const variantRate = betaMean(alphaT, betaT);
  const liftPct =
    controlRate > 0 ? ((variantRate - controlRate) / controlRate) * 100 : 0;

  // Determine winner
  let winner: string;
  if (probabilityBeatControl >= confidenceThreshold) {
    winner = treatment.name;
  } else if (1 - probabilityBeatControl >= confidenceThreshold) {
    winner = control.name;
  } else {
    winner = "inconclusive";
  }

  return {
    winner,
    probabilityBeatControl,
    liftPct,
    controlRate,
    variantRate,
  };
}

// ---------------------------------------------------------------------------
// Plain-language formatting
// ---------------------------------------------------------------------------

/**
 * Format an A/B test result as a plain-language summary for non-technical owners.
 * @param experimentName - Human-readable experiment name (e.g. "Homepage Hero")
 * @param result - The ABTestResult from bayesianABTest()
 * @returns A multi-line plain-language summary
 */
export function formatExperimentResult(
  experimentName: string,
  result: ABTestResult,
): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const confPct = `${Math.round(result.probabilityBeatControl * 100)}%`;
  const liftRounded = Math.round(Math.abs(result.liftPct));
  const rates = `Original: ${pct(result.controlRate)} · Variant: ${pct(result.variantRate)}`;

  if (result.winner === "inconclusive") {
    return [
      `**${experimentName}**`,
      `Too close to call — not enough data to pick a winner yet.`,
      rates,
    ].join("\n");
  }

  if (result.winner === "control") {
    return [
      `**${experimentName}**`,
      `The original is performing better by about ${liftRounded}%. We're ${confPct} confident this is a real difference.`,
      rates,
    ].join("\n");
  }

  return [
    `**${experimentName}**`,
    `${result.winner} is outperforming the original by about ${liftRounded}%. We're ${confPct} confident this is a real difference.`,
    rates,
  ].join("\n");
}
