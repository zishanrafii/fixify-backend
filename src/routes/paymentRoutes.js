const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { startPayment, handleCallback, startStripePayment } = require('../controllers/paymentController');

router.post('/start', authMiddleware, startPayment);
router.post('/stripe/intent', authMiddleware, startStripePayment);

// SSLCommerz calls this directly (no JWT, it's a server-to-server/browser redirect)
router.post('/callback/:status', handleCallback);
// NOTE: the Stripe webhook (/api/payments/stripe/webhook) is mounted directly
// in app.js with a raw-body parser — Stripe signature verification needs the
// exact raw bytes, which the global express.json() would already have
// consumed/reserialized by the time it reached a route in this router.

module.exports = router;
