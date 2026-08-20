const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { notify } = require('../notifications/notificationEngine');

async function listSettings(req, res) {
  const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  return success(res, settings);
}

// PUT /api/admin/settings/:key { value, description? }
async function upsertSetting(req, res) {
  const { key } = req.params;
  const { value, description } = req.body;
  if (value === undefined) return error(res, 'value প্রয়োজন');

  const setting = await prisma.systemSetting.upsert({
    where: { key },
    update: { value, ...(description !== undefined && { description }), updatedByUserId: req.user.id },
    create: { key, value, description, updatedByUserId: req.user.id },
  });

  return success(res, setting, 'সেটিং সেভ হয়েছে');
}

// POST /api/admin/broadcast { userIds?: [...], role?: 'CUSTOMER'|'PROVIDER', title, body }
// Bulk fan-out — inserts one Notification per recipient. For a very large
// audience (all customers, say), this loop is the naive version; the
// Notification Module's scalability review already flagged bulk-insert +
// bulk-enqueue as a future need for broadcast-style sends — this satisfies
// the immediate requirement without over-building ahead of actual scale.
async function sendBroadcast(req, res) {
  const { userIds, role, title, body } = req.body;
  if (!title || !body) return error(res, 'title ও body প্রয়োজন');
  if (!userIds && !role) return error(res, 'userIds অথবা role — কাকে পাঠানো হবে বলুন');

  const recipients = userIds
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })
    : await prisma.user.findMany({ where: { role }, select: { id: true } });

  const broadcastId = `broadcast:${Date.now()}`;
  let sent = 0;
  for (const recipient of recipients) {
    const result = await notify('system.broadcast', recipient.id, { title, message: body }, { idempotencySuffix: `${broadcastId}:${recipient.id}` });
    if (result) sent++;
  }

  return success(res, { targeted: recipients.length, sent }, 'ব্রডকাস্ট পাঠানো হয়েছে');
}

module.exports = { listSettings, upsertSetting, sendBroadcast };
