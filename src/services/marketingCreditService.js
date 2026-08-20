const { getOrCreateSystemAccount, getOrCreateUserAccount, moveMoney } = require('./ledgerService');

const MARKETING_REASONS = ['REFERRAL_BONUS', 'CASHBACK', 'PROMO_CREDIT'];

// Grants a referral bonus / cashback / promo credit to a user's wallet.
// Always draws from PLATFORM_MARKETING_POOL — never PLATFORM_REVENUE — so
// marketing spend and commission revenue stay on completely separate books
// (see docs/wallet-module-design.md financial-report requirement).
// `campaignId` is optional now but the field exists precisely so a future
// campaign/promotion system can attribute spend without a schema change.
async function grantMarketingCredit({ userId, amount, reason, idempotencyKey, campaignId, bookingId, initiatedByUserId, metadata }, tx) {
  if (!MARKETING_REASONS.includes(reason)) {
    throw new Error(`${reason} is not a valid marketing-pool reason (must be one of ${MARKETING_REASONS.join(', ')})`);
  }

  const poolAccount = await getOrCreateSystemAccount('PLATFORM_MARKETING_POOL', tx);
  const userAccount = await getOrCreateUserAccount(userId, tx);

  return moveMoney(
    { fromAccountId: poolAccount.id, toAccountId: userAccount.id, amount, reason, idempotencyKey, campaignId, bookingId, initiatedByUserId, metadata },
    tx
  );
}

module.exports = { grantMarketingCredit, MARKETING_REASONS };
