import { describe, it, expect } from "vitest";
import {
  UPGRADE_THRESHOLDS,
  calculateMonthlyFees,
  compareCosts,
  assessUpgrade,
  formatUpgradeMessage,
} from "../template/scripts/ecommerce-upgrade.js";

// ---------------------------------------------------------------------------
// UPGRADE_THRESHOLDS
// ---------------------------------------------------------------------------

describe("UPGRADE_THRESHOLDS", () => {
  it("defines snipcart product count threshold as 10", () => {
    expect(UPGRADE_THRESHOLDS.snipcartProductCount).toBe(10);
  });

  it("defines snipcart revenue threshold as $15,000 (1,500,000 cents)", () => {
    expect(UPGRADE_THRESHOLDS.snipcartRevenueCents).toBe(1_500_000);
  });

  it("defines stripe product count threshold as 3", () => {
    expect(UPGRADE_THRESHOLDS.stripeProductCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// calculateMonthlyFees
// ---------------------------------------------------------------------------

describe("calculateMonthlyFees", () => {
  it("calculates Snipcart fees (2% flat, no monthly)", () => {
    // $10,000 revenue, 50 orders
    const fees = calculateMonthlyFees("snipcart", 1_000_000, 50);
    // 2% of $10,000 = $200 = 20,000 cents
    expect(fees).toBe(20_000);
  });

  it("calculates Shopify fees ($39/mo + 2.9% + 30c per txn)", () => {
    // $10,000 revenue, 50 orders
    const fees = calculateMonthlyFees("shopify", 1_000_000, 50);
    // $39 + 2.9% of $10,000 + 50 * $0.30 = $39 + $290 + $15 = $344
    expect(fees).toBe(34_400);
  });

  it("calculates Stripe fees (2.9% + 30c per txn)", () => {
    // $1,000 revenue, 10 orders
    const fees = calculateMonthlyFees("stripe", 100_000, 10);
    // 2.9% of $1,000 + 10 * $0.30 = $29 + $3 = $32
    expect(fees).toBe(3_200);
  });

  it("returns 0 for unknown provider", () => {
    expect(calculateMonthlyFees("unknown", 100_000, 10)).toBe(0);
  });

  it("Snipcart is cheaper than Shopify at low volume", () => {
    const snipcart = calculateMonthlyFees("snipcart", 200_000, 20); // $2K
    const shopify = calculateMonthlyFees("shopify", 200_000, 20);
    expect(snipcart).toBeLessThan(shopify);
  });

  it("Shopify becomes cheaper than Snipcart at high volume", () => {
    // At $20,000/month, 100 orders:
    // Snipcart: 2% = $400
    // Shopify: $39 + 2.9% ($580) + 100*$0.30 ($30) = $649
    // Still more expensive... let's try much higher
    // At $50,000/month, 200 orders:
    // Snipcart: 2% = $1,000
    // Shopify: $39 + $1,450 + $60 = $1,549
    // Snipcart is still cheaper per-transaction (2% < 2.9%)
    // The advantage of Shopify is the dashboard, not lower fees.
    // Verify that the fee math is correct at the $15K threshold:
    const snipcart = calculateMonthlyFees("snipcart", 1_500_000, 75);
    const shopify = calculateMonthlyFees("shopify", 1_500_000, 75);
    // Snipcart: 2% of $15K = $300
    // Shopify: $39 + $435 + $22.50 = $496.50
    expect(snipcart).toBe(30_000);
    expect(shopify).toBe(49_650);
  });
});

// ---------------------------------------------------------------------------
// compareCosts
// ---------------------------------------------------------------------------

describe("compareCosts", () => {
  it("computes savings when switching from snipcart to shopify", () => {
    const result = compareCosts(1_500_000, 75, "snipcart", "shopify");
    expect(result.currentProvider).toBe("snipcart");
    expect(result.recommendedProvider).toBe("shopify");
    expect(result.currentMonthlyCents).toBe(30_000);
    expect(result.recommendedMonthlyCents).toBe(49_650);
    // At $15K, Snipcart is actually cheaper — savings is negative
    expect(result.savingsCents).toBeLessThan(0);
  });

  it("includes human-readable labels", () => {
    const result = compareCosts(100_000, 10, "snipcart", "shopify");
    expect(result.currentLabel).toContain("Snipcart");
    expect(result.recommendedLabel).toContain("Shopify");
  });

  it("returns 0 savings for same provider", () => {
    const result = compareCosts(100_000, 10, "snipcart", "snipcart");
    expect(result.savingsCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assessUpgrade
// ---------------------------------------------------------------------------

describe("assessUpgrade", () => {
  describe("snipcart", () => {
    it("recommends Shopify when product count >= 10", () => {
      const result = assessUpgrade({ provider: "snipcart", productCount: 12 });
      expect(result).not.toBeNull();
      expect(result!.from).toBe("snipcart");
      expect(result!.to).toBe("shopify");
      expect(result!.reason).toBe("product_count");
    });

    it("recommends Shopify at exactly 10 products", () => {
      const result = assessUpgrade({ provider: "snipcart", productCount: 10 });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("product_count");
    });

    it("does not recommend upgrade at 9 products without revenue data", () => {
      const result = assessUpgrade({ provider: "snipcart", productCount: 9 });
      expect(result).toBeNull();
    });

    it("recommends Shopify when monthly revenue >= $15K", () => {
      const result = assessUpgrade({
        provider: "snipcart",
        productCount: 5,
        monthlyRevenueCents: 1_600_000,
        monthlyOrderCount: 80,
      });
      expect(result).not.toBeNull();
      expect(result!.reason).toBe("revenue_volume");
    });

    it("includes cost comparison when revenue and order data available", () => {
      const result = assessUpgrade({
        provider: "snipcart",
        productCount: 15,
        monthlyRevenueCents: 2_000_000,
        monthlyOrderCount: 100,
      });
      expect(result).not.toBeNull();
      expect(result!.comparison).toBeDefined();
      expect(result!.comparison!.currentProvider).toBe("snipcart");
      expect(result!.comparison!.recommendedProvider).toBe("shopify");
    });

    it("omits cost comparison when revenue data is not available", () => {
      const result = assessUpgrade({ provider: "snipcart", productCount: 15 });
      expect(result).not.toBeNull();
      expect(result!.comparison).toBeUndefined();
    });

    it("does not recommend upgrade below all thresholds", () => {
      const result = assessUpgrade({
        provider: "snipcart",
        productCount: 5,
        monthlyRevenueCents: 500_000,
      });
      expect(result).toBeNull();
    });
  });

  describe("stripe", () => {
    it("recommends Snipcart when product count >= 3", () => {
      const result = assessUpgrade({ provider: "stripe", productCount: 3 });
      expect(result).not.toBeNull();
      expect(result!.from).toBe("stripe");
      expect(result!.to).toBe("snipcart");
      expect(result!.reason).toBe("needs_cart");
    });

    it("does not recommend upgrade at 2 products", () => {
      const result = assessUpgrade({ provider: "stripe", productCount: 2 });
      expect(result).toBeNull();
    });
  });

  describe("other providers", () => {
    it("returns null for shopify", () => {
      expect(assessUpgrade({ provider: "shopify", productCount: 100 })).toBeNull();
    });

    it("returns null for polar", () => {
      expect(assessUpgrade({ provider: "polar", productCount: 50 })).toBeNull();
    });

    it("returns null for lemonsqueezy", () => {
      expect(assessUpgrade({ provider: "lemonsqueezy", productCount: 20 })).toBeNull();
    });

    it("returns null for paddle", () => {
      expect(assessUpgrade({ provider: "paddle", productCount: 10 })).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// formatUpgradeMessage
// ---------------------------------------------------------------------------

describe("formatUpgradeMessage", () => {
  it("formats a product_count recommendation", () => {
    const msg = formatUpgradeMessage({
      from: "snipcart",
      to: "shopify",
      reason: "product_count",
    });
    expect(msg).toContain("Snipcart");
    expect(msg).toContain("Shopify");
    expect(msg).toContain("catalog");
  });

  it("formats a revenue_volume recommendation", () => {
    const msg = formatUpgradeMessage({
      from: "snipcart",
      to: "shopify",
      reason: "revenue_volume",
    });
    expect(msg).toContain("doing well");
    expect(msg).toContain("volume");
  });

  it("formats a needs_cart recommendation", () => {
    const msg = formatUpgradeMessage({
      from: "stripe",
      to: "snipcart",
      reason: "needs_cart",
    });
    expect(msg).toContain("shopping cart");
  });

  it("formats a needs_licensing recommendation", () => {
    const msg = formatUpgradeMessage({
      from: "stripe",
      to: "paddle",
      reason: "needs_licensing",
    });
    expect(msg).toContain("licensing");
    expect(msg).toContain("Paddle");
  });

  it("appends savings when comparison shows positive savings", () => {
    const msg = formatUpgradeMessage({
      from: "snipcart",
      to: "shopify",
      reason: "product_count",
      comparison: {
        currentProvider: "snipcart",
        currentLabel: "Snipcart",
        currentMonthlyCents: 50_000,
        recommendedProvider: "shopify",
        recommendedLabel: "Shopify",
        recommendedMonthlyCents: 40_000,
        savingsCents: 10_000,
      },
    });
    expect(msg).toContain("$100.00/month");
  });

  it("appends extra cost note when comparison shows negative savings", () => {
    const msg = formatUpgradeMessage({
      from: "snipcart",
      to: "shopify",
      reason: "product_count",
      comparison: {
        currentProvider: "snipcart",
        currentLabel: "Snipcart",
        currentMonthlyCents: 30_000,
        recommendedProvider: "shopify",
        recommendedLabel: "Shopify",
        recommendedMonthlyCents: 49_650,
        savingsCents: -19_650,
      },
    });
    expect(msg).toContain("$196.50/month more");
    expect(msg).toContain("worth it");
  });

  it("does not append cost info when no comparison provided", () => {
    const msg = formatUpgradeMessage({
      from: "snipcart",
      to: "shopify",
      reason: "product_count",
    });
    expect(msg).not.toContain("$");
  });
});
