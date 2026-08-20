const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

// Returns the current user's favorited listings, with provider + category
// info included so the app can render them the same way as search results.
async function listFavorites(req, res) {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      listing: {
        include: {
          provider: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
          category: true,
        },
      },
    },
  });

  return success(res, favorites.map((f) => ({ ...f.listing, favoritedAt: f.createdAt })));
}

// Returns just the list of listingIds the user has favorited - lightweight,
// meant for the search/home screen to know which heart icons to fill in.
async function listFavoriteIds(req, res) {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user.id },
    select: { listingId: true },
  });
  return success(res, favorites.map((f) => f.listingId));
}

async function addFavorite(req, res) {
  const { listingId } = req.body;
  if (!listingId) return error(res, 'listingId is required');

  const listing = await prisma.serviceListing.findUnique({ where: { id: listingId } });
  if (!listing) return error(res, 'Listing not found', 404);

  const favorite = await prisma.favorite.upsert({
    where: { userId_listingId: { userId: req.user.id, listingId } },
    create: { userId: req.user.id, listingId },
    update: {},
  });

  return success(res, favorite, 'Added to favorites');
}

async function removeFavorite(req, res) {
  const { listingId } = req.params;

  await prisma.favorite
    .delete({ where: { userId_listingId: { userId: req.user.id, listingId } } })
    .catch(() => {}); // Already removed - treat as success either way

  return success(res, {}, 'Removed from favorites');
}

module.exports = { listFavorites, listFavoriteIds, addFavorite, removeFavorite };
