jest.mock('../../src/config/db', () => ({
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
}));

process.env.JWT_SECRET = 'test-secret';

const prisma = require('../../src/config/db');
const jwt = require('jsonwebtoken');
const {
  generateAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} = require('../../src/services/tokenService');

describe('generateAccessToken', () => {
  test('signs a JWT with the expected payload and 15m expiry', () => {
    const token = generateAccessToken({ id: 'u1', role: 'CUSTOMER', phone: '01712345678', isGuest: false });
    const decoded = jwt.verify(token, 'test-secret');

    expect(decoded.id).toBe('u1');
    expect(decoded.role).toBe('CUSTOMER');
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBe(15 * 60);
  });
});

describe('issueRefreshToken', () => {
  test('creates a hashed token record and returns the raw token', async () => {
    prisma.refreshToken.create.mockResolvedValue({});

    const raw = await issueRefreshToken('u1', { ipAddress: '1.2.3.4', userAgent: 'jest' });

    expect(raw).toHaveLength(80); // 40 bytes hex-encoded
    const callArg = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(callArg.userId).toBe('u1');
    expect(callArg.tokenHash).not.toBe(raw); // never stores the raw token
    expect(callArg.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('rotateRefreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 401 when token is not found', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(rotateRefreshToken('bad-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('revokes all active tokens and throws on reuse of a revoked token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 10000), user: {},
    });
    prisma.refreshToken.updateMany.mockResolvedValue({});

    await expect(rotateRefreshToken('reused-token')).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } })
    );
  });

  test('throws 401 when token is expired', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000), user: {},
    });
    await expect(rotateRefreshToken('expired-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('rotates a valid token: revokes old, creates new, returns user + new raw token', async () => {
    const fakeUser = { id: 'u1', role: 'CUSTOMER' };
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'old-id', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 100000), user: fakeUser,
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'new-id' });
    prisma.refreshToken.update.mockResolvedValue({});

    const result = await rotateRefreshToken('valid-token');

    expect(result.user).toBe(fakeUser);
    expect(typeof result.rawToken).toBe('string');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'old-id' },
      data: expect.objectContaining({ replacedByTokenId: 'new-id' }),
    });
  });
});

describe('revokeRefreshToken / revokeAllUserTokens', () => {
  test('revokeRefreshToken revokes only the matching unrevoked token', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({});
    await revokeRefreshToken('some-token');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) })
    );
  });

  test('revokeAllUserTokens revokes every active token for a user', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({});
    await revokeAllUserTokens('u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    });
  });
});
