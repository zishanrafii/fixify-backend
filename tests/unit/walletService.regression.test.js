jest.mock('../../src/services/ledgerService', () => ({
  getOrCreateSystemAccount: jest.fn(),
  getOrCreateUserAccount: jest.fn(),
  moveMoney: jest.fn(),
}));

const { getOrCreateSystemAccount, getOrCreateUserAccount, moveMoney } = require('../../src/services/ledgerService');
const { releaseEscrowForBooking, refundEscrowForBooking, ensureWallet, PLATFORM_COMMISSION_PCT } = require('../../src/services/walletService');

function makeTx({ paymentUpdateManyCount, payment, providerProfile }) {
  return {
    payment: {
      updateMany: jest.fn().mockResolvedValue({ count: paymentUpdateManyCount }),
      findUnique: jest.fn().mockResolvedValue(payment),
    },
    providerProfile: { findUnique: jest.fn().mockResolvedValue(providerProfile) },
  };
}

describe('REGRESSION: walletService public API unchanged for the Booking module', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ensureWallet delegates to getOrCreateUserAccount (same exported name/shape Booking code expects)', async () => {
    getOrCreateUserAccount.mockResolvedValue({ id: 'acc1', balance: 500 });
    const wallet = await ensureWallet('u1');
    expect(wallet).toEqual({ id: 'acc1', balance: 500 }); // still has .id and .balance
  });

  test('releaseEscrowForBooking: guard is UNCHANGED — only transitions Payment escrow_held -> success', async () => {
    const tx = makeTx({
      paymentUpdateManyCount: 1,
      payment: { amount: 1000, booking: { providerId: 'pp1', customerId: 'c1' } },
      providerProfile: { userId: 'provider-user-1' },
    });
    getOrCreateSystemAccount.mockResolvedValue({ id: 'sys1' });
    getOrCreateUserAccount.mockResolvedValue({ id: 'wallet1' });
    moveMoney.mockResolvedValue({ alreadyProcessed: false });

    const result = await releaseEscrowForBooking('booking1', tx);

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking1', status: 'escrow_held' },
      data: expect.objectContaining({ status: 'success' }),
    });
    // Same return shape as before the ledger rewrite
    expect(result).toEqual({ alreadyProcessed: false, providerPayout: 900, commission: 100 });
    expect(PLATFORM_COMMISSION_PCT).toBe(10);
  });

  test('releaseEscrowForBooking: idempotent — if Payment was not escrow_held, no money moves and returns alreadyProcessed', async () => {
    const tx = makeTx({ paymentUpdateManyCount: 0, payment: null, providerProfile: null });

    const result = await releaseEscrowForBooking('booking2', tx);

    expect(result).toEqual({ alreadyProcessed: true });
    expect(moveMoney).not.toHaveBeenCalled();
  });

  test('refundEscrowForBooking: guard is UNCHANGED — only transitions Payment escrow_held -> refunded', async () => {
    const tx = makeTx({
      paymentUpdateManyCount: 1,
      payment: { amount: 500, booking: { customerId: 'c1' } },
    });
    getOrCreateSystemAccount.mockResolvedValue({ id: 'sys1' });
    getOrCreateUserAccount.mockResolvedValue({ id: 'wallet1' });
    moveMoney.mockResolvedValue({ alreadyProcessed: false });

    const result = await refundEscrowForBooking('booking3', tx);

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking3', status: 'escrow_held' },
      data: { status: 'refunded' },
    });
    expect(result).toEqual({ alreadyProcessed: false, refundedAmount: 500 });
  });

  test('refundEscrowForBooking: idempotent no-op when already refunded/never escrowed', async () => {
    const tx = makeTx({ paymentUpdateManyCount: 0, payment: null });
    const result = await refundEscrowForBooking('booking4', tx);
    expect(result).toEqual({ alreadyProcessed: true });
    expect(moveMoney).not.toHaveBeenCalled();
  });
});
