const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

const ALL_CATEGORIES = ['BOOKING', 'PAYMENT', 'WALLET', 'VERIFICATION', 'SECURITY', 'SYSTEM'];

// অ্যাপ চালু হওয়ার পর ক্লায়েন্ট এই এন্ডপয়েন্টে FCM device token পাঠাবে
async function registerDeviceToken(req, res) {
  const { fcmToken } = req.body;
  if (!fcmToken) return error(res, 'fcmToken প্রয়োজন');

  await prisma.user.update({
    where: { id: req.user.id },
    data: { fcmToken },
  });

  return success(res, {}, 'Device token registered');
}

async function getMyNotifications(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const { category, isRead } = req.query;

  const where = {
    userId: req.user.id,
    ...(category && { category }),
    ...(isRead !== undefined && { isRead: isRead === 'true' }),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ]);

  return success(res, {
    notifications,
    unreadCount,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

async function markAsRead(req, res) {
  const { id } = req.params;
  const result = await prisma.notification.updateMany({
    where: { id, userId: req.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  if (result.count !== 1) return error(res, 'Notification not found or already read', 404);
  return success(res, {}, 'পড়া হয়েছে');
}

async function markAllAsRead(req, res) {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return success(res, {}, 'সব পড়া হয়েছে');
}

async function getPreferences(req, res) {
  const existing = await prisma.notificationPreference.findMany({ where: { userId: req.user.id } });
  const byCategory = Object.fromEntries(existing.map((p) => [p.category, p]));

  const full = ALL_CATEGORIES.map((category) => byCategory[category] || {
    category,
    pushEnabled: true,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
  });

  return success(res, full);
}

async function updatePreferences(req, res) {
  const { category, pushEnabled, emailEnabled, smsEnabled, inAppEnabled } = req.body;
  if (!ALL_CATEGORIES.includes(category)) return error(res, `category must be one of ${ALL_CATEGORIES.join(', ')}`);

  if (category === 'SECURITY' && pushEnabled === false && emailEnabled === false) {
    return error(res, 'নিরাপত্তা সতর্কতার জন্য কমপক্ষে Push অথবা Email চালু রাখতে হবে');
  }

  const updated = await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: req.user.id, category } },
    update: {
      ...(pushEnabled !== undefined && { pushEnabled }),
      ...(emailEnabled !== undefined && { emailEnabled }),
      ...(smsEnabled !== undefined && { smsEnabled }),
      ...(inAppEnabled !== undefined && { inAppEnabled }),
    },
    create: {
      userId: req.user.id,
      category,
      pushEnabled: pushEnabled ?? true,
      emailEnabled: emailEnabled ?? true,
      smsEnabled: smsEnabled ?? false,
      inAppEnabled: inAppEnabled ?? true,
    },
  });

  return success(res, updated, 'প্রেফারেন্স আপডেট হয়েছে');
}

module.exports = { registerDeviceToken, getMyNotifications, markAsRead, markAllAsRead, getPreferences, updatePreferences };
