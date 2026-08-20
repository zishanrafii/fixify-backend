const cron = require('node-cron');
const { runReconciliation } = require('../services/reconciliation/reconciliationEngine');

// Every 15 minutes: frequent enough that a missed webhook is caught well
// within the same hour, infrequent enough not to hammer gateway APIs (both
// Stripe and SSLCommerz rate-limit status-lookup endpoints). See
// docs/payment-reconciliation.md for the full scheduling/retry/monitoring
// rationale.
function startReconciliationJob() {
  const task = cron.schedule('*/15 * * * *', async () => {
    try {
      const report = await runReconciliation();
      console.log(
        `[reconciliationJob] checked=${report.totalChecked} paid=${report.reconciledPaid.length} ` +
        `failed=${report.reconciledFailed.length} manualReview=${report.manualReviewQueue.length} errors=${report.errors.length}`
      );
      if (report.manualReviewQueue.length > 0) {
        console.warn(`[reconciliationJob] ${report.manualReviewQueue.length} payment(s) need manual review:`, report.manualReviewQueue);
      }
    } catch (err) {
      console.error('[reconciliationJob] run failed entirely:', err);
    }
  });
  console.log('[reconciliationJob] scheduled (every 15 minutes)');
  return task; // returned so graceful shutdown can .stop() it — see server.js
}

module.exports = { startReconciliationJob };
