const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { ensureWallet } = require('../services/walletService');
const { getOrCreateSystemAccount, moveMoney } = require('../services/ledgerService');

async function getMyWallet(req, res) {
  const account = await ensureWallet(req.user.id);

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

  const where = { OR: [{ fromAccountId: account.id }, { toAccountId: account.id }] };
  const [transactions, total] = await Promise.all([
    prisma.ledgerTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ledgerTransaction.count({ where }),
  ]);

  // direction is relative to this account — the ledger itself has no
  // concept of "credit/debit", only from/to, so we compute it here for
  // display purposes.
  const withDirection = transactions.map((t) => ({
    ...t,
    direction: t.toAccountId === account.id ? 'credit' : 'debit',
  }));

  return success(res, {
    balance: account.balance,
    transactions: withDirection,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// প্রোভাইডার তার ওয়ালেট থেকে টাকা তোলার অনুরোধ করে। টাকা request-এর মুহূর্তেই
// wallet থেকে সরে PLATFORM_PAYOUT_PENDING account-এ "রিজার্ভ" হয়ে যায় (double-
// withdraw structurally impossible — moveMoney-র balance guard-এর কারণে)।
// অ্যাডমিন প্যানেল থেকে approve/reject হওয়া পর্যন্ত সেখানে বসে থাকে।
async function requestWithdrawal(req, res) {
  const { amount, method, accountDetails } = req.body;
  if (!amount || amount <= 0) return error(res, 'সঠিক পরিমাণ দিন');
  if (!method || !accountDetails) return error(res, 'method এবং accountDetails দিন');

  const walletAccount = await ensureWallet(req.user.id);
  const pendingAccount = await getOrCreateSystemAccount('PLATFORM_PAYOUT_PENDING');

  // Clients SHOULD send a stable `idempotencyKey` (generated once when the
  // user taps "withdraw", reused if the request is retried after a
  // timeout/network error) so a retry reuses this exact reservation instead
  // of creating a second one. Falls back to a random key if omitted — that
  // request is then simply treated as a new, distinct withdrawal request.
  const clientKey = req.body.idempotencyKey;
  const idempotencyKey = clientKey
    ? `withdrawal:${req.user.id}:${clientKey}`
    : `withdrawal:${req.user.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  let reserveResult;
  try {
    reserveResult = await moveMoney({
      fromAccountId: walletAccount.id,
      toAccountId: pendingAccount.id,
      amount,
      reason: 'WITHDRAWAL_REQUEST',
      idempotencyKey,
      metadata: { method, accountDetails },
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return error(res, 'ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই');
    throw err;
  }

  if (reserveResult.alreadyProcessed) {
    // Retry with a key we've already reserved for — return the existing
    // request instead of creating a duplicate.
    const existingLedgerTxn = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
    const existing = await prisma.withdrawalRequest.findFirst({
      where: { reserveLedgerTxnId: existingLedgerTxn.id },
    });
    return success(res, existing, 'উত্তোলনের অনুরোধ ইতিমধ্যে জমা আছে');
  }

  const withdrawalRequest = await prisma.withdrawalRequest.create({
    data: {
      userId: req.user.id,
      accountId: walletAccount.id,
      amount,
      method,
      accountDetails,
      reserveLedgerTxnId: reserveResult.ledgerTransaction.id,
    },
  });

  return success(res, withdrawalRequest, 'উত্তোলনের অনুরোধ জমা হয়েছে, প্রসেস হতে কিছুদিন সময় লাগতে পারে', 201);
}

async function getMyWithdrawals(req, res) {
  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return success(res, withdrawals);
}

module.exports = { getMyWallet, requestWithdrawal, getMyWithdrawals };
