/**
 * Blends several existing signals into one 0-1 "recommendation score" so
 * search results can be ranked by overall quality/fit rather than just
 * distance or price alone. This is intentionally a transparent weighted
 * formula (not a trained ML model) - easy to reason about and to tune the
 * WEIGHTS below as real usage data comes in.
 *
 * Assumed scales (matches how these fields are used elsewhere in the app):
 *  - avgRating: 0-5
 *  - trustScore: 0-100
 *  - completionRate: 0-100
 *  - responseTimeMins: minutes, lower is better, no fixed cap
 *  - distanceKm: lower is better, null if customer location unknown
 *  - price: lower is slightly favored, relative to the most expensive result in this batch
 */
const WEIGHTS = {
  rating: 0.3,
  trust: 0.2,
  completionRate: 0.15,
  responseTime: 0.1,
  distance: 0.15,
  price: 0.1,
};

function computeRecommendationScore(listing, maxPriceInBatch) {
  const provider = listing.provider || {};

  const ratingScore = clamp01((provider.avgRating || 0) / 5);
  const trustScoreNormalized = clamp01((provider.trustScore || 0) / 100);
  const completionRateNormalized = clamp01((provider.completionRate || 0) / 100);

  // No response time on file yet -> neutral score rather than penalizing new providers
  const responseTimeScore =
    provider.responseTimeMins != null ? clamp01(1 / (1 + provider.responseTimeMins / 60)) : 0.5;

  // No customer location -> neutral score, distance simply doesn't factor in
  const distanceScore = listing.distanceKm != null ? clamp01(1 / (1 + listing.distanceKm / 5)) : 0.5;

  const priceScore = maxPriceInBatch > 0 ? clamp01(1 - (listing.price || 0) / maxPriceInBatch) : 0.5;

  return (
    ratingScore * WEIGHTS.rating +
    trustScoreNormalized * WEIGHTS.trust +
    completionRateNormalized * WEIGHTS.completionRate +
    responseTimeScore * WEIGHTS.responseTime +
    distanceScore * WEIGHTS.distance +
    priceScore * WEIGHTS.price
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

module.exports = { computeRecommendationScore };
