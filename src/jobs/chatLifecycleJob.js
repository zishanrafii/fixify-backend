const cron = require('node-cron');
const prisma = require('../config/db');

const DEFAULT_RETENTION_DAYS = 7;
const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'REJECTED', 'EXPIRED'];

async function getRetentionDays() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'chat.retention_days' } });
  return setting ? Number(setting.value) : DEFAULT_RETENTION_DAYS;
}

async function archiveExpiredConversations() {
  const retentionDays = await getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.conversation.findMany({
    where: {
      type: 'CUSTOMER_PROVIDER',
      status: 'ACTIVE',
      booking: { status: { in: TERMINAL_STATUSES } },
    },
    include: { booking: { select: { status: true, completedAt: true, cancelledAt: true, rejectedAt: true } } },
  });

  let archivedCount = 0;
  for (const conversation of candidates) {
    const b = conversation.booking;
    const terminalAt = b.completedAt || b.cancelledAt || b.rejectedAt;
    if (!terminalAt || terminalAt > cutoff) continue;

    await prisma.conversation.updateMany({
      where: { id: conversation.id, status: 'ACTIVE' }, // guard against a race with another run
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    archivedCount++;
  }

  if (archivedCount > 0) console.log(`[chatLifecycleJob] archived ${archivedCount} conversation(s)`);
  return archivedCount;
}

function startChatLifecycleJob() {
  // Once a day is enough — retention is measured in days, not minutes.
  const task = cron.schedule('30 0 * * *', () => {
    archiveExpiredConversations().catch((err) => console.error('[chatLifecycleJob] failed:', err));
  });
  console.log('[chatLifecycleJob] scheduled (00:30 daily)');
  return task; // returned so graceful shutdown can .stop() it — see server.js
}

module.exports = { startChatLifecycleJob, archiveExpiredConversations };
