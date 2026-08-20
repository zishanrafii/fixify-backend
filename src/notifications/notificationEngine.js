const prisma = require('../config/db');
const { interpolate } = require('./templateEngine');
const { enqueueNotificationJob } = require('../queues/notificationQueues');

const DEFAULT_PREFERENCE = { pushEnabled: true, emailEnabled: true, smsEnabled: false, inAppEnabled: true };

async function getEffectivePreference(userId, category) {
  const pref = await prisma.notificationPreference.findUnique({ where: { userId_category: { userId, category } } });
  return pref || DEFAULT_PREFERENCE;
}

// The one entry point for triggering any notification in the system.
//
//   notify('booking.accepted', customerId, { bookingId, providerName })
//
// - idempotent: `idempotencySuffix` (usually an entity id like bookingId)
//   plus templateKey+userId forms a unique key — firing the same event
//   twice for the same entity is a safe no-op, not a duplicate notification.
// - preference-aware: only enqueues channels the user has enabled for this
//   template's category (SECURITY is enforced to always keep >=1 channel on
//   at the preference-UPDATE layer, not here).
// - never throws into the caller's business flow: template/preference
//   lookups and delivery enqueueing are wrapped so a notification problem
//   can never break a booking/payment/wallet operation.
async function notify(templateKey, userId, variables = {}, { idempotencySuffix, scheduledFor } = {}) {
  try {
    const template = await prisma.notificationTemplate.findUnique({ where: { key: templateKey } });
    if (!template || !template.isActive) {
      console.warn(`[notify] unknown or inactive template: ${templateKey}`);
      return null;
    }

    const idempotencyKey = `${templateKey}:${userId}:${idempotencySuffix || 'default'}`;

    // ইউজারের preferredLanguage অনুযায়ী template variant বেছে নেওয়া হয় - অনুবাদ
    // না থাকলে (বা ইউজার খুঁজে না পেলে) মূল titleTemplate/bodyTemplate (বাংলা)
    // ব্যবহার হয়, এটাই ডিফল্ট/ফলব্যাক। এই এক্সট্রা lookup ছাড়া ভাষা জানার
    // কোনো উপায় নেই যেহেতু notify() শুধু userId পায়, User রেকর্ড পায় না।
    // ভাষা lookup ব্যর্থ হলেও (নেটওয়ার্ক সমস্যা বা যেকোনো কারণে) পুরো
    // নোটিফিকেশনটাই যেন বাতিল না হয়ে যায় - এটা একটা নিজস্ব try/catch-এ রাখা
    // হলো, ব্যর্থ হলে চুপচাপ বাংলা ডিফল্টে ফিরে আসে। একটা সেকেন্ডারি
    // এনরিচমেন্ট ব্যর্থ হওয়া মূল নোটিফিকেশন পাঠানো বন্ধ করার কারণ হওয়া উচিত না।
    let lang;
    try {
      const recipient = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
      lang = recipient?.preferredLanguage;
    } catch (err) {
      lang = undefined;
    }
    const titleTemplateForLang =
      (lang && template.titleTemplateTranslations && template.titleTemplateTranslations[lang]) || template.titleTemplate;
    const bodyTemplateForLang =
      (lang && template.bodyTemplateTranslations && template.bodyTemplateTranslations[lang]) || template.bodyTemplate;

    const title = interpolate(titleTemplateForLang, variables);
    const body = interpolate(bodyTemplateForLang, variables);

    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          userId,
          templateKey,
          category: template.category,
          title,
          body,
          data: variables,
          scheduledFor: scheduledFor || null,
          idempotencyKey,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') return null; // this exact event already notified — idempotent no-op
      throw err;
    }

    const preference = await getEffectivePreference(userId, template.category);
    const channelEnabled = {
      PUSH: preference.pushEnabled,
      EMAIL: preference.emailEnabled,
      SMS: preference.smsEnabled,
      IN_APP: preference.inAppEnabled,
    };

    const delay = scheduledFor ? Math.max(0, new Date(scheduledFor).getTime() - Date.now()) : 0;

    for (const channel of template.channels) {
      if (!channelEnabled[channel]) continue;

      if (channel === 'IN_APP') {
        // The Notification row itself IS the in-app notification — no
        // external send needed, just log it as instantly delivered.
        await prisma.notificationDeliveryLog.create({
          data: { notificationId: notification.id, channel: 'IN_APP', status: 'DELIVERED', sentAt: new Date(), deliveredAt: new Date() },
        }).catch((err) => console.error('[notify] IN_APP delivery log failed:', err.message));
        continue;
      }

      await enqueueNotificationJob(channel.toLowerCase(), notification.id, delay)
        .catch((err) => console.error(`[notify] failed to enqueue ${channel} job:`, err.message));
    }

    return notification;
  } catch (err) {
    console.error(`[notify] failed for template=${templateKey} userId=${userId}:`, err.message);
    return null;
  }
}

module.exports = { notify, getEffectivePreference };
