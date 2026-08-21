const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { notify } = require('../notifications/notificationEngine');
const { releaseEscrowForBooking, refundEscrowForBooking } = require('../services/walletService');
const { getNextOccurrence } = require('../services/recurrenceService');

const PENDING_RESPONSE_WINDOW_MS = 30 * 60 * 1000; // provider must accept/reject within 30 min

const STATUS_LABEL_BN = {
  PENDING: 'অপেক্ষমান',
  ACCEPTED: 'গ্রহণ করা হয়েছে',
  REJECTED: 'প্রত্যাখ্যান করা হয়েছে',
  IN_PROGRESS: 'কাজ চলছে',
  COMPLETED: 'সম্পন্ন হয়েছে',
  CANCELLED_BY_CUSTOMER: 'গ্রাহক বাতিল করেছেন',
  CANCELLED_BY_PROVIDER: 'প্রোভাইডার বাতিল করেছেন',
  EXPIRED: 'মেয়াদ শেষ হয়ে গেছে',
  DISPUTED: 'বিরোধ চলছে',
};

// Guarded, atomic status transition: only succeeds if the booking is
// currently in `fromStatus`. Using updateMany (not update) so a concurrent
// duplicate request racing for the same transition loses cleanly instead of
// both succeeding — this is the fix for the "no state-machine enforcement"
// finding in the security review.
async function guardedTransition(bookingId, fromStatuses, data, client = prisma) {
  const result = await client.booking.updateMany({
    where: { id: bookingId, status: { in: Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses] } },
    data,
  });
  return result.count === 1;
}

// Thrown inside a prisma.$transaction callback to abort it cleanly when a
// guarded status transition loses a race — Prisma rolls back everything
// written so far in that transaction, so the booking status and any
// financial writes attempted alongside it never diverge.
class TransitionConflictError extends Error {}

async function loadBookingForParticipant(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, avatarUrl: true, referredById: true, referralBonusGranted: true } },
      provider: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      listing: true,
    },
  });
  if (!booking) return { booking: null };

  const isCustomer = booking.customerId === userId;
  const isProvider = booking.provider.userId === userId;
  if (!isCustomer && !isProvider) return { booking: null };

  return { booking, isCustomer, isProvider };
}

// Customer requests a booking. Snapshots the service address and price at
// creation time, and checks the provider is actually able to take work right
// now (ACTIVE status, not soft-deleted) — neither check existed before.
async function createBooking(req, res) {
  const { listingId, addressId, scheduledTime, bookingType, isRecurring, recurrenceRule } = req.body;

  const listing = await prisma.serviceListing.findUnique({
    where: { id: listingId },
    include: { provider: { include: { user: true } } },
  });
  if (!listing || listing.deletedAt) return error(res, 'Listing not found', 404);

  if (listing.provider.deletedAt || listing.provider.status !== 'ACTIVE') {
    return error(res, 'এই প্রোভাইডার বর্তমানে বুকিং নিচ্ছেন না', 400);
  }

  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address || address.userId !== req.user.id || address.deletedAt) {
    return error(res, 'Address not found', 404);
  }

  const booking = await prisma.booking.create({
    data: {
      customerId: req.user.id,
      providerId: listing.providerId,
      listingId: listing.id,
      scheduledTime: new Date(scheduledTime),
      bookingType: bookingType || 'SCHEDULED',
      isRecurring: !!isRecurring,
      recurrenceRule: recurrenceRule || null,
      serviceAddress: address.addressLine,
      latitude: address.latitude,
      longitude: address.longitude,
      agreedPrice: listing.price,
      expiresAt: new Date(Date.now() + PENDING_RESPONSE_WINDOW_MS),
    },
  });

  notify('booking.created', listing.provider.userId, { listingTitle: listing.title, bookingId: booking.id }, { idempotencySuffix: booking.id });

  return success(res, booking, 'বুকিং অনুরোধ পাঠানো হয়েছে', 201);
}

async function acceptBooking(req, res) {
  const { id } = req.params;
  const { booking, isProvider } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);
  if (!isProvider) return error(res, 'শুধু প্রোভাইডার বুকিং গ্রহণ করতে পারবেন', 403);

  const ok = await guardedTransition(id, 'PENDING', { status: 'ACCEPTED', acceptedAt: new Date() });
  if (!ok) return error(res, 'এই বুকিং আর গ্রহণযোগ্য অবস্থায় নেই', 409);

  notify('booking.accepted', booking.customerId, { bookingId: id }, { idempotencySuffix: id });
  return success(res, {}, 'বুকিং গ্রহণ করা হয়েছে');
}

