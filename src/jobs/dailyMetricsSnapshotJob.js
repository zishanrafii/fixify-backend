const cron = require('node-cron');
const prisma = require('../config/db');

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function computeSnapshotForDate(targetDate) {
  const dayStart = startOfDay(targetDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const thirtyDaysBeforeEnd = new Date(dayEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers, activeUsers, totalProviders, activeProviders, pendingVerifications,
    totalBookings, completedBookings, cancelledBookings,
    revenueAgg, refundAgg, newUsers, newProviders,
  ] = await Promise.all([
    prisma.user.count({ where: { role: { in: ['CUSTOMER', 'PROVIDER'] }, createdAt: { lt: dayEnd } } }),
    prisma.loginEvent.findMany({ where: { createdAt: { gte: thirtyDaysBeforeEnd, lt: dayEnd } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
    prisma.providerProfile.count({ where: { createdAt: { lt: dayEnd } } }),
    prisma.providerProfile.count({ where: { status: 'ACTIVE', createdAt: { lt: dayEnd } } }),
    prisma.user.count({ where: { OR: [{ idVerificationStatus: 'PENDING' }, { faceVerificationStatus: 'PENDING' }], createdAt: { lt: dayEnd } } }),
    prisma.booking.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.booking.count({ where: { status: 'COMPLETED', completedAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.booking.count({ where: { status: { in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'EXPIRED'] }, cancelledAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.ledgerTransaction.aggregate({ where: { reason: 'PLATFORM_COMMISSION', createdAt: { gte: dayStart, lt: dayEnd } }, _sum: { amount: true } }),
    prisma.ledgerTransaction.aggregate({ where: { reason: 'REFUND', createdAt: { gte: dayStart, lt: dayEnd } }, _sum: { amount: true } }),
    prisma.user.count({ where: { role: { in: ['CUSTOMER', 'PROVIDER'] }, createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.providerProfile.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
  ]);

  // Revenue = total booking value that day (agreedPrice sum for COMPLETED),
  // commission = the platform's cut of that (already computed above).
  const completedThatDayAgg = await prisma.booking.aggregate({
    where: { status: 'COMPLETED', completedAt: { gte: dayStart, lt: dayEnd } },
    _sum: { agreedPrice: true },
  });

  return prisma.dailyMetricsSnapshot.upsert({
    where: { date: dayStart },
    update: {
      totalUsers, activeUsers, totalProviders, activeProviders, pendingVerifications,
      totalBookings, completedBookings, cancelledBookings,
      revenue: completedThatDayAgg._sum.agreedPrice || 0,
      commission: revenueAgg._sum.amount || 0,
      refundAmount: refundAgg._sum.amount || 0,
      newUsers, newProviders,
    },
    create: {
      date: dayStart, totalUsers, activeUsers, totalProviders, activeProviders, pendingVerifications,
      totalBookings, completedBookings, cancelledBookings,
      revenue: completedThatDayAgg._sum.agreedPrice || 0,
      commission: revenueAgg._sum.amount || 0,
      refundAmount: refundAgg._sum.amount || 0,
      newUsers, newProviders,
    },
  });
}

function startDailyMetricsSnapshotJob() {
  // Runs at 00:15 every day, computing the snapshot for the day that just ended.
  const task = cron.schedule('15 0 * * *', async () => {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const snapshot = await computeSnapshotForDate(yesterday);
      console.log(`[dailyMetricsSnapshotJob] snapshot computed for ${snapshot.date.toISOString().slice(0, 10)}`);
    } catch (err) {
      console.error('[dailyMetricsSnapshotJob] failed:', err);
    }
  });
  console.log('[dailyMetricsSnapshotJob] scheduled (00:15 daily)');
  return task; // returned so graceful shutdown can .stop() it — see server.js
}

module.exports = { startDailyMetricsSnapshotJob, computeSnapshotForDate };
