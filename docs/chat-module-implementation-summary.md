# Chat & Messaging Module — Implementation Summary

## নতুন/পুনর্লিখিত ফাইল
- Schema: `Conversation`, `ConversationParticipant`, `Message` (redesign), `MessageAttachment`, `MessageDelivery`, `MessageRead`, `MessageReport`, `CommunicationPolicy`, `DetectionRule` + enums; `User.lastSeenAt`
- `src/chat/chatService.js` — core: lazy conversation creation (booking status **read-only**), participant auth, policy-integrated message creation, delivery/read, rate limiting
- `src/chat/policy/policyEngine.js`, `detectorRegistry.js`, `detectors/regexDetector.js`, `detectors/mlDetector.js` (reserved placeholder) — Communication Policy Engine, পুরোপুরি config-driven (`CommunicationPolicy`, `DetectionRule`, `SystemSetting` টেবিল থেকে, কোনো hardcoded rule নেই)
- `src/sockets/chatSocket.js` — সম্পূর্ণ নতুন Conversation-ভিত্তিক (আগে ছিল bookingId room-ভিত্তিক)
- `src/controllers/chatController.js`, `src/routes/chatRoutes.js` — REST API নতুন করে
- `src/controllers/chatAdminController.js` — admin moderation + policy config, `adminRoutes.js`-এ wire করা
- `src/jobs/chatLifecycleJob.js` — auto-archive cron (retention period configurable)
- `prisma/seed-chat-policy.js` — default policy/detection-rule/settings (সব admin API দিয়ে পরে বদলানো যাবে)
- `server.js` — Redis adapter (horizontal scaling), `app.set('io', io)`
- `tests/unit/policyEngine.test.js`

## Booking Module Integration — শুধু READ, কোনো wiring call না
`chatService.js` শুধু `prisma.booking.findUnique()` কল করে status পড়ে — `bookingController.js`-এর **একটা লাইনও টাচ করা হয়নি**। তাই এই মডিউলের জন্য আগের মতো "frozen module touch" অনুমতির দরকার হয়নি।

## Admin Dashboard Module Integration — additive routes
নতুন `chat.*` permission ৪টা (`chat.view`, `chat.view_messages`, `chat.moderate`, `chat.policy.manage`) `seed-admin-rbac.js`-এ যোগ হয়েছে, `ADMIN`/`SUPPORT_ADMIN`/`MODERATOR`-কে map করা হয়েছে (matrix অনুযায়ী)। `adminRoutes.js`-এ শুধু নতুন route যোগ হয়েছে — বিদ্যমান কোনো route/permission বদলায়নি (আগের cross-module RBAC wiring-এর অনুমোদিত প্যাটার্নেই)। Admin-এর private message দেখা `permissionMiddleware`-এর মাধ্যমে স্বয়ংক্রিয়ভাবে `AdminAuditLog`-এ যায়।

## Migration চালানোর ধাপ
```bash
npx prisma migrate dev --name chat_module
npm run seed:admin-rbac      # নতুন chat.* permission map করার জন্য
npm run seed:chat-policy     # default policy/detection-rule/settings
```
⚠️ **ডেটা মাইগ্রেশন নোট:** পুরনো `Message` মডেল সরাসরি `bookingId`-তে ছিল — নতুন মডেল `Conversation`-এর মধ্য দিয়ে যায়। যদি প্রোডাকশনে আগে থেকে চ্যাট ডেটা থাকে, migrate করার আগে একটা one-off script দিয়ে প্রতিটা বুকিং-এর পুরনো মেসেজগুলোকে নতুন `Conversation`-এ রূপান্তর করতে হবে (এই sandbox-এ সেই ডেটা নেই বলে স্ক্রিপ্ট লেখা হয়নি — production migrate করার আগে জানাবেন, লিখে দেব)।

## Testing Steps
1. একটা বুকিং ACCEPTED করুন, `GET /api/chat/bookings/:bookingId/conversation` কল করুন — Conversation lazily তৈরি হবে
2. Socket দিয়ে connect করে `join_conversation` → `send_message` (TEXT, ফোন নম্বর দিয়ে) — default policy অনুযায়ী DURING_BOOKING=WARN, তাই `message_flagged` event আসা উচিত
3. `PUT /api/admin/chat/policy/DURING_BOOKING { mode: 'BLOCK' }` দিয়ে বদলে আবার পাঠান — এবার `chat_error` (POLICY_BLOCKED) আসা উচিত, কোনো কোড ডিপ্লয় ছাড়াই
4. অফলাইন recipient-কে মেসেজ পাঠিয়ে push notification যাচ্ছে কিনা দেখুন
5. বুকিং COMPLETED করে, `chat.retention_days` কমিয়ে টেস্ট করে `chatLifecycleJob` চালিয়ে Conversation ARCHIVED হচ্ছে কিনা দেখুন

## Honest Gaps
- Image/attachment-এর ভেতরের contact info detect হয় না (design doc-এই বলা ছিল) — `ML_MODEL` detector reserved কিন্তু implement করা হয়নি
- বিদ্যমান production চ্যাট ডেটা থাকলে migration script আলাদা লিখতে হবে (উপরে নোট করা)
- এই sandbox-এ DB/Redis ছাড়া socket flow বাস্তবে চালিয়ে দেখানো যায়নি
