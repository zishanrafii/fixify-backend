const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { getOrCreateSystemAccount, moveMoney } = require('../services/ledgerService');
const { grantMarketingCredit, MARKETING_REASONS } = require('../services/marketingCreditService');

// Manually grant a referral bonus / cashback / promo credit — e.g. customer
// support issuing goodwill credit, or a future campaign system calling this
// programmatically. Always PLATFORM_MARKETING_POOL -> user wallet.
async function grantMarketingCreditAdmin(req, res) {
  const { userId, amount, reason, campaignId, bookingId, note } = req.body;
  if (!userId || !amount || amount <= 0) return error(res, 'userId এবং amount দিন');
  if (!MARKETING_REASONS.includes(reason)) return error(res, `reason must be one of ${MARKETING_REASONS.join(', ')}`);

  const idempotencyKey = `admin-marketing:${req.user.id}:${userId}:${Date.now()}`;

  try {
    const result = await grantMarketingCredit({
      userId, amount, reason, idempotencyKey, campaignId, bookingId,
      initiatedByUserId: req.user.id,
      metadata: { note },
    });
    return success(res, result, 'ক্রেডিট দেওয়া হয়েছে', 201);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return error(res, 'Marketing pool-এ পর্যাপ্ত ব্যালেন্স নেই');
    throw err;
  }
}

// Generic manual balance correction — always funded from PLATFORM_REVENUE,
// always requires a reason and is attributed to the admin who did it.
// Direction can be either way (credit the user, or claw back a mistaken
// credit) via a positive/negative-safe `direction` field.
async function adjustUserBalance(req, res) {
  const { userId, amount, direction, note } = req.body; // direction: 'CREDIT' | 'DEBIT'
  if (!userId || !amount || amount <= 0) return error(res, 'userId এবং amount দিন');
  if (!['CREDIT', 'DEBIT'].includes(direction)) return error(res, 'direction must be CREDIT or DEBIT');
  if (!note) return error(res, 'একটা কারণ (note) আবশ্যক — সব admin adjustment ট্র্যাক করা হয়');

  const revenueAccount = await getOrCreateSystemAccount('PLATFORM_REVENUE');
  const userAccount = await prisma.account.findUnique({ where: { userId } });
  if (!userAccount) return error(res, 'User has no wallet account yet', 404);

  const idempotencyKey = `admin-adjustment:${req.user.id}:${userId}:${Date.now()}`;

  try {
    const result = await moveMoney({
      fromAccountId: direction === 'CREDIT' ? revenueAccount.id : userAccount.id,
      toAccountId: direction === 'CREDIT' ? userAccount.id : revenueAccount.id,
      amount,
      reason: 'ADMIN_ADJUSTMENT',
      idempotencyKey,
      initiatedByUserId: req.user.id,
      metadata: { note, direction },
    });
    return success(res, result, 'সমন্বয় সম্পন্ন হয়েছে', 201);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return error(res, 'পর্যাপ্ত ব্যালেন্স নেই');
    throw err;
  }
}

// Revenue (commission) vs marketing expense, kept structurally separate —
// each is its own singleton account, so this is just two independent sums.
async function getFinancialReport(req, res) {
  const { from, to } = req.query;
  const dateFilter = {
    ...(from && { gte: new Date(from) }),
    ...(to && { lte: new Date(to) }),
  };
  const where = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

  const [revenueAccount, marketingAccount, escrowAccount] = await Promise.all([
    getOrCreateSystemAccount('PLATFORM_REVENUE'),
    getOrCreateSystemAccount('PLATFORM_MARKETING_POOL'),
    getOrCreateSystemAccount('PLATFORM_ESCROW'),
  ]);

  const [revenueEntries, marketingEntries] = await Promise.all([
    prisma.ledgerTransaction.findMany({ where: { ...where, toAccountId: revenueAccount.id, reason: 'PLATFORM_COMMISSION' } }),
    prisma.ledgerTransaction.findMany({ where: { ...where, fromAccountId: marketingAccount.id } }),
  ]);

  const totalRevenue = revenueEntries.reduce((sum, e) => sum + e.amount, 0);
  const totalMarketingExpense = marketingEntries.reduce((sum, e) => sum + e.amount, 0);

  const marketingByReason = marketingEntries.reduce((acc, e) => {
    acc[e.reason] = (acc[e.reason] || 0) + e.amount;
    return acc;
  }, {});

  return success(res, {
    period: { from: from || null, to: to || null },
    revenue: { total: totalRevenue, currentPoolBalance: revenueAccount.balance, entryCount: revenueEntries.length },
    marketingExpense: { total: totalMarketingExpense, byReason: marketingByReason, currentPoolBalance: marketingAccount.balance, entryCount: marketingEntries.length },
    escrow: { currentlyHeld: escrowAccount.balance },
    netPlatformIncome: totalRevenue - totalMarketingExpense,
  });
}

module.exports = { grantMarketingCreditAdmin, adjustUserBalance, getFinancialReport };
