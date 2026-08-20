const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

// Customer submits a review after a booking is COMPLETED
async function createReview(req, res) {
  const { bookingId, rating, comment } = req.body;

  if (!bookingId || !rating) return error(res, 'bookingId and rating are required');
  if (rating < 1 || rating > 5) return error(res, 'Rating must be between 1 and 5');

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return error(res, 'Booking not found', 404);
  if (booking.customerId !== req.user.id) {
    return error(res, 'Only the customer of this booking can leave a review', 403);
  }
  if (booking.status !== 'COMPLETED') {
    return error(res, 'You can only review a completed booking');
  }

  const existing = await prisma.review.findUnique({ where: { bookingId } });
  if (existing) return error(res, 'This booking has already been reviewed');

  const review = await prisma.review.create({
    data: { bookingId, rating, comment },
  });

  // Recalculate the provider's average rating
  const providerReviews = await prisma.review.findMany({
    where: { booking: { providerId: booking.providerId } },
  });
  const avgRating =
    providerReviews.reduce((sum, r) => sum + r.rating, 0) / providerReviews.length;

  await prisma.providerProfile.update({
    where: { id: booking.providerId },
    data: { avgRating, totalReviews: providerReviews.length },
  });

  return success(res, review, 'Review submitted', 201);
}

async function getReviewsForProvider(req, res) {
  const { providerId } = req.params;

  const reviews = await prisma.review.findMany({
    where: { booking: { providerId } },
    include: { booking: { include: { customer: { select: { id: true, name: true, avatarUrl: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  return success(res, reviews);
}

module.exports = { createReview, getReviewsForProvider };
