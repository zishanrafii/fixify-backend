const stripeProvider = require('./providers/stripeProvider');
const sslcommerzProvider = require('./providers/sslcommerzProvider');

// Registry keyed by Payment.provider. To add a new gateway later: write a
// provider module exporting { name, checkStatus(payment) } in ./providers/,
// then add one line here. Nothing else in the reconciliation engine needs
// to change.
const PROVIDERS = {
  STRIPE: stripeProvider,
  SSLCOMMERZ: sslcommerzProvider,
};

function getProvider(name) {
  return PROVIDERS[name] || null;
}

module.exports = { getProvider, PROVIDERS };
