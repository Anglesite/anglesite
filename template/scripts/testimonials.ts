/**
 * Testimonial display utilities — JSON-LD generation, star ratings,
 * and aggregate rating calculation.
 *
 * Used by the testimonials skill and the testimonials page template.
 */

export interface Testimonial {
  author: string;
  quote: string;
  attribution?: string;
  date?: string;
  rating?: number;
}

/**
 * Generate Review JSON-LD for a single testimonial.
 */
export function generateReviewJsonLd(
  testimonial: Testimonial,
  businessName: string,
  businessUrl: string,
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Review",
    author: {
      "@type": "Person",
      name: testimonial.author,
    },
    itemReviewed: {
      "@type": "LocalBusiness",
      name: businessName,
      url: businessUrl,
    },
    reviewBody: testimonial.quote,
  };

  if (testimonial.rating !== undefined) {
    ld.reviewRating = {
      "@type": "Rating",
      ratingValue: testimonial.rating,
      bestRating: 5,
    };
  }

  if (testimonial.date) {
    ld.datePublished = testimonial.date;
  }

  return ld;
}

/**
 * Generate AggregateRating JSON-LD from all testimonials.
 * Returns null if no testimonials have ratings.
 */
export function generateAggregateRatingJsonLd(
  testimonials: Testimonial[],
  businessName: string,
  businessUrl: string,
): Record<string, unknown> | null {
  const rated = testimonials.filter(
    (t) => t.rating !== undefined && t.rating !== null,
  );

  if (rated.length === 0) return null;

  const sum = rated.reduce((acc, t) => acc + t.rating!, 0);
  const avg = Math.round((sum / rated.length) * 10) / 10;

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: businessName,
    url: businessUrl,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: avg,
      bestRating: 5,
      reviewCount: rated.length,
    },
  };
}

/**
 * Format testimonial summary for plain-language reporting.
 */
export function formatTestimonialSummary(
  count: number,
  avgRating: number,
): string {
  if (count === 0) return "No reviews yet.";
  const label = count === 1 ? "1 review" : `${count} reviews`;
  return `${label}, ${avgRating} average rating.`;
}
