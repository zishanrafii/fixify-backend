const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { refundEscrowForBooking } = require('../services/walletService');
const { notify } = require('../notifications/notificationEngine');

// Customer বা provider — যেকোনো পক্ষ একটা বুকিং নিয়ে সমস্যা রিপোর্ট করতে পারেন
async function createDispute(req, res) {
  const { bookingId, reason, description } = req.body;
  if (!bookingId || !reason) return error(res, 'bookingId and reason are required');

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return error(res, 'Booking not found', 404);

  const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  const isParty = booking.customerId === req.user.id || (providerProfile && booking.providerId === providerProfile.id);
  if (!isParty) return error(res, 'আপনি এই বুকিং এর সাথে সম্পর্কিত না', 403);

  if (!['IN_PROGRESS', 'COMPLETED'].includes(booking.status)) {
    return error(res, 'শুধু চলমান বা সম্পন্ন বুকিং-এর জন্য অভিযোগ জমা দেওয়া যাবে', 400);
  }

  const existing = await prisma.dispute.findFirst({ where: { bookingId, status: 'OPEN' } });
  if (existing) return error(res, 'এই বুকিং এর জন্য ইতিমধ্যে একটা খোলা অভিযোগ আছে');

  // Booking moves to DISPUTED alongside the dispute record so its status
  // always reflects reality — previously the booking status never changed
  // when a dispute was opened, leaving it (e.g.) stuck at IN_PROGRESS even
  // with an active dispute.
  const [dispute] = await prisma.$transaction([
    prisma.dispute.create({ data: { bookingId, raisedByUserId: req.user.id, reason, description } }),
    prisma.booking.update({ where: { id: bookingId }, data: { status: 'DISPUTED' } }),
  ]);

  return success(res, dispute, 'অভিযোগ জমা হয়েছে, আমাদের টিম রিভিউ করবে', 201);
}

async function getMyDisputes(req, res) {
  const disputes = await prisma.dispute.findMany({
    where: { raisedByUserId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return success(res, disputes);
}

// --- Admin ---
async function listOpenDisputes(req, res) {
  const disputes = await prisma.dispute.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
  });

  const withContext = await Promise.all(
    disputes.map(async (d) => {
      const booking = await prisma.booking.findUnique({
        where: { id: d.bookingId },
        include: { listing: true, customer: true, provider: { include: { user: true } } },
      });
      const raisedBy = await prisma.user.findUnique({
        where: { id: d.raisedByUserId },
        select: { id: true, name: true, phone: true },
      });
      return { ...d, booking, raisedBy };
    })
  );

  return success(res, withContext);
}

// Admin resolves a dispute. If refundCustomer is true and the booking's
// payment is still in escrow, it gets refunded to the customer's wallet —
// otherwise the dispute is just closed with a note (e.g. provider was right).
async function resolveDispute(req, res) {
  const { id } = req.params;
  const { decision, resolutionNote, refundCustomer } = req.body; // decision: 'RESOLVED' | 'REJECTED'
  if (!['RESOLVED', 'REJECTED'].includes(decision)) return error(res, 'decision must be RESOLVED or REJECTED');

  const dispute = await prisma.dispute.findUnique({ where: { id } });
  if (!dispute) return error(res, 'Dispute not found', 404);

  let resolved = false;
  let refundResult;
  await prisma.$transaction(async (tx) => {
    // Guarded, atomic: only succeeds if the dispute is still OPEN, so a
    // duplicate/concurrent resolve request can't run this twice (which
    // would otherwise attempt the refund twice too).
    const result = await tx.dispute.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: decision, resolutionNote, resolvedAt: new Date() },
    });
    if (result.count !== 1) return; // already resolved by another request

    resolved = true;
    if (refundCustomer) refundResult = await refundEscrowForBooking(dispute.bookingId, tx);
  });

  if (!resolved) return error(res, 'এই অভিযোগ ইতিমধ্যে বন্ধ হয়ে গেছে');

  if (refundResult && !refundResult.alreadyProcessed) {
    const booking = await prisma.booking.findUnique({ where: { id: dispute.bookingId } });
    if (booking) {
      notify('payment.refunded', booking.customerId, { amount: refundResult.refundedAmount, bookingId: booking.id }, { idempotencySuffix: `${booking.id}:refund` });
    }
  }

  const updated = await prisma.dispute.findUnique({ where: { id } });
  return success(res, updated, 'অভিযোগ সমাধান হয়েছে');
}

module.exports = { createDispute, getMyDisputes, listOpenDisputes, resolveDispute };
