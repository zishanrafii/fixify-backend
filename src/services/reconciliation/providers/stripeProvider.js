const { retrievePaymentIntent } = require('../../stripeService');

// Every provider module exports the same shape: { name, checkStatus(payment) }
// so the reconciliation engine never needs to know provider-specific details.
const STATUS_MAP = {
  succeeded: 'PAID',
  processing: 'PENDING',
  requires_payment_method: 'FAILED',
  requires_confirmation: 'PENDING',
  requires_action: 'PENDING',
  canceled: 'FAILED',
};

async function checkStatus(payment) {
  if (!payment.gatewayTxnId) return { found: false, reason: 'no gatewayTxnId on record' };

  const intent = await retrievePaymentIntent(payment.gatewayTxnId);
  return {
    found: true,
    gatewayStatus: intent.status,
    normalizedStatus: STATUS_MAP[intent.status] || 'UNKNOWN',
    gatewayAmount: intent.amount / 100,
  };
}

module.exports = { name: 'STRIPE', checkStatus };
