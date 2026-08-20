const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, phone: user.phone, isGuest: user.isGuest },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

// Creates a new refresh token row and returns the raw (unhashed) token to
// send to the client. Only the hash is ever persisted.
async function issueRefreshToken(userId, { ipAddress, userAgent } = {}) {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(rawToken), userId, expiresAt, ipAddress, userAgent },
  });

  return rawToken;
}

// Validates a raw refresh token, rotates it (revokes old, issues new), and
// returns the user + new raw refresh token. Throws on invalid/expired/reused.
async function rotateRefreshToken(rawToken, { ipAddress, userAgent } = {}) {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    const err = new Error('Invalid refresh token');
    err.statusCode = 401;
    throw err;
  }

  // Reuse of an already-revoked token is a strong signal of theft:
  // revoke every other active token for this user as a precaution.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const err = new Error('Refresh token has already been used. All sessions revoked for safety.');
    err.statusCode = 401;
    throw err;
  }

  if (existing.expiresAt < new Date()) {
    const err = new Error('Refresh token expired');
    err.statusCode = 401;
    throw err;
  }

  const newRawToken = crypto.randomBytes(40).toString('hex');
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const newTokenRow = await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(newRawToken),
      userId: existing.userId,
      expiresAt: newExpiresAt,
      ipAddress,
      userAgent,
    },
  });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedByTokenId: newTokenRow.id },
  });

  return { user: existing.user, rawToken: newRawToken };
}

async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Revokes every active refresh token for a user — e.g. on suspend, or a
// "log out everywhere" action.
async function revokeAllUserTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  generateAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
