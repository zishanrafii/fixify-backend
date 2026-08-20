// Stripe integration wrapper. Covers card, Google Pay, and Apple Pay in one
// flow — the client uses Stripe's PaymentSheet (@stripe/stripe-react-native),
// which auto-detects and offers GPay/Apple Pay as wallet options alongside
// card entry, so we don't need separate integrations for each.
// Docs: https://docs.stripe.com/payments/accept-a-payment?platform=react-native

const Stripe = require('stripe');

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe credentials are not configured yet');
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

// amount in the smallest currency unit (e.g. paisa/cents). BDT isn't a
// Stripe-supported settlement currency for all account types — if targeting
// Bangladesh primarily, SSLCommerz (paymentService.js) remains the default;
// Stripe is offered as the option for customers paying in USD or another
// Stripe-supported currency.
async function createPaymentIntent({ amount, currency, bookingId }) {
  const stripe = getStripeClient();

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency || 'usd',
    metadata: { bookingId },
    automatic_payment_methods: { enabled: true }, // card + GPay + Apple Pay auto-offered
  });

  return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
}

// Verifies a Stripe webhook's signature against STRIPE_WEBHOOK_SECRET and
// returns the parsed event. Throws if the signature is missing/invalid — the
// caller must reject the request rather than trusting an unverified payload.
// `rawBody` must be the exact raw request bytes (a Buffer), not JSON-parsed.
function verifyWebhookSignature(rawBody, signatureHeader) {
  const stripe = getStripeClient();
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
}

// Looks up a PaymentIntent's current status directly from Stripe — used by
// the reconciliation job to confirm what actually happened when our own
// webhook was missed/delayed/failed to process.
async function retrievePaymentIntent(paymentIntentId) {
  const stripe = getStripeClient();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

module.exports = { createPaymentIntent, verifyWebhookSignature, retrievePaymentIntent };