async function rejectBooking(req, res) {
  const { id } = req.params;
  const { booking, isProvider } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);
  if (!isProvider) return error(res, 'শুধু প্রোভাইডার বুকিং প্রত্যাখ্যান করতে পারবেন', 403);

  let refundResult;
  try {
    await prisma.$transaction(async (tx) => {
      const ok = await guardedTransition(id, 'PENDING', { status: 'REJECTED', rejectedAt: new Date() }, tx);
      if (!ok) throw new TransitionConflictError();
      refundResult = await refundEscrowForBooking(id, tx);
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) return error(res, 'এই বুকিং আর প্রত্যাখ্যানযোগ্য অবস্থায় নেই', 409);
    throw err;
  }

  notify('booking.rejected', booking.customerId, { bookingId: id }, { idempotencySuffix: id });
  if (refundResult && !refundResult.alreadyProcessed) {
    notify('payment.refunded', booking.customerId, { amount: refundResult.refundedAmount, bookingId: id }, { idempotencySuffix: `${id}:refund` });
  }
  return success(res, {}, 'বুকিং প্রত্যাখ্যান করা হয়েছে');
}

async function startBooking(req, res) {
  const { id } = req.params;
  const { booking, isProvider } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);
  if (!isProvider) return error(res, 'শুধু প্রোভাইডার কাজ শুরু করতে পারবেন', 403);

  const ok = await guardedTransition(id, 'ACCEPTED', { status: 'IN_PROGRESS', startedAt: new Date() });
  if (!ok) return error(res, 'এই বুকিং শুরু করার মতো অবস্থায় নেই', 409);

  notify('booking.started', booking.customerId, { bookingId: id }, { idempotencySuffix: id });
  return success(res, {}, 'বুকিং শুরু হয়েছে');
}

// Two-step completion. Step 1 (provider): marks work done, does NOT change
// status or release escrow. Step 2 (customer): confirms, which is the only
// path that moves status to COMPLETED and releases escrow — this is the fix
// for the critical "customer could self-complete" finding.
async function providerMarkDone(req, res) {
  const { id } = req.params;
  const { booking, isProvider } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);
  if (!isProvider) return error(res, 'শুধু প্রোভাইডার কাজ শেষ চিহ্নিত করতে পারবেন', 403);

  const ok = await guardedTransition(id, 'IN_PROGRESS', { providerMarkedDoneAt: new Date() });
  if (!ok) return error(res, 'এই বুকিং এখন এই ধাপে নেই', 409);

  notify('booking.awaiting_confirmation', booking.customerId, { bookingId: id }, { idempotencySuffix: id });
  return success(res, {}, 'কাজ শেষ হিসেবে চিহ্নিত হয়েছে, গ্রাহকের কনফার্মেশনের অপেক্ষায়');
}

async function customerConfirmComplete(req, res) {
  const { id } = req.params;
  const { booking, isCustomer } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);
  if (!isCustomer) return error(res, 'শুধু গ্রাহক কাজ কনফার্ম করতে পারবেন', 403);
  if (!booking.providerMarkedDoneAt) return error(res, 'প্রোভাইডার এখনো কাজ শেষ চিহ্নিত করেননি', 400);

  let nextBookingId = null;

  try {
    await prisma.$transaction(async (tx) => {
      const ok = await guardedTransition(id, 'IN_PROGRESS', { status: 'COMPLETED', completedAt: new Date() }, tx);
      if (!ok) throw new TransitionConflictError();

      await releaseEscrowForBooking(id, tx);

      // Referral bonus: first completed booking for a referred customer.
      if (booking.customer.referredById && !booking.customer.referralBonusGranted) {
        const priorCompleted = await tx.booking.count({
          where: { customerId: booking.customerId, status: 'COMPLETED', NOT: { id } },
        });
        if (priorCompleted === 0) {
          await tx.user.update({ where: { id: booking.customerId }, data: { referralBonusGranted: true } });
        }
      }

      // Recurring booking: schedule the next occurrence.
      if (booking.isRecurring && booking.recurrenceRule) {
        const nextTime = getNextOccurrence(booking.scheduledTime, booking.recurrenceRule);
        if (nextTime) {
          const next = await tx.booking.create({
            data: {
              customerId: booking.customerId,
              providerId: booking.providerId,
              listingId: booking.listingId,
              scheduledTime: nextTime,
              bookingType: booking.bookingType,
              isRecurring: true,
              recurrenceRule: booking.recurrenceRule,
              serviceAddress: booking.serviceAddress,
              latitude: booking.latitude,
              longitude: booking.longitude,
              agreedPrice: booking.agreedPrice,
              expiresAt: new Date(nextTime.getTime() - PENDING_RESPONSE_WINDOW_MS),
            },
          });
          nextBookingId = next.id;
        }
      }
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) return error(res, 'এই বুকিং কনফার্ম করার মতো অবস্থায় নেই', 409);
    throw err;
  }

  if (nextBookingId) {
    notify('booking.recurring_created', booking.provider.userId, { bookingId: nextBookingId }, { idempotencySuffix: nextBookingId });
  }
  notify('booking.completed_provider_payout', booking.provider.userId, { bookingId: id }, { idempotencySuffix: id });
  return success(res, {}, 'বুকিং সম্পন্ন হয়েছে');
}

