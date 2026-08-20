const prisma = require('../config/db');

async function recordLoginEvent(userId, provider, { ipAddress, userAgent } = {}) {
  // Audit logging must never break the login flow itself.
  try {
    await prisma.loginEvent.create({ data: { userId, provider, ipAddress, userAgent } });
  } catch (err) {
    console.error('Failed to record login audit event:', err);
  }
}

module.exports = { recordLoginEvent };
