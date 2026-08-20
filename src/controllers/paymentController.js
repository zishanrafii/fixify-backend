const prisma = require('../config/db');
const { initiatePayment, validateTransaction } = require('../services/paymentService');
const { createPaymentIntent, verifyWebhookSignature } = require('../services/stripeService');
const { success, error } = require('../utils/responseHandler');
const { incrementCouponUsage, applyCouponDiscount } = require('./couponController');
const { notify } = require('../notifications/notificationEngine');

// Atomically claims the Payment row for a new payment attempt on this
// booking. Prevents the race where two concurrent "pay now" taps both pass
// a "no existing payment" check and both call the gateway, potentially
// creating two separate gateway-side transactions for one booking:
//  - If no Payment row exists yet, `create` wins outright.
//  - If a concurrent request wins that create first, this one gets a unique
//    constraint violation (P2002) and re-checks the now-existing row instead
//    of blindly proceeding.
//  - An existing row is only reusable for a new attempt if it's in a
//    non-terminal state (pending/failed) — success/escrow_held/refunded are
//    never silently overwritten.
async function claimPaymentForNewAttempt(bookingId, amount, provider) {
  try {
    return { payment: await prisma.payment.create({ data: { bookingId, amount, status: 'pending', provider } }) };
  } catch (err) {
    if (err.code !== 'P2002') throw err;
  }

  const existing = await prisma.payment.findUnique({ where: { bookingId } });
  if (existing && ['success', 'escrow_held'].includes(existing.status)) {
    return { alreadyPaid: true };
  }

  const claimed = await prisma.payment.updateMany({
    where: { bookingId, status: { in: ['pending', 'failed'] } },
    data: { amount, status: 'pending', provider },
  });
  if (claimed.count !== 1) return { alreadyPaid: true }; // lost the race to another concurrent attempt

  return { payment: await prisma.payment.findUnique({ where: { bookingId } }) };
}

// Customer initiates payment for a booking (usually after it's ACCEPTED)
async function startPayment(req, res) {
  const { bookingId, couponCode } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: true, customer: true },
  });
  if (!booking) return error(res, 'Booking not found', 404);
  if (booking.customerId !== req.user.id) {
    return error(res, 'Only the customer of this booking can pay for it', 403);
  }

  let amount = booking.listing.price;
  let appliedCoupon = null;
  if (couponCode) {
    appliedCoupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
    if (!appliedCoupon) return error(res, 'কুপন কোড পাওয়া যায়নি');
    if (appliedCoupon.expiresAt && appliedCoupon.expiresAt < new Date()) {
      return error(res, 'কুপনের মেয়াদ শেষ হয়ে গেছে');
    }
    if (appliedCoupon.maxUses && appliedCoupon.usedCount >= appliedCoupon.maxUses) {
      return error(res, 'এই কুপনের ব্যবহারসীমা শেষ হয়ে গেছে');
    }
    amount = applyCouponDiscount(amount, appliedCoupon);
  }

  const claim = await claimPaymentForNewAttempt(bookingId, amount, 'SSLCOMMERZ');
  if (claim.alreadyPaid) return error(res, 'This booking has already been paid for');

  try {
    const gatewayResponse = await initiatePayment({
      amount,
      bookingId,
      customerName: booking.customer.name,
      customerPhone: booking.customer.phone,
    });

    // Persist tran_id right away — if the success callback never arrives,
    // reconciliation still has a reference to query SSLCommerz by.
    await prisma.payment.update({ where: { bookingId }, data: { gatewayTxnId: gatewayResponse.tran_id } });

    if (appliedCoupon) await incrementCouponUsage(appliedCoupon.code);

    return success(res, { gatewayPageUrl: gatewayResponse.GatewayPageURL, amount }, 'Redirect to payment gateway');
  } catch (err) {
    return error(res, err.message || 'Failed to initiate payment', 500);
  }
}

