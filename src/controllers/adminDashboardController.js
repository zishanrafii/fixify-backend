const prisma = require('../config/db');
const { success } = require('../utils/responseHandler');
const redisService = require('../services/redisService');

const LIVE_CACHE_TTL = 60; // seconds
const HEAVY_CACHE_TTL = 60 * 60; // 1 hour, for expensive aggregations

async function cached(key, ttlSeconds, compute) {
  const hit = await redisService.get(key);
  if (hit) return JSON.parse(hit);
  const value = await compute();
  await redisService.set(key, JSON.stringify(value), ttlSeconds);
  return value;
}

// GET /api/admin/dashboard/overview — the live counters from requirement 2.
async function getOverview(req, res) {
  const overview = await cached('admin:dashboard:overview', LIVE_CACHE_TTL, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, activeUsers, totalProviders, activeProviders, pendingVerifications,
      totalBookings, completedBookings, cancelledBookings,
      revenueAgg, commissionAgg, escrowAgg, refundAgg,
      pendingWithdrawals, failedPayments, notificationStats,
    ] = await Promise.all([
      prisma.user.count({ where: { role: { in: ['CUSTOMER', 'PROVIDER'] } } }),
      prisma.loginEvent.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
      prisma.providerProfile.count(),
      prisma.providerProfile.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { OR: [{ idVerificationStatus: 'PENDING' }, { faceVerificationStatus: 'PENDING' }] } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.booking.count({ where: { status: { in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'EXPIRED'] } } }),
      prisma.ledgerTransaction.aggregate({ where: { reason: 'PLATFORM_COMMISSION' }, _sum: { amount: true } }),
      prisma.ledgerTransaction.aggregate({ where: { reason: 'PLATFORM_COMMISSION' }, _sum: { amount: true } }),
      prisma.account.findFirst({ where: { type: 'PLATFORM_ESCROW' } }),
      prisma.ledgerTransaction.aggregate({ where: { reason: 'REFUND' }, _sum: { amount: true } }),
      prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
      prisma.payment.count({ where: { status: 'failed' } }),
      prisma.notificationDeliveryLog.groupBy({ by: ['status'], _count: { status: true } }),
    ]);

    return {
      totalUsers, activeUsers, totalProviders, activeProviders, pendingVerifications,
      totalBookings, completedBookings, cancelledBookings,
      revenue: revenueAgg._sum.amount || 0,
      commission: commissionAgg._sum.amount || 0,
      walletBalance: null, // sum of all USER_WALLET balances — expensive; see /analytics/wallet-summary if needed later
      escrowBalance: escrowAgg ? escrowAgg.balance : 0,
      refundAmount: refundAgg._sum.amount || 0,
      pendingWithdrawals,
      failedPayments,
      notificationStats: Object.fromEntries(notificationStats.map((s) => [s.status, s._count.status])),
    };
  });

  return success(res, overview);
}

function periodBounds(period, from, to) {
  const end = to ? new Date(to) : new Date();
  let start;
  if (from) start = new Date(from);
  else if (period === 'weekly') start = new Date(end.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  else if (period === 'monthly') start = new Date(end.getTime() - 12 * 30 * 24 * 60 * 60 * 1000);
  else start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // daily default: last 30 days
  return { start, end };
}

// GET /api/admin/analytics/revenue?period=daily|weekly|monthly&from=&to=
async function getRevenueAnalytics(req, res) {
  const { period = 'daily', from, to } = req.query;
  const { start, end } = periodBounds(period, from, to);

  const snapshots = await prisma.dailyMetricsSnapshot.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: 'asc' },
  });

  return success(res, {
    period,
    series: snapshots.map((s) => ({ date: s.date, revenue: s.revenue, commission: s.commission, refundAmount: s.refundAmount })),
    note: snapshots.length === 0 ? 'কোনো snapshot নেই এই রেঞ্জে — nightly job না চললে খালি থাকবে' : undefined,
  });
}

// GET /api/admin/analytics/bookings/trends
async function getBookingTrends(req, res) {
  const { from, to } = req.query;
  const { start, end } = periodBounds('daily', from, to);

  const snapshots = await prisma.dailyMetricsSnapshot.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: 'asc' },
  });

  return success(res, {
    series: snapshots.map((s) => ({
      date: s.date, totalBookings: s.totalBookings, completedBookings: s.completedBookings, cancelledBookings: s.cancelledBookings,
    })),
  });
}

// GET /api/admin/analytics/users/growth
async function getUserGrowth(req, res) {
  const { from, to } = req.query;
  const { start, end } = periodBounds('daily', from, to);
  const snapshots = await prisma.dailyMetricsSnapshot.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } });
  return success(res, { series: snapshots.map((s) => ({ date: s.date, newUsers: s.newUsers, totalUsers: s.totalUsers })) });
}

