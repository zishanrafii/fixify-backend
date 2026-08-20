jest.mock('../../src/config/db', () => ({
  notificationTemplate: { findUnique: jest.fn() },
  notification: { create: jest.fn() },
  notificationPreference: { findUnique: jest.fn() },
  notificationDeliveryLog: { create: jest.fn() },
  user: { findUnique: jest.fn() },
}));
jest.mock('../../src/queues/notificationQueues', () => ({ enqueueNotificationJob: jest.fn() }));

const prisma = require('../../src/config/db');
const { enqueueNotificationJob } = require('../../src/queues/notificationQueues');
const { notify } = require('../../src/notifications/notificationEngine');

describe('notify()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: recipient has no saved language preference -> every existing
    // test (written before Module 8's localization work) keeps getting the
    // Bengali default template, exactly as before.
    prisma.user.findUnique.mockResolvedValue(null);
  });

  test('returns null for an unknown template without throwing', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValue(null);
    const result = await notify('nonexistent.event', 'u1', {});
    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('idempotent: a duplicate idempotencyKey is a safe no-op', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValue({
      key: 'booking.accepted', category: 'BOOKING', channels: ['PUSH'], titleTemplate: 'T', bodyTemplate: 'B', isActive: true,
    });
    const err = new Error('unique violation');
    err.code = 'P2002';
    prisma.notification.create.mockRejectedValue(err);

    const result = await notify('booking.accepted', 'u1', {}, { idempotencySuffix: 'booking1' });
    expect(result).toBeNull();
    expect(enqueueNotificationJob).not.toHaveBeenCalled();
  });

  test('only enqueues channels the user has enabled', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValue({
      key: 'payment.successful', category: 'PAYMENT', channels: ['PUSH', 'EMAIL', 'SMS'], titleTemplate: 'T', bodyTemplate: 'B', isActive: true,
    });
    prisma.notification.create.mockResolvedValue({ id: 'n1' });
    prisma.notificationPreference.findUnique.mockResolvedValue({
      pushEnabled: true, emailEnabled: false, smsEnabled: false, inAppEnabled: true,
    });

    await notify('payment.successful', 'u1', { amount: 100 }, { idempotencySuffix: 'b1' });

    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    expect(enqueueNotificationJob).toHaveBeenCalledWith('push', 'n1', 0);
  });

  test('IN_APP channel logs instant delivery instead of enqueueing', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValue({
      key: 'booking.created', category: 'BOOKING', channels: ['IN_APP'], titleTemplate: 'T', bodyTemplate: 'B', isActive: true,
    });
    prisma.notification.create.mockResolvedValue({ id: 'n2' });
    prisma.notificationPreference.findUnique.mockResolvedValue(null); // defaults apply

    await notify('booking.created', 'u1', {}, { idempotencySuffix: 'b2' });

    expect(enqueueNotificationJob).not.toHaveBeenCalled();
    expect(prisma.notificationDeliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ notificationId: 'n2', channel: 'IN_APP', status: 'DELIVERED' }),
    });
  });

  test('never throws — a DB error is swallowed and returns null', async () => {
    prisma.notificationTemplate.findUnique.mockRejectedValue(new Error('DB down'));
    const result = await notify('booking.created', 'u1', {});
    expect(result).toBeNull();
  });
});
