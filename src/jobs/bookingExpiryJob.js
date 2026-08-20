const cron = require('node-cron');
const prisma = require('../config/db');
const { notify } = require('../notifications/notificationEngine');
const { refundEscrowForBooking } = require('../services/walletService');

// Runs every 5 minutes: any PENDING booking whose provider-response deadline
// has passed gets moved to EXPIRED, escrow (if any) refunded, customer
// notified. Single-instance job — see docs/booking-module-design.md "Open
// Decisions" for the multi-instance (BullMQ) alternative if this backend
// ever runs as more than one process.
async function expireStaleBookings() {
  const staleBookings = await prisma.booking.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    include: { customer: true },
  });

  for (const booking of staleBookings) {
    let transitioned = false;
    let refundResult;

    await prisma.$transaction(async (tx) => {
      const result = await tx.booking.updateMany({
        where: { id: booking.id, status: 'PENDING' }, // guard against a race with acceptBooking/rejectBooking
        data: { status: 'EXPIRED' },
      });
      if (result.count !== 1) return; // someone else already transitioned it — skip

      transitioned = true;
      refundResult = await refundEscrowForBooking(booking.id, tx);
    });

    if (!transitioned) continue;

    notify('booking.expired', booking.customerId, { bookingId: booking.id }, { idempotencySuffix: booking.id });
    if (refundResult && !refundResult.alreadyProcessed) {
      notify('payment.refunded', booking.customerId, { amount: refundResult.refundedAmount, bookingId: booking.id }, { idempotencySuffix: `${booking.id}:refund` });
    }
  }

  if (staleBookings.length > 0) {
    console.log(`[bookingExpiryJob] expired ${staleBookings.length} booking(s)`);
  }
}

function startBookingExpiryJob() {
  const task = cron.schedule('*/5 * * * *', () => {
    expireStaleBookings().catch((err) => console.error('[bookingExpiryJob] failed:', err));
  });
  console.log('[bookingExpiryJob] scheduled (every 5 minutes)');
  return task; // returned so graceful shutdown can .stop() it — see server.js
}

module.exports = { startBookingExpiryJob, expireStaleBookings };
