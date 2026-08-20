const prisma = require('../config/db');

async function logAdminAction(entry) {
  try {
    await prisma.adminAuditLog.create({ data: entry });
  } catch (err) {
    console.error('[adminAuditService] failed to write audit log:', err.message, entry);
  }
}

module.exports = { logAdminAction };
