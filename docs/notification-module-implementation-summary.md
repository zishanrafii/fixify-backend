# Notification Module — Implementation Summary

## নতুন ফাইল
- `prisma/schema.prisma` — `Notification`, `NotificationTemplate`, `NotificationPreference`, `NotificationDeliveryLog` + enums
- `src/queues/notificationQueues.js` — BullMQ queue setup (push/email/sms + DLQ)
- `src/notifications/templateEngine.js` — নিরাপদ `{{var}}` interpolation, email-এর জন্য HTML-escape
- `src/notifications/notificationEngine.js` — `notify()`, একমাত্র entry point
- `src/workers/notificationWorker.js` — per-channel worker, idempotent, DLQ হ্যান্ডলিং, stale FCM token cleanup
- `src/controllers/notificationAdminController.js` — টেমপ্লেট ম্যানেজমেন্ট + DLQ browse/retry
- `prisma/seed-notification-templates.js` — ১৪টা টেমপ্লেট (মূল ১০টা + Booking module-এর বিদ্যমান ৪টা notification behavior সংরক্ষণের জন্য আরও ৪টা)
- `tests/unit/ledgerService.test.js`-এর প্যাটার্নে `tests/unit/notificationEngine.test.js`

## পরিবর্তিত ফাইল
- `src/services/notificationService.js`, `emailService.js`, `smsService.js` — প্রতিটাতে একটা "throw করে" variant যোগ (worker-এর জন্য), পুরনো fire-and-forget ফাংশন অপরিবর্তিত
- `src/controllers/notificationController.js` — in-app list, read/unread, preferences যোগ
- `src/routes/notificationRoutes.js`, `src/routes/adminRoutes.js` — নতুন endpoint
- `server.js` — worker start (same-process, cron job-গুলোর মতো)
- **`src/controllers/bookingController.js`, `src/jobs/bookingExpiryJob.js`** — সব সরাসরি `sendPushNotification()` কল সরিয়ে `notify()` — recipient/trigger/message content অপরিবর্তিত, শুধু delivery reliable হলো (retry+DLQ+audit log পেল)
- `src/controllers/paymentController.js` — নতুন: `payment.successful` (আগে কোনো notification-ই ছিল না)
- `src/controllers/disputeController.js` — নতুন: `payment.refunded` (dispute-driven refund-এ)
- `src/controllers/adminController.js` — verification notification `notify()`-তে সরানো; নতুন: `withdrawal.approved`, `security.alert` (suspend)
- `src/services/reconciliation/reconciliationEngine.js` — reconciliation মিসড webhook ধরলে এখন customer-কে `payment.successful` জানায়

## Regression নোট (Booking module)
- Import পরীক্ষা করে দেখা হয়েছে — `bookingController.js`/`bookingExpiryJob.js`-এ Booking-এর নিজস্ব state machine/transition logic-এ **কোনো পরিবর্তন হয়নি**, শুধু notification পাঠানোর mechanism বদলেছে
- প্রতিটা migrated call site-এ recipient ও trigger condition অক্ষত রাখা হয়েছে; content সামান্য টেমপ্লেটাইজড হয়েছে (একই অর্থ)

## Honest gap
- "Provider Arrived" টেমপ্লেট সিড করা আছে কিন্তু কোথাও call হয় না — Booking module-এর state machine-এ কোনো "arrived" sub-state নেই (frozen বলে যোগ করিনি)
- এই sandbox-এ Redis/DB ছাড়া worker/queue বাস্তবে চালিয়ে দেখানো যায়নি — `npm install && npm run seed:notification-templates` তারপর সার্ভার চালিয়ে test করবেন
