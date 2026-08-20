const prisma = require('../../config/db');
const { getProvider } = require('./index');
const { notify } = require('../../notifications/notificationEngine');

const GRACE_PERIOD_MS = 10 * 60 * 1000; // don't touch payments younger than this — still in-flight normally
const MAX_ATTEMPTS_BEFORE_MANUAL_REVIEW = 5;
const HARD_AGE_CEILING_MS = 48 * 60 * 60 * 1000; // 48h — force manual review regardless of attempt count

async function logAction(paymentId, provider, action, { previousStatus, newStatus, gatewayStatus, detail } = {}) {
  return prisma.reconciliationLog.create({
    data: { paymentId, provider: provider || 'UNKNOWN', action, previousStatus, newStatus, gatewayStatus, detail },
  });
}

// Reconciles a single pending payment against its gateway. Idempotent: the
// underlying payment.updateMany guard (status: 'pending' -> X) only ever
// succeeds once — if a webhook or a previous reconciliation run already
// resolved this payment, this call safely no-ops (MATCHED_NO_ACTION).
// Isolated: any error here is caught by the caller so one bad payment can
// never abort reconciliation for the rest of the batch.
async function reconcilePendingPayment(payment) {
  const providerModule = getProvider(payment.provider);
  if (!providerModule) {
    await logAction(payment.id, payment.provider, 'FLAGGED_MANUAL_REVIEW', {
      previousStatus: payment.status,
      detail: `Unknown/missing provider "${payment.provider}" — cannot verify automatically`,
    });
    return { outcome: 'manual_review', payment };
  }

  let result;
  try {
    result = await providerModule.checkStatus(payment);
  } catch (err) {
    await bumpAttemptsAndMaybeFlag(payment, providerModule.name, `Gateway status check failed: ${err.message}`);
    return { outcome: 'error', payment, error: err.message };
  }

  if (!result.found) {
    await bumpAttemptsAndMaybeFlag(payment, providerModule.name, result.reason || 'Transaction not found at gateway');
    return { outcome: 'inconclusive', payment };
  }

  if (result.normalizedStatus === 'PAID') {
    // Defense in depth: don't blindly trust a status match if the amount
    // doesn't line up — that's a data-integrity smell worth a human looking
    // at, not an auto-fix.
    if (result.gatewayAmount !== undefined && Math.abs(result.gatewayAmount - payment.amount) > 0.01) {
      await logAction(payment.id, providerModule.name, 'FLAGGED_MANUAL_REVIEW', {
        previousStatus: payment.status,
        gatewayStatus: result.gatewayStatus,
        detail: `Amount mismatch: local=${payment.amount}, gateway=${result.gatewayAmount}`,
      });
      return { outcome: 'manual_review', payment };
    }

    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'escrow_held', isEscrow: true, lastReconciledAt: new Date() },
    });

    if (claimed.count !== 1) {
      // Already resolved (e.g. the webhook landed a moment ago) — safe no-op.
      await logAction(payment.id, providerModule.name, 'MATCHED_NO_ACTION', {
        previousStatus: payment.status,
        gatewayStatus: result.gatewayStatus,
        detail: 'Payment was no longer pending by the time reconciliation ran',
      });
      return { outcome: 'already_resolved', payment };
    }

    await logAction(payment.id, providerModule.name, 'MARKED_ESCROW_HELD', {
      previousStatus: 'pending',
      newStatus: 'escrow_held',
      gatewayStatus: result.gatewayStatus,
      detail: 'Gateway confirmed payment succeeded but our webhook/callback never processed it',
    });

    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (booking) {
      notify('payment.successful', booking.customerId, { amount: payment.amount, bookingId: payment.bookingId }, { idempotencySuffix: payment.bookingId });
    }

    return { outcome: 'reconciled_paid', payment };
  }

  if (result.normalizedStatus === 'FAILED') {
    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'failed', lastReconciledAt: new Date() },
    });

    await logAction(payment.id, providerModule.name, claimed.count === 1 ? 'MARKED_FAILED' : 'MATCHED_NO_ACTION', {
      previousStatus: 'pending',
      newStatus: claimed.count === 1 ? 'failed' : undefined,
      gatewayStatus: result.gatewayStatus,
      detail: 'Gateway confirmed the payment did not succeed',
    });
    return { outcome: claimed.count === 1 ? 'reconciled_failed' : 'already_resolved', payment };
  }

  // Still genuinely pending at the gateway, or a status we don't recognize.
  await bumpAttemptsAndMaybeFlag(
    payment,
    providerModule.name,
    `Gateway status: ${result.gatewayStatus || 'unknown'} (normalized: ${result.normalizedStatus})`
  );
  return { outcome: 'inconclusive', payment };
}

