jest.mock('../../src/config/db', () => ({
  account: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  ledgerTransaction: { create: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn((cb) => cb(require('../../src/config/db'))),
}));

const prisma = require('../../src/config/db');
const { getOrCreateSystemAccount, getOrCreateUserAccount, moveMoney } = require('../../src/services/ledgerService');

describe('getOrCreateSystemAccount', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns existing singleton account if present', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 'acc1', type: 'PLATFORM_ESCROW' });
    const account = await getOrCreateSystemAccount('PLATFORM_ESCROW', prisma);
    expect(account.id).toBe('acc1');
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  test('creates the account if none exists', async () => {
    prisma.account.findFirst.mockResolvedValue(null);
    prisma.account.create.mockResolvedValue({ id: 'acc2', type: 'PLATFORM_REVENUE' });
    const account = await getOrCreateSystemAccount('PLATFORM_REVENUE', prisma);
    expect(account.id).toBe('acc2');
  });

  test('rejects a non-singleton type', async () => {
    await expect(getOrCreateSystemAccount('USER_WALLET', prisma)).rejects.toThrow();
  });
});

describe('getOrCreateUserAccount', () => {
  beforeEach(() => jest.clearAllMocks());

  test('race-safe: P2002 on create falls back to a re-fetch', async () => {
    prisma.account.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'acc3', userId: 'u1' });
    const err = new Error('unique violation');
    err.code = 'P2002';
    prisma.account.create.mockRejectedValue(err);

    const account = await getOrCreateUserAccount('u1', prisma);
    expect(account.id).toBe('acc3');
  });
});

describe('moveMoney', () => {
  beforeEach(() => jest.clearAllMocks());

  test('idempotent: a duplicate idempotencyKey returns alreadyProcessed without moving balances', async () => {
    const err = new Error('unique violation');
    err.code = 'P2002';
    prisma.ledgerTransaction.create.mockRejectedValue(err);

    const result = await moveMoney({ fromAccountId: 'a', toAccountId: 'b', amount: 100, reason: 'REFUND', idempotencyKey: 'k1' });
    expect(result.alreadyProcessed).toBe(true);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  test('rejects a non-positive amount before touching the DB', async () => {
    await expect(moveMoney({ fromAccountId: 'a', toAccountId: 'b', amount: 0, reason: 'REFUND', idempotencyKey: 'k2' }))
      .rejects.toThrow('positive');
    expect(prisma.ledgerTransaction.create).not.toHaveBeenCalled();
  });

  test('throws INSUFFICIENT_BALANCE when the guarded debit matches zero rows', async () => {
    prisma.ledgerTransaction.create.mockResolvedValue({ id: 'lt1' });
    prisma.account.findUnique.mockResolvedValue({ id: 'a', type: 'USER_WALLET', balance: 10 });
    prisma.account.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      moveMoney({ fromAccountId: 'a', toAccountId: 'b', amount: 500, reason: 'WITHDRAWAL_REQUEST', idempotencyKey: 'k3' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  test('EXTERNAL_* accounts skip the balance guard (allowed to go negative)', async () => {
    prisma.ledgerTransaction.create.mockResolvedValue({ id: 'lt2' });
    prisma.account.findUnique.mockResolvedValue({ id: 'gw', type: 'EXTERNAL_GATEWAY', balance: -1000 });
    prisma.account.updateMany.mockResolvedValue({ count: 1 });
    prisma.account.update.mockResolvedValue({});

    const result = await moveMoney({ fromAccountId: 'gw', toAccountId: 'b', amount: 500, reason: 'PAYMENT_CAPTURED', idempotencyKey: 'k4' });
    expect(result.alreadyProcessed).toBe(false);
    // no `balance: { gte: amount }` guard should have been applied for an unbounded account
    const call = prisma.account.updateMany.mock.calls[0][0];
    expect(call.where.balance).toBeUndefined();
  });

  test('succeeds and credits the destination account', async () => {
    prisma.ledgerTransaction.create.mockResolvedValue({ id: 'lt3' });
    prisma.account.findUnique.mockResolvedValue({ id: 'a', type: 'USER_WALLET', balance: 1000 });
    prisma.account.updateMany.mockResolvedValue({ count: 1 });
    prisma.account.update.mockResolvedValue({});

    const result = await moveMoney({ fromAccountId: 'a', toAccountId: 'b', amount: 200, reason: 'ESCROW_RELEASE', idempotencyKey: 'k5' });
    expect(result.alreadyProcessed).toBe(false);
    expect(prisma.account.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { balance: { increment: 200 } } });
  });
});
