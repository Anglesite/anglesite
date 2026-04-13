// ---------------------------------------------------------------------------
// Ecommerce upgrade path assessment — thresholds, fee calculations, messaging
// ---------------------------------------------------------------------------

import type { EcommerceProvider } from "./ecommerce-revenue.js";

// ---------------------------------------------------------------------------
// Upgrade thresholds
// ---------------------------------------------------------------------------

/** Documented upgrade triggers */
export const UPGRADE_THRESHOLDS = {
  /** Snipcart -> Shopify: product count threshold */
  snipcartProductCount: 10,
  /** Snipcart -> Shopify: monthly revenue in cents ($15,000) */
  snipcartRevenueCents: 1_500_000,
  /** Stripe Payment Links -> Snipcart/Polar: product count threshold */
  stripeProductCount: 3,
} as const;

// ---------------------------------------------------------------------------
// Fee structures (per-transaction costs)
// ---------------------------------------------------------------------------

/** Fee structure for a provider at a given volume */
export interface FeeBreakdown {
  provider: EcommerceProvider | "shopify";
  /** Fixed monthly fee in cents */
  monthlyFeeCents: number;
  /** Percentage fee as a decimal (e.g., 0.029 = 2.9%) */
  percentageFee: number;
  /** Fixed per-transaction fee in cents */
  perTransactionCents: number;
  /** Label for display */
  label: string;
}

/** Map of provider fee structures */
const FEE_STRUCTURES: Record<string, FeeBreakdown> = {
  snipcart: {
    provider: "snipcart",
    monthlyFeeCents: 0,
    percentageFee: 0.02,
    perTransactionCents: 0,
    label: "Snipcart (2% + Stripe fees)",
  },
  stripe: {
    provider: "stripe",
    monthlyFeeCents: 0,
    percentageFee: 0.029,
    perTransactionCents: 30,
    label: "Stripe Payment Links (2.9% + 30\u00A2)",
  },
  shopify: {
    provider: "shopify",
    monthlyFeeCents: 3900, // $39/month Basic plan
    percentageFee: 0.029,
    perTransactionCents: 30,
    label: "Shopify Basic ($39/mo + 2.9% + 30\u00A2)",
  },
  polar: {
    provider: "polar" as EcommerceProvider,
    monthlyFeeCents: 0,
    percentageFee: 0.04,
    perTransactionCents: 0,
    label: "Polar (4% + processing)",
  },
  lemonsqueezy: {
    provider: "lemonsqueezy",
    monthlyFeeCents: 0,
    percentageFee: 0.05,
    perTransactionCents: 50,
    label: "Lemon Squeezy (5% + 50\u00A2)",
  },
  paddle: {
    provider: "paddle" as EcommerceProvider,
    monthlyFeeCents: 0,
    percentageFee: 0.05,
    perTransactionCents: 50,
    label: "Paddle (5% + 50\u00A2)",
  },
};

/**
 * Calculate monthly fees for a provider at a given volume.
 * @param provider - The provider key
 * @param monthlyRevenueCents - Monthly revenue in cents
 * @param orderCount - Number of orders per month
 * @returns Total monthly cost in cents
 */
export function calculateMonthlyFees(
  provider: string,
  monthlyRevenueCents: number,
  orderCount: number,
): number {
  const fees = FEE_STRUCTURES[provider];
  if (!fees) return 0;
  return (
    fees.monthlyFeeCents +
    Math.round(monthlyRevenueCents * fees.percentageFee) +
    fees.perTransactionCents * orderCount
  );
}

// ---------------------------------------------------------------------------
// Cost comparison
// ---------------------------------------------------------------------------

/** Side-by-side cost comparison between two providers */
export interface CostComparison {
  currentProvider: string;
  currentLabel: string;
  currentMonthlyCents: number;
  recommendedProvider: string;
  recommendedLabel: string;
  recommendedMonthlyCents: number;
  /** Positive = saving money by switching, negative = costs more */
  savingsCents: number;
}

/**
 * Compare monthly costs between two providers at a given volume.
 * @param monthlyRevenueCents - Monthly revenue in cents
 * @param orderCount - Estimated number of orders per month
 * @param currentProvider - Current provider key
 * @param recommendedProvider - Recommended provider key
 */
export function compareCosts(
  monthlyRevenueCents: number,
  orderCount: number,
  currentProvider: string,
  recommendedProvider: string,
): CostComparison {
  const currentFees = calculateMonthlyFees(currentProvider, monthlyRevenueCents, orderCount);
  const recommendedFees = calculateMonthlyFees(recommendedProvider, monthlyRevenueCents, orderCount);
  return {
    currentProvider,
    currentLabel: FEE_STRUCTURES[currentProvider]?.label ?? currentProvider,
    currentMonthlyCents: currentFees,
    recommendedProvider,
    recommendedLabel: FEE_STRUCTURES[recommendedProvider]?.label ?? recommendedProvider,
    recommendedMonthlyCents: recommendedFees,
    savingsCents: currentFees - recommendedFees,
  };
}