async function bumpAttemptsAndMaybeFlag(payment, providerName, detail) {
  const attempts = payment.reconciliationAttempts + 1;
  const isTooOld = Date.now() - payment.createdAt.getTime() > HARD_AGE_CEILING_MS;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { reconciliationAttempts: attempts, lastReconciledAt: new Date() },
  });

  if (attempts >= MAX_ATTEMPTS_BEFORE_MANUAL_REVIEW || isTooOld) {
    await logAction(payment.id, providerName, 'FLAGGED_MANUAL_REVIEW', {
      previousStatus: payment.status,
      detail: `${detail} (attempts=${attempts}, ageHrs=${Math.round((Date.now() - payment.createdAt.getTime()) / 3600000)})`,
    });
  } else {
    await logAction(payment.id, providerName, 'ERROR', { previousStatus: payment.status, detail });
  }
}

// Secondary check: a Payment stuck at escrow_held while its Booking is
// already in a terminal state, with no corresponding ledger entry — this
// should be structurally impossible going forward (release/refund now run
// in the same DB transaction as the booking-status change), but this check
// exists to catch historical data or any future regression. Never
// auto-decided (release vs refund is a business decision this job
// shouldn't make silently) — always goes to manual review.
async function findOrphanedEscrow() {
  const terminalStatuses = ['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'REJECTED', 'EXPIRED'];

  const candidates = await prisma.payment.findMany({
    where: { status: 'escrow_held', booking: { status: { in: terminalStatuses } } },
    include: { booking: true },
  });

  const orphaned = [];
  for (const payment of candidates) {
    const hasLedgerEntry = await prisma.ledgerTransaction.findFirst({
      where: { bookingId: payment.bookingId, reason: { in: ['ESCROW_RELEASE', 'REFUND'] } },
    });
    if (!hasLedgerEntry) {
      await logAction(payment.id, payment.provider, 'FLAGGED_MANUAL_REVIEW', {
        previousStatus: 'escrow_held',
        detail: `Booking is ${payment.booking.status} but no ledger entry exists — needs manual release/refund decision`,
      });
      orphaned.push(payment);
    }
  }
  return orphaned;
}

// Entry point. Safe to run concurrently/repeatedly — every write inside is
// guarded/idempotent (see reconcilePendingPayment above).
async function runReconciliation() {
  const startedAt = new Date();

  const pendingPayments = await prisma.payment.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(Date.now() - GRACE_PERIOD_MS) } },
  });

  const report = {
    startedAt,
    totalChecked: pendingPayments.length,
    reconciledPaid: [],
    reconciledFailed: [],
    manualReviewQueue: [],
    errors: [],
  };

  for (const payment of pendingPayments) {
    try {
      const { outcome } = await reconcilePendingPayment(payment);
      if (outcome === 'reconciled_paid') report.reconciledPaid.push(payment.id);
      else if (outcome === 'reconciled_failed') report.reconciledFailed.push(payment.id);
      else if (outcome === 'manual_review') report.manualReviewQueue.push(payment.id);
    } catch (err) {
      // Isolation: a completely unexpected error for one payment must never
      // stop the rest of the batch from being processed.
      report.errors.push({ paymentId: payment.id, message: err.message });
      await logAction(payment.id, payment.provider, 'ERROR', {
        previousStatus: payment.status,
        detail: `Unexpected error: ${err.message}`,
      }).catch(() => {});
    }
  }

  const orphaned = await findOrphanedEscrow().catch((err) => {
    report.errors.push({ paymentId: null, message: `orphaned-escrow scan failed: ${err.message}` });
    return [];
  });
  report.manualReviewQueue.push(...orphaned.map((p) => p.id));

  report.finishedAt = new Date();
  return report;
}

module.exports = { runReconciliation, reconcilePendingPayment, findOrphanedEscrow };
