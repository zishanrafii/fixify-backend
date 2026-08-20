jest.mock('../../src/services/redisService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incrWithTTL: jest.fn(),
}));

const redisService = require('../../src/services/redisService');
const bcrypt = require('bcryptjs');
const { generateOTP, verifyOTP } = require('../../src/utils/otpGenerator');

describe('otpGenerator', () => {
  beforeEach(() => jest.clearAllMocks());

  test('generateOTP stores a bcrypt hash with TTL, and clears prior attempts', async () => {
    const otp = await generateOTP('01712345678');

    expect(otp).toMatch(/^\d{6}$/);
    expect(redisService.set).toHaveBeenCalledWith('otp:hash:01712345678', expect.any(String), 300);
    expect(redisService.del).toHaveBeenCalledWith('otp:attempts:01712345678');

    const storedHash = redisService.set.mock.calls[0][1];
    await expect(bcrypt.compare(otp, storedHash)).resolves.toBe(true);
  });

  test('verifyOTP returns false when no OTP is pending', async () => {
    redisService.get.mockResolvedValue(null);
    expect(await verifyOTP('01712345678', '123456')).toBe(false);
  });

  test('verifyOTP returns true for a correct OTP and clears the record', async () => {
    const hash = await bcrypt.hash('654321', 10);
    redisService.get.mockResolvedValue(hash);
    redisService.incrWithTTL.mockResolvedValue(1);

    expect(await verifyOTP('01712345678', '654321')).toBe(true);
    expect(redisService.del).toHaveBeenCalledWith('otp:hash:01712345678');
    expect(redisService.del).toHaveBeenCalledWith('otp:attempts:01712345678');
  });

  test('verifyOTP returns false for a wrong OTP without clearing the record', async () => {
    const hash = await bcrypt.hash('654321', 10);
    redisService.get.mockResolvedValue(hash);
    redisService.incrWithTTL.mockResolvedValue(1);

    expect(await verifyOTP('01712345678', '000000')).toBe(false);
    expect(redisService.del).not.toHaveBeenCalled();
  });

  test('verifyOTP burns the OTP after exceeding max attempts', async () => {
    const hash = await bcrypt.hash('654321', 10);
    redisService.get.mockResolvedValue(hash);
    redisService.incrWithTTL.mockResolvedValue(6); // over MAX_VERIFY_ATTEMPTS (5)

    expect(await verifyOTP('01712345678', '654321')).toBe(false);
    expect(redisService.del).toHaveBeenCalledWith('otp:hash:01712345678');
    expect(redisService.del).toHaveBeenCalledWith('otp:attempts:01712345678');
  });
});
