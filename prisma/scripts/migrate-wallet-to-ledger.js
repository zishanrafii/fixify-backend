// Run once after `npx prisma migrate deploy` for the Wallet Module schema
// changes: `node prisma/scripts/migrate-wallet-to-ledger.js`
//
// What this does:
//  1. Creates the six singleton system accounts.
//  2. For every legacy Wallet row, creates an Account(USER_WALLET) with the
//     SAME balance — and a single "opening balance" LedgerTransaction
//     (EXTERNAL_GATEWAY -> that account) so the new ledger balances to zero
//     from day one, without needing to perfectly replay pre-migration
//     history transaction-by-transaction.
//  3. For every legacy WalletTransaction, writes a corresponding
//     LedgerTransaction tagged `metadata.migrated=true` for historical
//     audit continuity — these do NOT affect balances (balances are already
//     seeded in step 2); they exist purely so old activity remains visible
//     in the new ledger's history view.
//  4. For every legacy PENDING withdrawal (WalletTransaction type=withdraw,
//     status=pending — whose amount was already excluded from the wallet's
//     current balance under the old system), seeds an opening-balance entry
//     into PLATFORM_PAYOUT_PENDING and creates a matching WithdrawalRequest
//     so it still shows up in the admin queue after cutover.
//
// Idempotent: every insert uses a deterministic idempotencyKey
// (`legacy:...`), so running this script twice is a safe no-op the second
// time (P2002 unique-constraint hits are caught and skipped).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SYSTEM_ACCOUNT_TYPES = [
  'PLATFORM_ESCROW',
  'PLATFORM_REVENUE',
  'PLATFORM_MARKETING_POOL',
  'PLATFORM_PAYOUT_PENDING',
  'EXTERNAL_GATEWAY',
  'EXTERNAL_BANK',
];

async function ensureSystemAccounts() {
  const accounts = {};
  for (const type of SYSTEM_ACCOUNT_TYPES) {
    let account = await prisma.account.findFirst({ where: { type } });
    if (!account) account = await prisma.account.create({ data: { type } });
    accounts[type] = account;
  }
  return accounts;
}

async function createLedgerTxnIfNew(data) {
  try {
    return await prisma.ledgerTransaction.create({ data });
  } catch (err) {
    if (err.code === 'P2002') return prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    throw err;
  }
}

async function migrate() {
  const system = await ensureSystemAccounts();
  console.log('System accounts ready.');

  const wallets = await prisma.wallet.findMany({ include: { transactions: true } });
  console.log(`Found ${wallets.length} legacy Wallet rows.`);

  let accountsCreated = 0;
  let historicalTxnsCreated = 0;
  let withdrawalsMigrated = 0;

  for (const wallet of wallets) {
    let account = await prisma.account.findUnique({ where: { userId: wallet.userId } });
    if (!account) {
      account = await prisma.account.create({ data: { type: 'USER_WALLET', userId: wallet.userId, balance: wallet.balance } });
      accountsCreated++;
    }

    // Opening balance — makes the ledger balance to zero from cutover
    // onward without replaying every historical transaction.
    if (wallet.balance !== 0) {
      await createLedgerTxnIfNew({
        idempotencyKey: `legacy-opening-balance:${wallet.id}`,
        fromAccountId: system.EXTERNAL_GATEWAY.id,
        toAccountId: account.id,
        amount: Math.abs(wallet.balance),
        reason: 'ADMIN_ADJUSTMENT',
        metadata: { migration: 'opening_balance', legacyWalletId: wallet.id },
      });
    }

    // Historical activity — audit-trail only, does not affect balance.
    for (const wt of wallet.transactions) {
      const isPendingWithdrawal = wt.type === 'withdraw' && wt.status === 'pending';

      if (isPendingWithdrawal) {
        const amount = Math.abs(wt.amount);
        const reserveTxn = await createLedgerTxnIfNew({
          idempotencyKey: `legacy-withdrawal-open:${wt.id}`,
          fromAccountId: system.EXTERNAL_GATEWAY.id,
          toAccountId: system.PLATFORM_PAYOUT_PENDING.id,
          amount,
          reason: 'ADMIN_ADJUSTMENT',
          metadata: { migration: 'pending_withdrawal_opening', legacyWalletTransactionId: wt.id },
        });

        const existingRequest = await prisma.withdrawalRequest.findFirst({ where: { reserveLedgerTxnId: reserveTxn.id } });
        if (!existingRequest) {
          await prisma.withdrawalRequest.create({
            data: {
              userId: wallet.userId,
              accountId: account.id,
              amount,
              method: 'unknown (migrated)',
              accountDetails: wt.note || 'migrated from legacy WalletTransaction — check original record',
              status: 'PENDING',
              reserveLedgerTxnId: reserveTxn.id,
            },
          });
          withdrawalsMigrated++;
        }
        continue;
      }

      // Generic historical record — best-effort from/to, archival only.
      const isOutgoing = wt.amount < 0;
      await createLedgerTxnIfNew({
        idempotencyKey: `legacy:${wt.id}`,
        fromAccountId: isOutgoing ? account.id : system.PLATFORM_ESCROW.id,
        toAccountId: isOutgoing ? system.EXTERNAL_BANK.id : account.id,
        amount: Math.abs(wt.amount),
        reason: wt.type === 'withdraw' ? 'WITHDRAWAL_COMPLETED' : 'ADMIN_ADJUSTMENT',
        metadata: { migration: 'historical_record', legacyWalletTransactionId: wt.id, originalType: wt.type, originalNote: wt.note },
      });
      historicalTxnsCreated++;
    }
  }

  console.log(`Done. Accounts created: ${accountsCreated}. Historical ledger entries: ${historicalTxnsCreated}. Pending withdrawals migrated: ${withdrawalsMigrated}.`);
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
