const { Worker } = require('bullmq');
const prisma = require('../config/db');
const { connection, isQueueingEnabled, dlqQueue } = require('../queues/notificationQueues');
const { sendPushNotificationOrThrow } = require('../services/notificationService');
const { sendEmailOrThrow } = require('../services/emailService');
const { sendSMSOrThrow } = require('../services/smsService');
const { interpolate } = require('../notifications/templateEngine');

const CONCURRENCY = { push: 50, email: 10, sms: 5 };

// Channel-level idempotency: before sending, check whether a previous
// attempt for this exact (notification, channel) already succeeded. This
// covers the case where a worker crashes AFTER a successful send but
// BEFORE marking the DeliveryLog SENT — BullMQ would then retry the job,
// and without this check the user could get the same push/email/SMS twice.
async function alreadyDelivered(notificationId, channel) {
  const existing = await prisma.notificationDeliveryLog.findFirst({
    where: { notificationId, channel: channel.toUpperCase(), status: { in: ['SENT', 'DELIVERED'] } },
  });
  return !!existing;
}

async function loadNotificationWithUser(notificationId) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return null;
  const user = await prisma.user.findUnique({ where: { id: notification.userId } });
  return { notification, user };
}

async function logDelivery(notificationId, channel, attempt, status, extra = {}) {
  return prisma.notificationDeliveryLog.create({
    data: { notificationId, channel: channel.toUpperCase(), attempt, status, ...extra },
  });
}

async function processPush(job) {
  const { notificationId } = job.data;
  if (await alreadyDelivered(notificationId, 'PUSH')) return { skipped: 'already delivered' };

  const loaded = await loadNotificationWithUser(notificationId);
  if (!loaded) return { skipped: 'notification not found' };
  const { notification, user } = loaded;

  try {
    // আগে শুধু notification.data (raw template variables, যেমন bookingId) পাঠানো
    // হতো - কোন ধরনের নোটিফিকেশন সেটা বোঝার কোনো উপায় client-এর ছিল না, তাই
    // ট্যাপ করলে কখনো সঠিক জায়গায় নেভিগেট হতো না। category/templateKey যোগ করা
    // হলো যাতে অ্যাপ নির্ভরযোগ্যভাবে রুট করতে পারে (দেখুন pushNotificationService.js)।
    const pushData = { ...(notification.data || {}), category: notification.category, templateKey: notification.templateKey };
    const result = await sendPushNotificationOrThrow(user.fcmToken, notification.title, notification.body, pushData);
    await logDelivery(notificationId, 'PUSH', job.attemptsMade + 1, 'SENT', { sentAt: new Date(), providerResponse: result });
    return result;
  } catch (err) {
    if (err.code === 'STALE_TOKEN') {
      // Clear the dead token so future sends don't keep failing against it.
      await prisma.user.update({ where: { id: user.id }, data: { fcmToken: null } }).catch(() => {});
    }
    await logDelivery(notificationId, 'PUSH', job.attemptsMade + 1, 'FAILED', { errorMessage: err.message });
    throw err; // re-throw so BullMQ applies retry/backoff
  }
}

async function processEmail(job) {
  const { notificationId } = job.data;
  if (await alreadyDelivered(notificationId, 'EMAIL')) return { skipped: 'already delivered' };

  const loaded = await loadNotificationWithUser(notificationId);
  if (!loaded) return { skipped: 'notification not found' };
  const { notification, user } = loaded;

  const template = await prisma.notificationTemplate.findUnique({ where: { key: notification.templateKey } });
  const subject = interpolate(template?.emailSubjectTemplate || notification.title, notification.data || {}, { escapeHtml: true });
  const html = interpolate(template?.emailBodyTemplate || `<p>${notification.body}</p>`, notification.data || {}, { escapeHtml: true });

  try {
    const result = await sendEmailOrThrow(user.email, subject, html);
    await logDelivery(notificationId, 'EMAIL', job.attemptsMade + 1, 'SENT', { sentAt: new Date(), providerResponse: result });
    return result;
  } catch (err) {
    await logDelivery(notificationId, 'EMAIL', job.attemptsMade + 1, 'FAILED', { errorMessage: err.message });
    throw err;
  }
}

async function processSms(job) {
  const { notificationId } = job.data;
  if (await alreadyDelivered(notificationId, 'SMS')) return { skipped: 'already delivered' };

  const loaded = await loadNotificationWithUser(notificationId);
  if (!loaded) return { skipped: 'notification not found' };
  const { notification, user } = loaded;

  const template = await prisma.notificationTemplate.findUnique({ where: { key: notification.templateKey } });
  const message = interpolate(template?.smsTemplate || notification.body, notification.data || {});

  try {
    const result = await sendSMSOrThrow(user.phone, message);
    await logDelivery(notificationId, 'SMS', job.attemptsMade + 1, 'SENT', { sentAt: new Date(), providerResponse: result });
    return result;
  } catch (err) {
    await logDelivery(notificationId, 'SMS', job.attemptsMade + 1, 'FAILED', { errorMessage: err.message });
    throw err;
  }
}

const PROCESSORS = { push: processPush, email: processEmail, sms: processSms };

function startNotificationWorkers() {
  if (!isQueueingEnabled()) {
    console.warn('[notificationWorkers] Redis not configured — workers not started.');
    return [];
  }

  const workers = Object.entries(PROCESSORS).map(([channel, processor]) => {
const workerName = 'notifications-' + channel;
const worker = new Worker(workerName, processor, { connection, concurrency: CONCURRENCY[channel] });

    worker.on('failed', async (job, err) => {
      if (job.attemptsMade >= job.opts.attempts) {
        // Exhausted all retries — move to the dead-letter queue for manual review.
        await dlqQueue.add('dead-letter', { originalChannel: channel, notificationId: job.data.notificationId, lastError: err.message, failedAt: new Date() });
        await prisma.notificationDeliveryLog.updateMany({
          where: { notificationId: job.data.notificationId, channel: channel.toUpperCase() },
          data: { status: 'DEAD_LETTER' },
        }).catch(() => {});
        console.error(`[notificationWorkers] ${channel} job for notification ${job.data.notificationId} exhausted retries -> DLQ`);
      }
    });

    console.log(`[notificationWorkers] ${channel} worker started (concurrency=${CONCURRENCY[channel]})`);
    return worker;
  });

  return workers;
}

module.exports = { startNotificationWorkers };
