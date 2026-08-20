const prisma = require('../config/db');
const { success } = require('../utils/responseHandler');

// GET /api/admin/audit-logs?adminUserId=&action=&targetType=&from=&to=&page=&limit=
async function listAuditLogs(req, res) {
  const { adminUserId, action, targetType, from, to } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const where = {
    ...(adminUserId && { adminUserId }),
    ...(action && { action }),
    ...(targetType && { targetType }),
    ...((from || to) && { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }),
  };

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return success(res, { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

module.exports = { listAuditLogs };
