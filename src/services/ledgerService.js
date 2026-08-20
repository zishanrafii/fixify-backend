const prisma = require('../config/db');

// Singleton system accounts (one row each, created lazily on first use).
const SYSTEM_ACCOUNT_TYPES = [
  'PLATFORM_ESCROW',
  'PLATFORM_REVENUE',
  'PLATFORM_MARKETING_POOL',
  'PLATFORM_PAYOUT_PENDING',
  'EXTERNAL_GATEWAY',
  'EXTERNAL_BANK',
];

// Only these account types are allowed to go negative — they're
// bookkeeping fictions representing the world outside our ledger (money
// "comes from" a gateway, "goes to" a bank), not a real balance anyone
// could overdraw. Every other account (user wallets, escrow, revenue,
// marketing pool, payout-pending) must never go below zero.
const UNBOUNDED_ACCOUNT_TYPES = ['EXTERNAL_GATEWAY', 'EXTERNAL_BANK'];

async function getOrCreateSystemAccount(type, tx = prisma) {
  if (!SYSTEM_ACCOUNT_TYPES.includes(type)) throw new Error(`${type} is not a singleton system account type`);

  const existing = await tx.account.findFirst({ where: { type } });
  if (existing) return existing;

  try {
    return await tx.account.create({ data: { type } });
  } catch (err) {
    // Race on first-ever creation (two concurrent requests both find none) —
    // whichever loses just re-fetches what the winner created.
    if (err.code === 'P2002') return tx.account.findFirst({ where: { type } });
    throw err;
  }
}

async function getOrCreateUserAccount(userId, tx = prisma) {
  const existing = await tx.account.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await tx.account.create({ data: { type: 'USER_WALLET', userId } });
  } catch (err) {
    if (err.code === 'P2002') return tx.account.findUnique({ where: { userId } });
    throw err;
  }
}

// The one and only way money moves in this system. Every call is:
//  - Idempotent: `idempotencyKey` is unique — a retried/duplicate call for
//    the same logical operation collides on that constraint and is treated
//    as already-done rather than double-processed.
//  - Atomic: pass a `tx` (Prisma transaction client) when composing this
//    with other writes (e.g. a booking-status transition) so they succeed
//    or fail together. Defaults to a fresh top-level transaction otherwise.
//  - Balance-safe: the source account's balance is checked and decremented
//    in one guarded conditional update — never allows a negative balance
//    except for the two EXTERNAL_* bookkeeping accounts.
//
// Returns { alreadyProcessed: true } on a duplicate call, or
// { alreadyProcessed: false, ledgerTransaction } on success.
async function moveMoney({ fromAccountId, toAccountId, amount, reason, idempotencyKey, bookingId, campaignId, initiatedByUserId, metadata }, tx = prisma) {
  if (amount <= 0) throw new Error('moveMoney amount must be positive');

  const run = async (client) => {
    let ledgerTransaction;
    try {
      ledgerTransaction = await client.ledgerTransaction.create({
        data: { idempotencyKey, fromAccountId, toAccountId, amount, reason, bookingId, campaignId, initiatedByUserId, metadata },
      });
    } catch (err) {
      if (err.code === 'P2002') return { alreadyProcessed: true }; // this exact operation already happened
      throw err;
    }

    const fromAccount = await client.account.findUnique({ where: { id: fromAccountId } });
    const guardBalance = !UNBOUNDED_ACCOUNT_TYPES.includes(fromAccount.type);

    const debit = await client.account.updateMany({
      where: { id: fromAccountId, ...(guardBalance ? { balance: { gte: amount } } : {}) },
      data: { balance: { decrement: amount } },
    });
    if (debit.count !== 1) {
      // Insufficient balance — throwing here rolls back the ledger insert
      // above too (when called within an outer $transaction) or this
      // function's own transaction (when called standalone).
      const err = new Error(`Insufficient balance on account ${fromAccountId}`);
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }

    await client.account.update({ where: { id: toAccountId }, data: { balance: { increment: amount } } });

    return { alreadyProcessed: false, ledgerTransaction };
  };

  // If the caller already handed us a transaction client, use it directly
  // (composing with their other writes). Otherwise wrap this single
  // operation in its own transaction.
  return tx === prisma ? prisma.$transaction((innerTx) => run(innerTx)) : run(tx);
}

module.exports = { getOrCreateSystemAccount, getOrCreateUserAccount, moveMoney };
