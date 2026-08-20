const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { dlqQueue, enqueueNotificationJob } = require('../queues/notificationQueues');

async function listTemplates(req, res) {
  const templates = await prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } });
  return success(res, templates);
}

async function upsertTemplate(req, res) {
  const { key } = req.params;
  const { category, channels, titleTemplate, bodyTemplate, emailSubjectTemplate, emailBodyTemplate, smsTemplate, isActive } = req.body;

  const template = await prisma.notificationTemplate.upsert({
    where: { key },
    update: {
      ...(category !== undefined && { category }),
      ...(channels !== undefined && { channels }),
      ...(titleTemplate !== undefined && { titleTemplate }),
      ...(bodyTemplate !== undefined && { bodyTemplate }),
      ...(emailSubjectTemplate !== undefined && { emailSubjectTemplate }),
      ...(emailBodyTemplate !== undefined && { emailBodyTemplate }),
      ...(smsTemplate !== undefined && { smsTemplate }),
      ...(isActive !== undefined && { isActive }),
    },
    create: { key, category, channels: channels || [], titleTemplate, bodyTemplate, emailSubjectTemplate, emailBodyTemplate, smsTemplate },
  });

  return success(res, template, 'টেমপ্লেট সেভ হয়েছে');
}

// Dead-letter queue browsing — jobs that exhausted all retry attempts.
async function getDeadLetterQueue(req, res) {
  if (!dlqQueue) return success(res, { jobs: [], note: 'Redis not configured — queueing is disabled' });

  const jobs = await dlqQueue.getJobs(['waiting', 'delayed', 'active'], 0, 100);
  const enriched = jobs.map((job) => ({ id: job.id, data: job.data, timestamp: job.timestamp }));
  return success(res, { jobs: enriched, count: enriched.length });
}

// Manually re-enqueue a dead-lettered notification for another delivery attempt.
async function retryDeadLetterItem(req, res) {
  const { id } = req.params;
  if (!dlqQueue) return error(res, 'Redis not configured — queueing is disabled', 500);

  const job = await dlqQueue.getJob(id);
  if (!job) return error(res, 'DLQ item not found', 404);

  const { originalChannel, notificationId } = job.data;
  await enqueueNotificationJob(originalChannel, notificationId, 0);
  await job.remove();

  return success(res, {}, 'পুনরায় চেষ্টা করার জন্য কিউতে যোগ হয়েছে');
}

module.exports = { listTemplates, upsertTemplate, getDeadLetterQueue, retryDeadLetterItem };