// Alternative to SSLCommerz — for customers paying by international card,
// Google Pay, or Apple Pay via Stripe's PaymentSheet on the client.
async function startStripePayment(req, res) {
  const { bookingId, couponCode, currency } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: true },
  });
  if (!booking) return error(res, 'Booking not found', 404);
  if (booking.customerId !== req.user.id) {
    return error(res, 'Only the customer of this booking can pay for it', 403);
  }

  let amount = booking.listing.price;
  if (couponCode) {
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
    if (coupon) {
      amount = applyCouponDiscount(amount, coupon);
      await incrementCouponUsage(coupon.code);
    }
  }

  const claim = await claimPaymentForNewAttempt(bookingId, amount, 'STRIPE');
  if (claim.alreadyPaid) return error(res, 'This booking has already been paid for');

  try {
    const { clientSecret, paymentIntentId } = await createPaymentIntent({ amount, currency, bookingId });
    await prisma.payment.update({ where: { bookingId }, data: { gatewayTxnId: paymentIntentId } });

    return success(res, { clientSecret }, 'Stripe payment intent created');
  } catch (err) {
    return error(res, err.message || 'Failed to initiate Stripe payment', 500);
  }
}

// Stripe calls this when a payment intent's status changes. The webhook
// signature is verified against STRIPE_WEBHOOK_SECRET (raw body required —
// see app.js, this route is mounted before express.json()) — an unverified
// request here would let anyone move any booking's payment into escrow_held
// without ever paying, which is a direct financial-consistency hole.
async function handleStripeWebhook(req, res) {
  let event;
  try {
    event = verifyWebhookSignature(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const bookingId = event.data.object.metadata?.bookingId;
    if (bookingId) {
      // Guarded: only 'pending' -> 'escrow_held'. Stripe retries webhook
      // delivery (at-least-once), and this also stops an out-of-order/replayed
      // event from reverting an already-refunded or already-released payment
      // back into escrow.
      const claimed = await prisma.payment.updateMany({
        where: { bookingId, status: 'pending' },
        data: { status: 'escrow_held', isEscrow: true },
      }).catch((err) => { console.error('[stripe webhook] update failed:', err); return { count: 0 }; });

      if (claimed.count === 1) {
        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        const payment = await prisma.payment.findUnique({ where: { bookingId } });
        if (booking && payment) {
          notify('payment.successful', booking.customerId, { amount: payment.amount, bookingId }, { idempotencySuffix: bookingId });
        }
      }
    }
  }

  return success(res, { received: true });
}

// SSLCommerz redirects here after the customer completes payment. This is a
// public, unauthenticated endpoint — the incoming status/tran_id alone are
// NOT trusted; SSLCommerz's Validation API is called server-to-server to
// confirm the transaction genuinely happened and the amount matches, before
// any Payment status changes. Funds land in escrow (status: 'escrow_held')
// rather than being released straight away — they only reach the provider's
// wallet once the booking is marked COMPLETED (see
// walletService.releaseEscrowForBooking). This protects the customer if the
// service is never delivered.
async function handleCallback(req, res) {
  const { status } = req.params; // success | fail | cancel
  const { tran_id, val_id } = req.body || {};

  const bookingId = tran_id ? tran_id.split('_')[1] : null;
  if (!bookingId) return error(res, 'Invalid transaction reference');

  if (status !== 'success') {
    await prisma.payment.updateMany({
      where: { bookingId, status: 'pending' },
      data: { status: 'failed', gatewayTxnId: tran_id },
    }).catch(() => {});
    return success(res, {}, `Payment ${status}`);
  }

  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) return error(res, 'Payment not found', 404);

  let verified = false;
  try {
    verified = val_id ? await validateTransaction(val_id, payment.amount) : false;
  } catch (err) {
    console.error('[sslcommerz callback] validation failed:', err.message);
  }
  if (!verified) return error(res, 'Payment could not be verified', 400);

  // Guarded: only 'pending' -> 'escrow_held', same replay/out-of-order
  // protection as the Stripe webhook above.
  const claimed = await prisma.payment.updateMany({
    where: { bookingId, status: 'pending' },
    data: { status: 'escrow_held', gatewayTxnId: tran_id, isEscrow: true },
  });

  if (claimed.count === 1) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking) notify('payment.successful', booking.customerId, { amount: payment.amount, bookingId }, { idempotencySuffix: bookingId });
  }

  return success(res, {}, 'Payment escrow_held');
}

module.exports = { startPayment, handleCallback, startStripePayment, handleStripeWebhook };
