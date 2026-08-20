const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { getDistanceKm } = require('../services/locationService');
const { sendPushNotification } = require('../services/notificationService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// Customer posts a job/need (e.g. "I need a plumber")
async function createJobPost(req, res) {
  const customerId = req.user.id;
  const { categoryId, title, description, budgetMin, budgetMax, latitude, longitude, address } = req.body;

  if (!categoryId || !title) return error(res, 'categoryId and title are required');

  const jobPost = await prisma.jobPost.create({
    data: { customerId, categoryId, title, description, budgetMin, budgetMax, latitude, longitude, address },
  });

  // কাছাকাছি প্রোভাইডারদের নোটিফাই করা হচ্ছে (একই ক্যাটাগরির, serviceAreaRadiusKm এর মধ্যে)
  if (latitude != null && longitude != null) {
    const providers = await prisma.providerProfile.findMany({
      where: { listings: { some: { categoryId } } },
      include: { user: true },
    });

    providers
      .filter((p) => p.latitude != null && p.longitude != null)
      .filter((p) => getDistanceKm(latitude, longitude, p.latitude, p.longitude) <= (p.serviceAreaRadiusKm || 5))
      .forEach((p) => {
        sendPushNotification(
          p.user?.fcmToken,
          'নতুন জব পোস্ট',
          `আপনার এলাকায় "${title}" এর জন্য একজন কাস্টমার খুঁজছেন`,
          { type: 'job_post', jobPostId: jobPost.id }
        );
        // জব পোস্ট urgent হতে পারে (যেমন emergency repair), তাই push এর পাশাপাশি
        // WhatsApp-ও পাঠানো হচ্ছে — অ্যাপ বন্ধ থাকলেও দ্রুত চোখে পড়ার সম্ভাবনা বেশি
        if (p.user?.phone) {
          sendWhatsAppMessage(p.user.phone, `নতুন জব পোস্ট: "${title}" — আপনার এলাকায় একজন কাস্টমার খুঁজছেন। অ্যাপ খুলে বিড করুন।`);
        }
      });
  }

  return success(res, jobPost, 'জব পোস্ট হয়েছে', 201);
}

// Provider-facing feed: open job posts near the provider, optionally filtered by category
async function getNearbyJobPosts(req, res) {
  const { lat, lng, radiusKm, categoryId } = req.query;

  const jobPosts = await prisma.jobPost.findMany({
    where: { status: 'OPEN', ...(categoryId && { categoryId }) },
    include: { category: true, customer: true, bids: true },
    orderBy: { createdAt: 'desc' },
  });

  let results = jobPosts;
  if (lat && lng) {
    const providerLat = parseFloat(lat);
    const providerLng = parseFloat(lng);
    const maxRadius = radiusKm ? parseFloat(radiusKm) : 10;

    results = jobPosts
      .map((jp) => ({
        ...jp,
        distanceKm:
          jp.latitude != null && jp.longitude != null
            ? getDistanceKm(providerLat, providerLng, jp.latitude, jp.longitude)
            : null,
      }))
      .filter((jp) => jp.distanceKm === null || jp.distanceKm <= maxRadius)
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  return success(res, results);
}

// Customer's own job posts, with all bids received
async function getMyJobPosts(req, res) {
  const jobPosts = await prisma.jobPost.findMany({
    where: { customerId: req.user.id },
    include: {
      category: true,
      bids: { include: { provider: { include: { user: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return success(res, jobPosts);
}

// Provider places a bid on an open job post
async function placeBid(req, res) {
  const { jobPostId, price, message } = req.body;
  if (!jobPostId || !price) return error(res, 'jobPostId and price are required');

  const jobPost = await prisma.jobPost.findUnique({ where: { id: jobPostId } });
  if (!jobPost) return error(res, 'Job post not found', 404);
  if (jobPost.status !== 'OPEN') return error(res, 'এই জব পোস্টে আর বিড করা যাবে না');

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Create your provider profile first', 400);

  const existing = await prisma.bid.findUnique({
    where: { jobPostId_providerId: { jobPostId, providerId: profile.id } },
  });
  if (existing) return error(res, 'আপনি ইতিমধ্যে এই জবে বিড করেছেন');

  const bid = await prisma.bid.create({
    data: { jobPostId, providerId: profile.id, price, message },
  });

  const customer = await prisma.user.findUnique({ where: { id: jobPost.customerId } });
  sendPushNotification(
    customer?.fcmToken,
    'নতুন বিড এসেছে',
    `"${jobPost.title}" এর জন্য একটা নতুন বিড এসেছে`,
    { type: 'bid', jobPostId: jobPost.id, bidId: bid.id }
  );

  return success(res, bid, 'বিড জমা হয়েছে', 201);
}

// Provider's own bids
async function getMyBids(req, res) {
  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Provider profile not found', 404);

  const bids = await prisma.bid.findMany({
    where: { providerId: profile.id },
    include: { jobPost: { include: { category: true, customer: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return success(res, bids);
}

// Customer accepts a bid: marks it ACCEPTED, rejects the rest, closes the job
// post as AWARDED, and creates a real Booking so the existing booking/chat/
// payment flow takes over from here.
async function acceptBid(req, res) {
  const { bidId } = req.params;

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { jobPost: true } });
  if (!bid) return error(res, 'Bid not found', 404);
  if (bid.jobPost.customerId !== req.user.id) return error(res, 'এই জব পোস্ট আপনার নয়', 403);
  if (bid.jobPost.status !== 'OPEN') return error(res, 'এই জব পোস্ট আর খোলা নেই');

  const booking = await prisma.$transaction(async (tx) => {
    await tx.bid.update({ where: { id: bidId }, data: { status: 'ACCEPTED' } });
    await tx.bid.updateMany({
      where: { jobPostId: bid.jobPostId, id: { not: bidId } },
      data: { status: 'REJECTED' },
    });
    await tx.jobPost.update({
      where: { id: bid.jobPostId },
      data: { status: 'AWARDED', awardedBidId: bidId },
    });

    // Job-post-based bookings aren't tied to a pre-made ServiceListing, so we
    // create a lightweight placeholder listing on the fly — simplest way to
    // reuse the existing booking/chat/payment pipeline without forking it
    // just for job-post bookings.
    const placeholderListing = await tx.serviceListing.create({
      data: {
        providerId: bid.providerId,
        categoryId: bid.jobPost.categoryId,
        title: bid.jobPost.title,
        description: bid.jobPost.description,
        price: bid.price,
        photos: [],
      },
    });

    return tx.booking.create({
      data: {
        customerId: bid.jobPost.customerId,
        providerId: bid.providerId,
        listingId: placeholderListing.id,
        scheduledTime: new Date(),
        status: 'ACCEPTED',
      },
    });
  });

  const providerProfile = await prisma.providerProfile.findUnique({
    where: { id: bid.providerId },
    include: { user: true },
  });
  sendPushNotification(
    providerProfile?.user?.fcmToken,
    'বিড গৃহীত হয়েছে',
    `"${bid.jobPost.title}" এর জন্য আপনার বিড গৃহীত হয়েছে`,
    { type: 'bid_accepted', bookingId: booking.id }
  );

  return success(res, booking, 'বিড গৃহীত হয়েছে এবং বুকিং তৈরি হয়েছে');
}

module.exports = { createJobPost, getNearbyJobPosts, getMyJobPosts, placeBid, getMyBids, acceptBid };
