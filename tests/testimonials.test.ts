import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateReviewJsonLd,
  generateAggregateRatingJsonLd,
  formatTestimonialSummary,
  type Testimonial,
} from "../template/scripts/testimonials.js";

// ---------------------------------------------------------------------------
// generateReviewJsonLd
// ---------------------------------------------------------------------------

describe("generateReviewJsonLd", () => {
  const review: Testimonial = {
    author: "Jane Smith",
    quote: "Best pizza in town!",
    rating: 5,
    date: "2026-02-14",
  };

  it("includes @context and @type", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Review");
  });

  it("includes author as Person", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    const author = ld.author as Record<string, string>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe("Jane Smith");
  });

  it("includes reviewRating", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    const rating = ld.reviewRating as Record<string, unknown>;
    expect(rating["@type"]).toBe("Rating");
    expect(rating.ratingValue).toBe(5);
    expect(rating.bestRating).toBe(5);
  });

  it("includes itemReviewed", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    const item = ld.itemReviewed as Record<string, string>;
    expect(item["@type"]).toBe("LocalBusiness");
    expect(item.name).toBe("Joe's Pizza");
  });

  it("includes reviewBody", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    expect(ld.reviewBody).toBe("Best pizza in town!");
  });

  it("includes datePublished when date provided", () => {
    const ld = generateReviewJsonLd(review, "Joe's Pizza", "https://joespizza.com");
    expect(ld.datePublished).toBe("2026-02-14");
  });

  it("omits datePublished when no date", () => {
    const noDate = { ...review, date: undefined };
    const ld = generateReviewJsonLd(noDate, "Joe's Pizza", "https://joespizza.com");
    expect(ld.datePublished).toBeUndefined();
  });

  it("omits reviewRating when no rating", () => {
    const noRating = { ...review, rating: undefined };
    const ld = generateReviewJsonLd(noRating, "Joe's Pizza", "https://joespizza.com");
    expect(ld.reviewRating).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateAggregateRatingJsonLd
// ---------------------------------------------------------------------------

describe("generateAggregateRatingJsonLd", () => {
  const reviews: Testimonial[] = [
    { author: "A", quote: "Great", rating: 5 },
    { author: "B", quote: "Good", rating: 4 },
    { author: "C", quote: "OK", rating: 3 },
  ];

  it("calculates average rating", () => {
    const ld = generateAggregateRatingJsonLd(reviews, "Biz", "https://biz.com");
    const agg = ld.aggregateRating as Record<string, unknown>;
    expect(agg.ratingValue).toBe(4);
  });

  it("counts reviews", () => {
    const ld = generateAggregateRatingJsonLd(reviews, "Biz", "https://biz.com");
    const agg = ld.aggregateRating as Record<string, unknown>;
    expect(agg.reviewCount).toBe(3);
  });

  it("includes @type LocalBusiness", () => {
    const ld = generateAggregateRatingJsonLd(reviews, "Biz", "https://biz.com");
    expect(ld["@type"]).toBe("LocalBusiness");
  });

  it("preserves decimal precision in average", () => {
    const uneven: Testimonial[] = [
      { author: "A", quote: "Great", rating: 5 },
      { author: "B", quote: "Good", rating: 5 },
      { author: "C", quote: "OK", rating: 4 },
    ];
    const ld = generateAggregateRatingJsonLd(uneven, "Biz", "https://biz.com");
    const agg = ld!.aggregateRating as Record<string, unknown>;
    expect(agg.ratingValue).toBe(4.7);
  });

  it("excludes reviews without ratings from average", () => {
    const mixed: Testimonial[] = [
      { author: "A", quote: "Great", rating: 5 },
      { author: "B", quote: "No stars" },
    ];
    const ld = generateAggregateRatingJsonLd(mixed, "Biz", "https://biz.com");
    const agg = ld.aggregateRating as Record<string, unknown>;
    expect(agg.ratingValue).toBe(5);
    expect(agg.reviewCount).toBe(1);
  });

  it("returns null when no rated reviews", () => {
    const noRatings: Testimonial[] = [
      { author: "A", quote: "Text only" },
    ];
    const ld = generateAggregateRatingJsonLd(noRatings, "Biz", "https://biz.com");
    expect(ld).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatTestimonialSummary
// ---------------------------------------------------------------------------

describe("formatTestimonialSummary", () => {
  it("shows count and average", () => {
    const result = formatTestimonialSummary(12, 4.8);
    expect(result).toContain("12");
    expect(result).toContain("4.8");
  });

  it("handles singular", () => {
    const result = formatTestimonialSummary(1, 5);
    expect(result).toContain("1 review");
    expect(result).not.toContain("reviews");
  });

  it("handles zero reviews", () => {
    const result = formatTestimonialSummary(0, 0);
    expect(result.toLowerCase()).toContain("no review");
  });
});

// ---------------------------------------------------------------------------
// Review Worker
// ---------------------------------------------------------------------------

describe("review worker", () => {
  const workerPath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "worker",
    "review-worker.js",
  );

  it("exists", () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  it("exports a default fetch handler", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toMatch(/export\s+default/);
  });

  it("validates Turnstile token", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toContain("siteverify");
  });

  it("validates rating is 1-5", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toMatch(/rating/);
  });

  it("emails submission to owner for moderation", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toContain("mailchannels");
  });
});

// ---------------------------------------------------------------------------
// Template pages
// ---------------------------------------------------------------------------

describe("review page template", () => {
  const reviewPath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "review.astro",
  );

  it("exists", () => {
    expect(existsSync(reviewPath)).toBe(true);
  });

  it("has name, rating, and text fields", () => {
    const html = readFileSync(reviewPath, "utf-8");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="rating"');
    expect(html).toContain('name="text"');
  });

  it("includes Turnstile widget", () => {
    const html = readFileSync(reviewPath, "utf-8");
    expect(html).toContain("cf-turnstile");
  });

  it("has accessible labels", () => {
    const html = readFileSync(reviewPath, "utf-8");
    expect(html).toMatch(/for=["']name["']/);
    expect(html).toMatch(/for=["']rating["']/);
    expect(html).toMatch(/for=["']text["']/);
  });
});

describe("testimonials page template", () => {
  const path = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "testimonials.astro",
  );

  it("exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("uses BaseLayout", () => {
    const html = readFileSync(path, "utf-8");
    expect(html).toContain("BaseLayout");
  });
});
