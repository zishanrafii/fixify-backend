const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { notify } = require('../notifications/notificationEngine');
const { revokeAllUserTokens } = require('../services/tokenService');
const { getOrCreateSystemAccount, moveMoney } = require('../services/ledgerService');

// --- Dashboard ---
async function getDashboardStats(req, res) {
  const [totalUsers, totalProviders, totalBookings, completedBookings, pendingVerifications, pendingWithdrawals, openDisputes] =
    await Promise.all([
      prisma.user.count(),
      prisma.providerProfile.count(),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.user.count({
        where: { OR: [{ idVerificationStatus: 'PENDING' }, { faceVerificationStatus: 'PENDING' }] },
      }),
      prisma.walletTransaction.count({ where: { type: 'withdraw', status: 'pending' } }),
      prisma.dispute.count({ where: { status: 'OPEN' } }),
    ]);

  const revenueAgg = await prisma.payment.aggregate({
    where: { status: 'success' },
    _sum: { amount: true },
  });

  return success(res, {
    totalUsers,
    totalProviders,
    totalBookings,
    completedBookings,
    totalRevenue: revenueAgg._sum.amount || 0,
    pendingVerifications,
    pendingWithdrawals,
    openDisputes,
  });
}

// --- Users ---
async function listUsers(req, res) {
  const { role, search, page = 1, limit = 30 } = req.query;

  const users = await prisma.user.findMany({
    where: {
      ...(role && { role }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isVerified: true,
      isGuest: true,
      isSuspended: true,
      idVerificationStatus: true,
      faceVerificationStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
    take: parseInt(limit, 10),
  });

  return success(res, users);
}

// Suspend/unsuspend a user account. Suspended users are blocked at login and
// at refresh (see authController.login/emailLogin/socialLogin/refreshToken).
// On suspend, all of the user's refresh tokens are revoked immediately, so
// the only residual access window is their current access token's remaining
// life (max 15 minutes).
async function toggleUserSuspension(req, res) {
  const { id } = req.params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return error(res, 'User not found', 404);

  const updated = await prisma.user.update({
    where: { id },
    data: { isSuspended: !target.isSuspended },
  });

  if (updated.isSuspended) await revokeAllUserTokens(updated.id);

  // Keep ProviderProfile.status in sync — createBooking only allows booking
  // providers whose status is ACTIVE, so this must be kept consistent or a
  // suspended provider could keep receiving new bookings. On unsuspend,
  // only restore ACTIVE if they were actually verified — otherwise this
  // would wrongly bypass the ID/face verification gate.
  if (updated.role === 'PROVIDER') {
    if (updated.isSuspended) {
      await prisma.providerProfile.updateMany({ where: { userId: updated.id }, data: { status: 'SUSPENDED' } });
    } else {
      const isVerified = updated.idVerificationStatus === 'VERIFIED' && updated.faceVerificationStatus === 'VERIFIED';
      await prisma.providerProfile.updateMany({
        where: { userId: updated.id },
        data: { status: isVerified ? 'ACTIVE' : 'PENDING_VERIFICATION' },
      });
    }
  }

  if (updated.isSuspended) {
    notify('security.alert', updated.id, { message: 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে। এটা ভুল মনে হলে সাপোর্টে যোগাযোগ করুন।' }, { idempotencySuffix: `suspend:${updated.id}:${Date.now()}` });
  }

  return success(res, updated, updated.isSuspended ? 'ইউজার সাসপেন্ড হয়েছে' : 'ইউজার আনসাসপেন্ড হয়েছে');
}

// --- Verification review queue ---
async function listPendingVerifications(req, res) {
  const users = await prisma.user.findMany({
    where: { OR: [{ idVerificationStatus: 'PENDING' }, { faceVerificationStatus: 'PENDING' }] },
    select: {
      id: true,
      name: true,
      phone: true,
      idDocumentUrl: true,
      idVerificationStatus: true,
      faceVerificationStatus: true,
    },
  });
  return success(res, users);
}

// Once a provider has passed BOTH ID and face verification, they become
// eligible to receive bookings. This only auto-promotes from
// PENDING_VERIFICATION — it never overrides an admin's SUSPENDED/INACTIVE
// decision.
async function maybeActivateProvider(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'PROVIDER') return;
  if (user.idVerificationStatus !== 'VERIFIED' || user.faceVerificationStatus !== 'VERIFIED') return;

  await prisma.providerProfile.updateMany({
    where: { userId, status: 'PENDING_VERIFICATION' },
    data: { status: 'ACTIVE' },
  });
}

async function reviewIdVerification(req, res) {
  const { userId } = req.params;
  const { decision } = req.body; // 'VERIFIED' | 'REJECTED'
  if (!['VERIFIED', 'REJECTED'].includes(decision)) return error(res, 'decision must be VERIFIED or REJECTED');

  const user = await prisma.user.update({
    where: { id: userId },
    data: { idVerificationStatus: decision },
  });
  if (decision === 'VERIFIED') await maybeActivateProvider(userId);

  notify('account.verification', userId, {
    verificationType: 'আইডি',
    message: decision === 'VERIFIED' ? 'আপনার আইডি ভেরিফাই হয়েছে ✓' : 'আপনার আইডি ভেরিফিকেশন প্রত্যাখ্যাত হয়েছে, আবার জমা দিন',
  }, { idempotencySuffix: `id:${userId}:${decision}` });

  return success(res, user, 'রিভিউ সম্পন্ন হয়েছে');
}

async function reviewFaceVerification(req, res) {
  const { userId } = req.params;
  const { decision } = req.body;
  if (!['VERIFIED', 'REJECTED'].includes(decision)) return error(res, 'decision must be VERIFIED or REJECTED');

  const user = await prisma.user.update({
    where: { id: userId },
    data: { faceVerificationStatus: decision },
  });
  if (decision === 'VERIFIED') await maybeActivateProvider(userId);

  notify('account.verification', userId, {
    verificationType: 'ফেস',
    message: decision === 'VERIFIED' ? 'আপনার ফেস ভেরিফিকেশন সম্পন্ন হয়েছে ✓' : 'ফেস ভেরিফিকেশন প্রত্যাখ্যাত হয়েছে, আবার চেষ্টা করুন',
  }, { idempotencySuffix: `face:${userId}:${decision}` });


  return success(res, user, 'রিভিউ সম্পন্ন হয়েছে');
}

// --- Withdrawals ---
async function listPendingWithdrawals(req, res) {
  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  const withUserInfo = await Promise.all(
    withdrawals.map(async (w) => {
      const user = await prisma.user.findUnique({
        where: { id: w.userId },
        select: { id: true, name: true, phone: true },
      });
      return { ...w, user };
    })
  );

  return success(res, withUserInfo);
}

async function processWithdrawal(req, res) {
  const { transactionId } = req.params; // WithdrawalRequest id
  const { decision } = req.body; // 'PROCESSED' | 'REJECTED'
  if (!['PROCESSED', 'REJECTED'].includes(decision)) return error(res, 'decision must be PROCESSED or REJECTED');

  const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id: transactionId } });
  if (!withdrawal) return error(res, 'Withdrawal request not found', 404);

  // Guarded, atomic: only proceeds if this request is still PENDING — a
  // duplicate/concurrent decision on the same request can't double-process it.
  const claimed = await prisma.withdrawalRequest.updateMany({
    where: { id: transactionId, status: 'PENDING' },
    data: { status: decision === 'PROCESSED' ? 'COMPLETED' : 'REJECTED', processedByUserId: req.user.id, processedAt: new Date() },
  });
  if (claimed.count !== 1) return error(res, 'এই অনুরোধ ইতিমধ্যে প্রসেস হয়ে গেছে');

  const pendingAccount = await getOrCreateSystemAccount('PLATFORM_PAYOUT_PENDING');
  const idempotencyKey = `withdrawal:${withdrawal.id}:${decision === 'PROCESSED' ? 'completed' : 'rejected'}`;

  if (decision === 'PROCESSED') {
    const bankAccount = await getOrCreateSystemAccount('EXTERNAL_BANK');
    await moveMoney({
      fromAccountId: pendingAccount.id,
      toAccountId: bankAccount.id,
      amount: withdrawal.amount,
      reason: 'WITHDRAWAL_COMPLETED',
      idempotencyKey,
      metadata: { withdrawalRequestId: withdrawal.id },
    });
  } else {
    // Rejected — money goes back to the provider's wallet.
    await moveMoney({
      fromAccountId: pendingAccount.id,
      toAccountId: withdrawal.accountId,
      amount: withdrawal.amount,
      reason: 'WITHDRAWAL_REJECTED',
      idempotencyKey,
      metadata: { withdrawalRequestId: withdrawal.id },
    });
  }

  const settleLedgerTxn = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
  await prisma.withdrawalRequest.update({ where: { id: withdrawal.id }, data: { settleLedgerTxnId: settleLedgerTxn.id } });

  if (decision === 'PROCESSED') {
    notify('withdrawal.approved', withdrawal.userId, { amount: withdrawal.amount }, { idempotencySuffix: withdrawal.id });
  } else {
    notify('payment.refunded', withdrawal.userId, { amount: withdrawal.amount, withdrawalId: withdrawal.id }, { idempotencySuffix: `withdrawal-reject:${withdrawal.id}` });
  }

  return success(res, {}, decision === 'PROCESSED' ? 'উত্তোলন প্রসেস করা হয়েছে' : 'উত্তোলন প্রত্যাখ্যান করা হয়েছে ও টাকা ফেরত গেছে');
}

// --- Coupons ---
async function createCoupon(req, res) {
  const { code, discountPct, discountFlat, maxUses, expiresAt } = req.body;
  if (!code) return error(res, 'code is required');

  const coupon = await prisma.coupon.create({
    data: {
      code: code.toUpperCase(),
      discountPct,
      discountFlat,
      maxUses,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });
  return success(res, coupon, 'কুপন তৈরি হয়েছে', 201);
}

async function listCoupons(req, res) {
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  return success(res, coupons);
}

async function deleteCoupon(req, res) {
  const { id } = req.params;
  await prisma.coupon.delete({ where: { id } });
  return success(res, {}, 'কুপন মুছে ফেলা হয়েছে');
}

module.exports = {
  getDashboardStats,
  listUsers,
  toggleUserSuspension,
  listPendingVerifications,
  reviewIdVerification,
  reviewFaceVerification,
  listPendingWithdrawals,
  processWithdrawal,
  createCoupon,
  listCoupons,
  deleteCoupon,
};