// ---------------------------------------------------------------------------
// Upgrade assessment
// ---------------------------------------------------------------------------

/** Input for upgrade assessment */
export interface UpgradeInput {
  provider: EcommerceProvider;
  productCount: number;
  /** Monthly revenue in cents (from webhook analytics, if available) */
  monthlyRevenueCents?: number;
  /** Number of orders per month (from webhook analytics, if available) */
  monthlyOrderCount?: number;
}

/** Upgrade recommendation */
export interface UpgradeRecommendation {
  /** Current provider */
  from: EcommerceProvider;
  /** Recommended provider */
  to: string;
  /** Why the upgrade is recommended */
  reason: "product_count" | "revenue_volume" | "needs_cart" | "needs_licensing";
  /** Cost comparison (only if revenue data is available) */
  comparison?: CostComparison;
}

/**
 * Assess whether the current ecommerce setup should be upgraded.
 * Returns null if no upgrade is needed.
 */
export function assessUpgrade(input: UpgradeInput): UpgradeRecommendation | null {
  const { provider, productCount, monthlyRevenueCents, monthlyOrderCount } = input;

  switch (provider) {
    case "snipcart": {
      // Check product count threshold
      if (productCount >= UPGRADE_THRESHOLDS.snipcartProductCount) {
        const recommendation: UpgradeRecommendation = {
          from: "snipcart",
          to: "shopify",
          reason: "product_count",
        };
        if (monthlyRevenueCents !== undefined && monthlyOrderCount !== undefined) {
          recommendation.comparison = compareCosts(
            monthlyRevenueCents,
            monthlyOrderCount,
            "snipcart",
            "shopify",
          );
        }
        return recommendation;
      }
      // Check revenue threshold
      if (
        monthlyRevenueCents !== undefined &&
        monthlyRevenueCents >= UPGRADE_THRESHOLDS.snipcartRevenueCents
      ) {
        const recommendation: UpgradeRecommendation = {
          from: "snipcart",
          to: "shopify",
          reason: "revenue_volume",
        };
        if (monthlyOrderCount !== undefined) {
          recommendation.comparison = compareCosts(
            monthlyRevenueCents,
            monthlyOrderCount,
            "snipcart",
            "shopify",
          );
        }
        return recommendation;
      }
      return null;
    }

    case "stripe": {
      // Stripe Payment Links -> needs a cart for multiple products
      if (productCount >= UPGRADE_THRESHOLDS.stripeProductCount) {
        return {
          from: "stripe",
          to: "snipcart",
          reason: "needs_cart",
        };
      }
      return null;
    }

    // Shopify, Polar, Lemon Squeezy, Paddle — no automated upgrade paths
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Plain-English messaging
// ---------------------------------------------------------------------------

/**
 * Format an upgrade recommendation as a plain-English message for the site owner.
 */
export function formatUpgradeMessage(rec: UpgradeRecommendation): string {
  const providerNames: Record<string, string> = {
    snipcart: "Snipcart",
    shopify: "Shopify",
    stripe: "Stripe Payment Links",
    polar: "Polar",
    lemonsqueezy: "Lemon Squeezy",
    paddle: "Paddle",
  };

  const from = providerNames[rec.from] ?? rec.from;
  const to = providerNames[rec.to] ?? rec.to;

  let message: string;

  switch (rec.reason) {
    case "product_count":
      message = `Your product catalog has grown past the point where ${from} is the best fit. ${to} gives you inventory management, order tracking, and a dashboard to run your store from.`;
      break;
    case "revenue_volume":
      message = `Your store is doing well! At this volume, ${to}'s monthly fee is offset by lower per-transaction costs compared to ${from}.`;
      break;
    case "needs_cart":
      message = `With multiple products, your customers will want a shopping cart. ${to} adds cart functionality with no monthly fee.`;
      break;
    case "needs_licensing":
      message = `For software licensing and subscription billing, ${to} handles tax compliance, license keys, and recurring payments.`;
      break;
  }

  if (rec.comparison && rec.comparison.savingsCents > 0) {
    const savings = (rec.comparison.savingsCents / 100).toFixed(2);
    message += ` Based on your current sales, switching would save you about $${savings}/month.`;
  } else if (rec.comparison && rec.comparison.savingsCents < 0) {
    const extra = (Math.abs(rec.comparison.savingsCents) / 100).toFixed(2);
    message += ` ${to} costs about $${extra}/month more, but the dashboard and tools are worth it at your scale.`;
  }

  return message;
}
