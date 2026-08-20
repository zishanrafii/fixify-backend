// SSLCommerz integration wrapper.
// Docs: https://developer.sslcommerz.com/doc/v4/
//
// This is written so that once STORE_ID/STORE_PASSWORD are set in .env,
// only the axios call in initiatePayment needs to point at the real
// SSLCommerz endpoint (sandbox vs live) to go fully live.

const axios = require('axios');

const SSLCOMMERZ_API_URL = process.env.SSLCOMMERZ_SANDBOX === 'false'
  ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php'
  : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';

async function initiatePayment({ amount, bookingId, customerName, customerPhone }) {
  const payload = {
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: amount,
    currency: 'BDT',
    tran_id: `booking_${bookingId}_${Date.now()}`,
    success_url: `${process.env.APP_BASE_URL}/api/payments/callback/success`,
    fail_url: `${process.env.APP_BASE_URL}/api/payments/callback/fail`,
    cancel_url: `${process.env.APP_BASE_URL}/api/payments/callback/cancel`,
    cus_name: customerName,
    cus_phone: customerPhone,
    cus_add1: 'N/A',
    cus_city: 'N/A',
    cus_country: 'Bangladesh',
    shipping_method: 'NO',
    product_name: 'Local Service Booking',
    product_category: 'Service',
    product_profile: 'general',
  };

  // NOTE: requires STORE_ID/STORE_PASSWORD to be configured before this will
  // actually reach SSLCommerz. Throws otherwise so the caller can fall back.
  if (!payload.store_id || !payload.store_passwd) {
    throw new Error('SSLCommerz credentials are not configured yet');
  }

  const response = await axios.post(SSLCOMMERZ_API_URL, payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return { ...response.data, tran_id: payload.tran_id }; // caller must persist tran_id right away
}

const SSLCOMMERZ_VALIDATION_API_URL = process.env.SSLCOMMERZ_SANDBOX === 'false'
  ? 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php'
  : 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';

// The success callback (POST /api/payments/callback/success) is a public,
// unauthenticated endpoint — anyone can POST to it directly and claim a
// payment succeeded. This calls SSLCommerz's own server-to-server Validation
// API to confirm the transaction genuinely happened and actually matches the
// expected amount, before the callback is allowed to move a Payment to
// escrow_held.
async function validateTransaction(valId, expectedAmount) {
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePasswd = process.env.SSLCOMMERZ_STORE_PASSWORD;
  if (!storeId || !storePasswd) throw new Error('SSLCommerz credentials are not configured yet');

  const response = await axios.get(SSLCOMMERZ_VALIDATION_API_URL, {
    params: { val_id: valId, store_id: storeId, store_passwd: storePasswd, format: 'json' },
  });

  const result = response.data;
  const isValid = result && ['VALID', 'VALIDATED'].includes(result.status);
  const amountMatches = result && Math.abs(parseFloat(result.amount) - expectedAmount) < 0.01;

  return isValid && amountMatches;
}

const SSLCOMMERZ_TRANSACTION_QUERY_API_URL = process.env.SSLCOMMERZ_SANDBOX === 'false'
  ? 'https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php'
  : 'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php';

// Looks up a transaction's status by our own tran_id (not val_id) — used by
// reconciliation for payments whose success callback never arrived, so we
// never captured a val_id for them. This is the SSLCommerz-side equivalent
// of Stripe's paymentIntents.retrieve().
async function checkTransactionStatus(tranId) {
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePasswd = process.env.SSLCOMMERZ_STORE_PASSWORD;
  if (!storeId || !storePasswd) throw new Error('SSLCommerz credentials are not configured yet');

  const response = await axios.get(SSLCOMMERZ_TRANSACTION_QUERY_API_URL, {
    params: { tran_id: tranId, store_id: storeId, store_passwd: storePasswd, format: 'json' },
  });

  // element_0 holds the (usually single) matching transaction record
  const record = response.data?.element_0;
  return record || null;
}

module.exports = { initiatePayment, validateTransaction, checkTransactionStatus };
