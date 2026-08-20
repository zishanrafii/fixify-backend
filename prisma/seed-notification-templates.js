const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// NOTE on "Provider Arrived": the Booking Module's state machine (frozen)
// has no distinct "arrived" state today — the closest existing transition
// is `startBooking` (ACCEPTED -> IN_PROGRESS), which already fires
// "booking.started". This template is seeded and ready, but nothing calls
// `notify('provider.arrived', ...)` yet — wiring it in requires the Booking
// Module to gain a genuine "arrived" sub-state first, which is a Booking
// Module change (out of scope while frozen). See
// docs/notification-module-implementation-summary.md.
const templates = [
  {
    key: 'chat.new_message',
    category: 'SYSTEM',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: '{{senderName}}',
    bodyTemplate: '{{preview}}',
    titleTemplateTranslations: { en: '{{senderName}}' },
    bodyTemplateTranslations: { en: '{{preview}}' },
  },
  {
    key: 'chat.message_rejected',
    category: 'SYSTEM',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'মেসেজ পাঠানো যায়নি',
    bodyTemplate: 'আপনার একটা মেসেজ পর্যালোচনার পর পাঠানো সম্ভব হয়নি',
    titleTemplateTranslations: { en: 'Message not delivered' },
    bodyTemplateTranslations: { en: 'One of your messages could not be delivered after review' },
  },
  {
    key: 'system.broadcast',
    category: 'SYSTEM',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: '{{title}}',
    bodyTemplate: '{{message}}',
    titleTemplateTranslations: { en: '{{title}}' },
    bodyTemplateTranslations: { en: '{{message}}' },
  },
  {
    key: 'booking.created',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'নতুন বুকিং অনুরোধ',
    bodyTemplate: 'আপনি "{{listingTitle}}"-এর জন্য একটি নতুন বুকিং অনুরোধ পেয়েছেন',
    titleTemplateTranslations: { en: 'New booking request' },
    bodyTemplateTranslations: { en: 'You have a new booking request for "{{listingTitle}}"' },
  },
  {
    key: 'booking.accepted',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'বুকিং গ্রহণ করা হয়েছে',
    bodyTemplate: 'আপনার বুকিং প্রোভাইডার গ্রহণ করেছেন',
    titleTemplateTranslations: { en: 'Booking accepted' },
    bodyTemplateTranslations: { en: 'Your booking has been accepted by the provider' },
  },
  {
    key: 'provider.arrived',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP', 'SMS'],
    titleTemplate: 'প্রোভাইডার পৌঁছেছেন',
    bodyTemplate: 'আপনার প্রোভাইডার লোকেশনে পৌঁছেছেন',
    titleTemplateTranslations: { en: 'Provider arrived' },
    bodyTemplateTranslations: { en: 'Your provider has arrived at the location' },
    smsTemplate: 'আপনার Fixify প্রোভাইডার পৌঁছেছেন।',
  },
  {
    key: 'booking.started',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'কাজ শুরু হয়েছে',
    bodyTemplate: 'প্রোভাইডার আপনার কাজ শুরু করেছেন',
    titleTemplateTranslations: { en: 'Work started' },
    bodyTemplateTranslations: { en: 'The provider has started your job' },
  },
  {
    key: 'booking.completed',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP', 'EMAIL'],
    titleTemplate: 'বুকিং সম্পন্ন হয়েছে',
    bodyTemplate: 'আপনার বুকিং সফলভাবে সম্পন্ন হয়েছে',
    titleTemplateTranslations: { en: 'Booking completed' },
    bodyTemplateTranslations: { en: 'Your booking has been completed successfully' },
    emailSubjectTemplate: 'বুকিং সম্পন্ন — Fixify',
    emailBodyTemplate: '<p>আপনার বুকিং #{{bookingId}} সফলভাবে সম্পন্ন হয়েছে। ধন্যবাদ Fixify ব্যবহার করার জন্য।</p>',
  },
  // নিচের তিনটা মূল ১০টা event-এর তালিকায় ছিল না, কিন্তু Booking module-এ
  // আগে থেকেই এই notification-গুলো পাঠানো হতো (reject/cancel/recurring-next)।
  // Booking module-এর behavior অক্ষত রাখতে (partial migration না করে) এগুলোও
  // যোগ করা হলো — নাহলে কিছু notification notify()-এর মধ্য দিয়ে যেত, কিছু পুরনো
  // পথে, যেটা অসামঞ্জস্যপূর্ণ ও maintain করা কঠিন হতো।
  {
    key: 'booking.expired',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'বুকিং মেয়াদোত্তীর্ণ হয়েছে',
    bodyTemplate: 'প্রোভাইডার সময়মতো সাড়া দেননি, আপনার বুকিং বাতিল হয়ে গেছে',
    titleTemplateTranslations: { en: 'Booking expired' },
    bodyTemplateTranslations: { en: 'The provider did not respond in time, so your booking was cancelled' },
  },
  {
    key: 'booking.completed_provider_payout',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'বুকিং সম্পন্ন হয়েছে',
    bodyTemplate: 'গ্রাহক কাজ কনফার্ম করেছেন, পেমেন্ট রিলিজ হয়েছে',
    titleTemplateTranslations: { en: 'Booking completed' },
    bodyTemplateTranslations: { en: 'The customer confirmed the job, payment has been released' },
  },
  {
    key: 'booking.awaiting_confirmation',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'কাজ শেষ হয়েছে',
    bodyTemplate: 'প্রোভাইডার কাজ শেষ করেছেন — অনুগ্রহ করে কনফার্ম করুন',
    titleTemplateTranslations: { en: 'Work finished' },
    bodyTemplateTranslations: { en: 'The provider has finished the job - please confirm' },
  },
  {
    key: 'booking.rejected',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'বুকিং প্রত্যাখ্যাত',
    bodyTemplate: 'দুঃখিত, প্রোভাইডার এই বুকিং নিতে পারছেন না',
    titleTemplateTranslations: { en: 'Booking rejected' },
    bodyTemplateTranslations: { en: 'Sorry, the provider is unable to take this booking' },
  },
  {
    key: 'booking.cancelled',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'বুকিং বাতিল হয়েছে',
    bodyTemplate: '{{reason}}',
    titleTemplateTranslations: { en: 'Booking cancelled' },
    bodyTemplateTranslations: { en: '{{reason}}' },
  },
  {
    key: 'booking.recurring_created',
    category: 'BOOKING',
    channels: ['PUSH', 'IN_APP'],
    titleTemplate: 'পরবর্তী বুকিং তৈরি হয়েছে',
    bodyTemplate: 'আপনার recurring বুকিং-এর পরের সময় নির্ধারিত হয়েছে',
    titleTemplateTranslations: { en: 'Next booking created' },
    bodyTemplateTranslations: { en: 'The next occurrence of your recurring booking has been scheduled' },
  },
  {
    key: 'payment.successful',
    category: 'PAYMENT',
    channels: ['PUSH', 'IN_APP', 'EMAIL'],
    titleTemplate: 'পেমেন্ট সফল হয়েছে',
    bodyTemplate: '৳{{amount}} পেমেন্ট সফলভাবে সম্পন্ন হয়েছে',
    titleTemplateTranslations: { en: 'Payment successful' },
    bodyTemplateTranslations: { en: 'Your payment of ৳{{amount}} was completed successfully' },
    emailSubjectTemplate: 'পেমেন্ট রসিদ — Fixify',
    emailBodyTemplate: '<p>আপনার ৳{{amount}} পেমেন্ট সফল হয়েছে (বুকিং #{{bookingId}})।</p>',
  },
  {
    key: 'payment.refunded',
    category: 'PAYMENT',
    channels: ['PUSH', 'IN_APP', 'EMAIL'],
    titleTemplate: 'রিফান্ড সম্পন্ন হয়েছে',
    bodyTemplate: '৳{{amount}} আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে',
    titleTemplateTranslations: { en: 'Refund completed' },
    bodyTemplateTranslations: { en: '৳{{amount}} has been refunded to your wallet' },
    emailSubjectTemplate: 'রিফান্ড নিশ্চিতকরণ — Fixify',
    emailBodyTemplate: '<p>আপনার বুকিং #{{bookingId}}-এর ৳{{amount}} রিফান্ড হয়ে ওয়ালেটে জমা হয়েছে।</p>',
  },
  {
    key: 'withdrawal.approved',
    category: 'WALLET',
    channels: ['PUSH', 'IN_APP', 'EMAIL', 'SMS'],
    titleTemplate: 'উত্তোলন প্রসেস হয়েছে',
    bodyTemplate: 'আপনার ৳{{amount}} উত্তোলনের অনুরোধ প্রসেস হয়েছে',
    titleTemplateTranslations: { en: 'Withdrawal processed' },
    bodyTemplateTranslations: { en: 'Your withdrawal request of ৳{{amount}} has been processed' },
    emailSubjectTemplate: 'উত্তোলন সম্পন্ন — Fixify',
    emailBodyTemplate: '<p>আপনার ৳{{amount}} উত্তোলনের অনুরোধ সফলভাবে প্রসেস হয়েছে।</p>',
    smsTemplate: 'আপনার Fixify উত্তোলন ৳{{amount}} প্রসেস হয়েছে।',
  },
  {
    key: 'account.verification',
    category: 'VERIFICATION',
    channels: ['PUSH', 'IN_APP', 'EMAIL'],
    titleTemplate: '{{verificationType}} ভেরিফিকেশন আপডেট',
    bodyTemplate: '{{message}}',
    titleTemplateTranslations: { en: '{{verificationType}} verification update' },
    bodyTemplateTranslations: { en: '{{message}}' },
    emailSubjectTemplate: 'ভেরিফিকেশন আপডেট — Fixify',
    emailBodyTemplate: '<p>{{message}}</p>',
  },
  {
    key: 'security.alert',
    category: 'SECURITY',
    channels: ['PUSH', 'IN_APP', 'EMAIL', 'SMS'],
    titleTemplate: 'নিরাপত্তা সতর্কতা',
    bodyTemplate: '{{message}}',
    titleTemplateTranslations: { en: 'Security alert' },
    bodyTemplateTranslations: { en: '{{message}}' },
    emailSubjectTemplate: 'নিরাপত্তা সতর্কতা — Fixify',
    emailBodyTemplate: '<p>{{message}}</p><p>এটা আপনি না করে থাকলে সাথে সাথে সাপোর্টে যোগাযোগ করুন।</p>',
    smsTemplate: 'Fixify নিরাপত্তা সতর্কতা: {{message}}',
  },
];

async function seedNotificationTemplates() {
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({ where: { key: t.key }, update: t, create: t });
  }
  console.log(`Seeded ${templates.length} notification templates.`);
}

seedNotificationTemplates()
  .catch((err) => {
    console.error('Seeding notification templates failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
