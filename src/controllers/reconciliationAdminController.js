const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { runReconciliation } = require('../services/reconciliation/reconciliationEngine');

// Manually trigger a reconciliation run on demand (in addition to the
// every-15-minutes cron job) — useful right after a suspected gateway/webhook
// outage, or for testing.
async function triggerReconciliation(req, res) {
  const report = await runReconciliation();
  return success(res, report, 'Reconciliation run complete');
}

// The manual review queue: every FLAGGED_MANUAL_REVIEW log not yet resolved.
async function getReconciliationQueue(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

  const where = { action: 'FLAGGED_MANUAL_REVIEW', resolvedAt: null };

  const [items, total] = await Promise.all([
    prisma.reconciliationLog.findMany({
      where,
      include: { payment: { include: { booking: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reconciliationLog.count({ where }),
  ]);

  return success(res, { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// Admin manually resolves a flagged item (after checking the gateway
// dashboard directly, for example) — clears it from the queue without the
// system auto-deciding a release/refund on its behalf.
async function resolveReconciliationItem(req, res) {
  const { id } = req.params;
  const { note } = req.body;

  const result = await prisma.reconciliationLog.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedBy: req.user.id, detail: note ? `[resolved] ${note}` : undefined },
  });
  if (result.count !== 1) return error(res, 'Item not found or already resolved', 404);

  return success(res, {}, 'সমাধান হিসেবে চিহ্নিত হয়েছে');
}

module.exports = { triggerReconciliation, getReconciliationQueue, resolveReconciliationItem };
