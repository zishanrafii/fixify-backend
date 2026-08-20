const prisma = require('../config/db');
const { getOrCreateSystemAccount, getOrCreateUserAccount, moveMoney } = require('./ledgerService');

const PLATFORM_COMMISSION_PCT = 10; // MVP: flat 10% platform fee on escrow release

function round2(n) {
  return Math.round(n * 100) / 100;
}

// PUBLIC API — used by the Booking module (bookingController.js,
// disputeController.js, bookingExpiryJob.js). Signature and return shape
// are unchanged by the ledger rewrite: still resolves to an object with a
// `.balance` and `.id`, since that's all any external caller ever read.
async function ensureWallet(userId, tx = prisma) {
  return getOrCreateUserAccount(userId, tx);
}

// Booking COMPLETED (customer-confirmed) -> release escrow to the provider,
// minus platform commission. Same guarded/idempotent Payment-status
// transition as before the ledger rewrite; the money movement itself now
// goes through moveMoney (PLATFORM_ESCROW -> provider wallet, and
// PLATFORM_ESCROW -> PLATFORM_REVENUE for commission) instead of a raw
// wallet balance update.
async function releaseEscrowForBooking(bookingId, tx = prisma) {
  const claimed = await tx.payment.updateMany({
    where: { bookingId, status: 'escrow_held' },
    data: { status: 'success', escrowReleasedAt: new Date() },
  });
  if (claimed.count !== 1) return { alreadyProcessed: true };

  const payment = await tx.payment.findUnique({ where: { bookingId }, include: { booking: true } });
  const commission = round2((payment.amount * PLATFORM_COMMISSION_PCT) / 100);
  const providerPayout = round2(payment.amount - commission);

  const providerProfile = await tx.providerProfile.findUnique({ where: { id: payment.booking.providerId } });

  const escrowAccount = await getOrCreateSystemAccount('PLATFORM_ESCROW', tx);
  const revenueAccount = await getOrCreateSystemAccount('PLATFORM_REVENUE', tx);
  const providerAccount = await getOrCreateUserAccount(providerProfile.userId, tx);

  await moveMoney({
    fromAccountId: escrowAccount.id,
    toAccountId: providerAccount.id,
    amount: providerPayout,
    reason: 'ESCROW_RELEASE',
    idempotencyKey: `booking:${bookingId}:escrow_release`,
    bookingId,
    metadata: { note: `বুকিং #${bookingId.slice(0, 8)} এর পেমেন্ট` },
  }, tx);

  await moveMoney({
    fromAccountId: escrowAccount.id,
    toAccountId: revenueAccount.id,
    amount: commission,
    reason: 'PLATFORM_COMMISSION',
    idempotencyKey: `booking:${bookingId}:commission`,
    bookingId,
    metadata: { commissionPct: PLATFORM_COMMISSION_PCT },
  }, tx);

  return { alreadyProcessed: false, providerPayout, commission };
}

// Booking rejected/cancelled/expired/disputed-with-refund -> refund escrow
// to the customer. Same pattern as releaseEscrowForBooking above.
async function refundEscrowForBooking(bookingId, tx = prisma) {
  const claimed = await tx.payment.updateMany({
    where: { bookingId, status: 'escrow_held' },
    data: { status: 'refunded' },
  });
  if (claimed.count !== 1) return { alreadyProcessed: true };

  const payment = await tx.payment.findUnique({ where: { bookingId }, include: { booking: true } });

  const escrowAccount = await getOrCreateSystemAccount('PLATFORM_ESCROW', tx);
  const customerAccount = await getOrCreateUserAccount(payment.booking.customerId, tx);

  await moveMoney({
    fromAccountId: escrowAccount.id,
    toAccountId: customerAccount.id,
    amount: payment.amount,
    reason: 'REFUND',
    idempotencyKey: `booking:${bookingId}:refund`,
    bookingId,
    metadata: { note: `বুকিং #${bookingId.slice(0, 8)} বাতিল হওয়ায় রিফান্ড` },
  }, tx);

  return { alreadyProcessed: false, refundedAmount: payment.amount };
}

module.exports = {
  ensureWallet,
  releaseEscrowForBooking,
  refundEscrowForBooking,
  PLATFORM_COMMISSION_PCT,
};
