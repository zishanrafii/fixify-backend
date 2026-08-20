jest.mock('../../src/config/db', () => ({
  detectionRule: { findMany: jest.fn() },
  systemSetting: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  communicationPolicy: { findUnique: jest.fn() },
}));

const prisma = require('../../src/config/db');
const { evaluateMessage } = require('../../src/chat/policy/policyEngine');

describe('Communication Policy Engine', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no detection match -> ALLOW regardless of configured mode', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'phone_number', type: 'REGEX', pattern: '\\d{10}', isActive: true }]);

    const result = await evaluateMessage({ bookingId: null }, 'হ্যালো, কেমন আছেন?');
    expect(result.action).toBe('ALLOW');
    expect(prisma.communicationPolicy.findUnique).not.toHaveBeenCalled(); // never even checks mode if nothing matched
  });

  test('match + mode=OFF -> ALLOW', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'phone_number', type: 'REGEX', pattern: '\\d{10}', isActive: true }]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.communicationPolicy.findUnique.mockResolvedValue({ mode: 'OFF' });

    const result = await evaluateMessage({ bookingId: null }, 'আমার নাম্বার 0171234567');
    expect(result.action).toBe('ALLOW');
  });

  test('match + mode=WARN -> ALLOW_FLAGGED', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'phone_number', type: 'REGEX', pattern: '\\d{10}', isActive: true }]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.communicationPolicy.findUnique.mockResolvedValue({ mode: 'WARN' });

    const result = await evaluateMessage({ bookingId: null }, 'আমার নাম্বার 0171234567');
    expect(result.action).toBe('ALLOW_FLAGGED');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  test('match + mode=REVIEW -> HOLD_FOR_REVIEW', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'phone_number', type: 'REGEX', pattern: '\\d{10}', isActive: true }]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.communicationPolicy.findUnique.mockResolvedValue({ mode: 'REVIEW' });

    const result = await evaluateMessage({ bookingId: null }, 'আমার নাম্বার 0171234567');
    expect(result.action).toBe('HOLD_FOR_REVIEW');
  });

  test('match + mode=BLOCK -> BLOCK', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'phone_number', type: 'REGEX', pattern: '\\d{10}', isActive: true }]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.communicationPolicy.findUnique.mockResolvedValue({ mode: 'BLOCK' });

    const result = await evaluateMessage({ bookingId: null }, 'আমার নাম্বার 0171234567');
    expect(result.action).toBe('BLOCK');
  });

  test('resolves phase from booking status via the configurable mapping (not hardcoded)', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'email', type: 'REGEX', pattern: '@', isActive: true }]);
    prisma.booking.findUnique.mockResolvedValue({ status: 'IN_PROGRESS' });
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: { IN_PROGRESS: 'AFTER_BOOKING' } }); // custom override
    prisma.communicationPolicy.findUnique.mockResolvedValue({ mode: 'BLOCK' });

    await evaluateMessage({ bookingId: 'b1' }, 'test@test.com');

    expect(prisma.communicationPolicy.findUnique).toHaveBeenCalledWith({ where: { phase: 'AFTER_BOOKING' } });
  });

  test('an unconfigured phase fails open (ALLOW) rather than silently blocking', async () => {
    prisma.detectionRule.findMany.mockResolvedValue([{ key: 'email', type: 'REGEX', pattern: '@', isActive: true }]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.communicationPolicy.findUnique.mockResolvedValue(null); // never configured

    const result = await evaluateMessage({ bookingId: null }, 'test@test.com');
    expect(result.action).toBe('ALLOW');
  });
});
