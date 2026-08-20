const prisma = require('../config/db');
const { getDistanceKm } = require('../services/locationService');
const { success, error } = require('../utils/responseHandler');
const { computeRecommendationScore } = require('../services/recommendationService');

// GET /api/search?categoryId=xxx&lat=23.7&lng=90.4&radiusKm=10&sortBy=recommended
// sortBy: 'recommended' (default when lat/lng given) | 'distance' | 'price_low' | 'price_high' | 'rating'
async function searchProviders(req, res) {
  const { categoryId, lat, lng, radiusKm, sortBy } = req.query;

  const listings = await prisma.serviceListing.findMany({
    where: {
      ...(categoryId ? { categoryId } : {}),
      // Same eligibility rule createBooking() already enforces
      // (bookingController.js) - a listing is only bookable if it isn't
      // soft-deleted and its provider is ACTIVE and not soft-deleted.
      // Search results must not surface listings a customer couldn't
      // actually book.
      deletedAt: null,
      provider: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      provider: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      category: true,
    },
  });

  let results = listings;
  const hasLocation = lat && lng;

  if (hasLocation) {
    const customerLat = parseFloat(lat);
    const customerLng = parseFloat(lng);
    const maxRadius = radiusKm ? parseFloat(radiusKm) : 10;

    results = listings
      .map((listing) => {
        const { latitude, longitude } = listing.provider;
        const distanceKm =
          latitude != null && longitude != null
            ? getDistanceKm(customerLat, customerLng, latitude, longitude)
            : null;
        return { ...listing, distanceKm };
      })
      .filter((listing) => listing.distanceKm === null || listing.distanceKm <= maxRadius);
  }

  const effectiveSort = sortBy || (hasLocation ? 'recommended' : 'recommended');

  if (effectiveSort === 'distance' && hasLocation) {
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else if (effectiveSort === 'price_low') {
    results.sort((a, b) => a.price - b.price);
  } else if (effectiveSort === 'price_high') {
    results.sort((a, b) => b.price - a.price);
  } else if (effectiveSort === 'rating') {
    results.sort((a, b) => (b.provider?.avgRating || 0) - (a.provider?.avgRating || 0));
  } else {
    // 'recommended' - blends rating, trust score, completion rate, response
    // time, distance (if known), and price into one score. See
    // recommendationService.js for the exact weighting.
    const maxPrice = Math.max(...results.map((r) => r.price || 0), 1);
    results = results
      .map((listing) => ({ ...listing, recommendationScore: computeRecommendationScore(listing, maxPrice) }))
      .sort((a, b) => b.recommendationScore - a.recommendationScore);
  }

  return success(res, results);
}

// Returns top-level categories with their subcategories nested (children[]).
async function listCategories(req, res) {
  const categories = await prisma.serviceCategory.findMany({
    where: { parentId: null },
    include: { children: true },
  });
  return success(res, categories);
}

// Admin-only: create a category or subcategory (pass parentId for subcategory)
async function createCategory(req, res) {
  const { name, iconUrl, parentId } = req.body;
  if (!name) return error(res, 'name is required');

  const category = await prisma.serviceCategory.create({
    data: { name, iconUrl, parentId: parentId || null },
  });
  return success(res, category, 'ক্যাটাগরি তৈরি হয়েছে', 201);
}

async function updateCategory(req, res) {
  const { id } = req.params;
  const { name, iconUrl, parentId } = req.body;

  const category = await prisma.serviceCategory.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(iconUrl !== undefined && { iconUrl }),
      ...(parentId !== undefined && { parentId }),
    },
  });
  return success(res, category, 'ক্যাটাগরি আপডেট হয়েছে');
}

async function deleteCategory(req, res) {
  const { id } = req.params;
  const childCount = await prisma.serviceCategory.count({ where: { parentId: id } });
  if (childCount > 0) return error(res, 'আগে সাব-ক্যাটাগরিগুলো মুছুন');

  await prisma.serviceCategory.delete({ where: { id } });
  return success(res, {}, 'ক্যাটাগরি মুছে ফেলা হয়েছে');
}

// GET /api/search/listings/:id - full detail for a single listing, used when
// navigating in from a lightweight snapshot (Recently Viewed, Favorites list)
// that doesn't carry the full provider/category payload.
async function getListingById(req, res) {
  const { id } = req.params;
  const listing = await prisma.serviceListing.findUnique({
    where: { id },
    include: {
      provider: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      category: true,
    },
  });

  // Same eligibility rule as searchProviders() / createBooking() - if a
  // listing wouldn't be bookable, it shouldn't be viewable either. Treated
  // as a plain 404 (not a distinct "provider suspended" message) so this
  // endpoint can't be used to probe a provider's status by ID.
  const isEligible =
    listing && !listing.deletedAt && !listing.provider.deletedAt && listing.provider.status === 'ACTIVE';

  if (!isEligible) return error(res, 'Listing not found', 404);
  return success(res, listing);
}

module.exports = {
  searchProviders,
  getListingById,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