// Either party can cancel from PENDING/ACCEPTED (not once IN_PROGRESS —
// that requires a dispute instead). Reason is mandatory for accountability.
async function cancelBooking(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  const { booking, isCustomer, isProvider } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);

  const newStatus = isCustomer ? 'CANCELLED_BY_CUSTOMER' : 'CANCELLED_BY_PROVIDER';

  let refundResult;
  try {
    await prisma.$transaction(async (tx) => {
      const ok = await guardedTransition(id, ['PENDING', 'ACCEPTED'], {
        status: newStatus,
        cancelledAt: new Date(),
        cancelledByUserId: req.user.id,
        cancellationReason: reason,
      }, tx);
      if (!ok) throw new TransitionConflictError();
      refundResult = await refundEscrowForBooking(id, tx);
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) {
      return error(res, 'কাজ শুরু হয়ে যাওয়ায় এখন সরাসরি বাতিল করা যাবে না — ডিসপিউট খুলুন', 409);
    }
    throw err;
  }

  const notifyUserId = isCustomer ? booking.provider.userId : booking.customerId;
  notify('booking.cancelled', notifyUserId, { bookingId: id, reason }, { idempotencySuffix: id });
  if (refundResult && !refundResult.alreadyProcessed) {
    notify('payment.refunded', booking.customerId, { amount: refundResult.refundedAmount, bookingId: id }, { idempotencySuffix: `${id}:refund` });
  }
  return success(res, {}, 'বুকিং বাতিল করা হয়েছে');
}

async function rescheduleBooking(req, res) {
  const { id } = req.params;
  const { scheduledTime } = req.body;
  const { booking } = await loadBookingForParticipant(id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);

  const ok = await guardedTransition(id, ['PENDING', 'ACCEPTED'], { scheduledTime: new Date(scheduledTime) });
  if (!ok) return error(res, 'এই বুকিং আর রিশিডিউল করা যাবে না', 409);

  return success(res, {}, 'বুকিং রিশিডিউল করা হয়েছে');
}

async function getMyBookings(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const statusFilter = req.query.status;

  const where = {
    OR: [{ customerId: req.user.id }, { provider: { userId: req.user.id } }],
    ...(statusFilter && { status: statusFilter }),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
 include: {
  listing: true,
  customer: { select: { id: true, name: true, avatarUrl: true } },
  provider: {
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
},
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  // Privacy: a provider hasn't committed to a PENDING booking yet (they may
  // still reject it), so they shouldn't see the customer's exact address
  // before accepting. Once ACCEPTED (or any later status), they're doing —
  // or already did — the job and legitimately need it. The customer always
  // sees their own booking in full, regardless of status. This mirrors the
  // OR clause above: a row belongs to the requester either as customer or
  // as provider, never both, so `customerId !== req.user.id` is enough to
  // know it's the provider's row without an extra query/include.
  const sanitizedBookings = bookings.map((b) => {
    const viewerIsProvider = b.customerId !== req.user.id;
    if (viewerIsProvider && b.status === 'PENDING') {
      const { serviceAddress, latitude, longitude, ...rest } = b;
      return rest;
    }
    return b;
  });

  return success(res, {
    bookings: sanitizedBookings,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

async function getBookingById(req, res) {
  const { booking, isProvider } = await loadBookingForParticipant(req.params.id, req.user.id);
  if (!booking) return error(res, 'Booking not found', 404);

  // Same privacy rule as getMyBookings() above - see that comment.
  let responseBooking = booking;
  if (isProvider && booking.status === 'PENDING') {
    const { serviceAddress, latitude, longitude, ...rest } = booking;
    responseBooking = rest;
  }

  return success(res, { ...responseBooking, statusLabel: STATUS_LABEL_BN[booking.status] });
}

module.exports = {
  createBooking,
  acceptBooking,
  rejectBooking,
  startBooking,
  providerMarkDone,
  customerConfirmComplete,
  cancelBooking,
  rescheduleBooking,
  getMyBookings,
  getBookingById,
};