// GET /api/admin/analytics/providers/growth
async function getProviderGrowth(req, res) {
  const { from, to } = req.query;
  const { start, end } = periodBounds('daily', from, to);
  const snapshots = await prisma.dailyMetricsSnapshot.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } });
  return success(res, { series: snapshots.map((s) => ({ date: s.date, newProviders: s.newProviders, totalProviders: s.totalProviders })) });
}

// GET /api/admin/analytics/categories/performance
async function getCategoryPerformance(req, res) {
  const data = await cached('admin:analytics:categories', HEAVY_CACHE_TTL, async () => {
    const listings = await prisma.serviceListing.findMany({
      where: { deletedAt: null },
      select: { categoryId: true, category: { select: { name: true } }, bookings: { select: { status: true, agreedPrice: true } } },
    });

    const byCategory = {};
    for (const listing of listings) {
      const key = listing.category.name;
      if (!byCategory[key]) byCategory[key] = { category: key, totalBookings: 0, completedBookings: 0, revenue: 0 };
      for (const b of listing.bookings) {
        byCategory[key].totalBookings++;
        if (b.status === 'COMPLETED') {
          byCategory[key].completedBookings++;
          byCategory[key].revenue += b.agreedPrice;
        }
      }
    }
    return Object.values(byCategory).sort((a, b) => b.revenue - a.revenue);
  });

  return success(res, data);
}

// GET /api/admin/analytics/cities
// NOTE: approximated via each customer's default saved Address.city, since
// Booking itself doesn't snapshot a city (it only snapshots addressLine/
// lat/lng — adding a city snapshot there is a Booking Module change, out of
// scope while frozen). See docs/admin-dashboard-module-design.md.
async function getCityAnalytics(req, res) {
  const data = await cached('admin:analytics:cities', HEAVY_CACHE_TTL, async () => {
    const bookings = await prisma.booking.findMany({
      where: { status: 'COMPLETED' },
      select: { agreedPrice: true, customer: { select: { addresses: { where: { isDefault: true, deletedAt: null }, select: { city: true }, take: 1 } } } },
    });

    const byCity = {};
    for (const b of bookings) {
      const city = b.customer.addresses[0]?.city || 'Unknown';
      if (!byCity[city]) byCity[city] = { city, completedBookings: 0, revenue: 0 };
      byCity[city].completedBookings++;
      byCity[city].revenue += b.agreedPrice;
    }
    return Object.values(byCity).sort((a, b) => b.revenue - a.revenue);
  });

  return success(res, data);
}

// GET /api/admin/analytics/providers/top
async function getTopProviders(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const data = await cached(`admin:analytics:top-providers:${limit}`, HEAVY_CACHE_TTL, async () => {
    const grouped = await prisma.booking.groupBy({
      by: ['providerId'],
      where: { status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { agreedPrice: true },
      orderBy: { _sum: { agreedPrice: 'desc' } },
      take: limit,
    });

    const providerIds = grouped.map((g) => g.providerId);
    const profiles = await prisma.providerProfile.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, user: { select: { name: true } }, avgRating: true },
    });
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));

    return grouped.map((g) => ({
      providerId: g.providerId,
      name: byId[g.providerId]?.user?.name || 'Unknown',
      avgRating: byId[g.providerId]?.avgRating || 0,
      completedBookings: g._count._all,
      revenue: g._sum.agreedPrice || 0,
    }));
  });

  return success(res, data);
}

// GET /api/admin/analytics/retention — % of customers with 2+ completed bookings
async function getRetention(req, res) {
  const data = await cached('admin:analytics:retention', HEAVY_CACHE_TTL, async () => {
    const grouped = await prisma.booking.groupBy({
      by: ['customerId'],
      where: { status: 'COMPLETED' },
      _count: { _all: true },
    });
    const totalCustomers = grouped.length;
    const repeatCustomers = grouped.filter((g) => g._count._all >= 2).length;
    return {
      totalCustomersWithBooking: totalCustomers,
      repeatCustomers,
      retentionRate: totalCustomers ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100 : 0,
    };
  });

  return success(res, data);
}

// GET /api/admin/analytics/repeat-booking-rate — same customer, same provider, 2+ times
async function getRepeatBookingRate(req, res) {
  const data = await cached('admin:analytics:repeat-booking-rate', HEAVY_CACHE_TTL, async () => {
    const grouped = await prisma.booking.groupBy({
      by: ['customerId', 'providerId'],
      where: { status: 'COMPLETED' },
      _count: { _all: true },
    });
    const totalPairs = grouped.length;
    const repeatPairs = grouped.filter((g) => g._count._all >= 2).length;
    return {
      totalCustomerProviderPairs: totalPairs,
      repeatPairs,
      repeatBookingRate: totalPairs ? Math.round((repeatPairs / totalPairs) * 10000) / 100 : 0,
    };
  });

  return success(res, data);
}

module.exports = {
  getOverview, getRevenueAnalytics, getBookingTrends, getUserGrowth, getProviderGrowth,
  getCategoryPerformance, getCityAnalytics, getTopProviders, getRetention, getRepeatBookingRate,
};
