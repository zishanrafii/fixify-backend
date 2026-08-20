const { checkTransactionStatus } = require('../../paymentService');

const STATUS_MAP = {
  VALID: 'PAID',
  VALIDATED: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'FAILED',
  EXPIRED: 'FAILED',
  PENDING: 'PENDING',
};

async function checkStatus(payment) {
  if (!payment.gatewayTxnId) return { found: false, reason: 'no gatewayTxnId (tran_id) on record' };

  const record = await checkTransactionStatus(payment.gatewayTxnId);
  if (!record) return { found: false, reason: 'no matching transaction at SSLCommerz' };

  return {
    found: true,
    gatewayStatus: record.status,
    normalizedStatus: STATUS_MAP[record.status] || 'UNKNOWN',
    gatewayAmount: record.amount ? parseFloat(record.amount) : undefined,
  };
}

module.exports = { name: 'SSLCOMMERZ', checkStatus };
