# Skill Marketplace — Build Tracker (non-AI scope)

AI-based features (AI matching, AI chat assistant, AI fraud detection, AI translation,
AI voice/avatar/video, AR/VR) are intentionally deferred — tracked at the bottom, do later.

Legend: ✅ Done  🔧 In progress  ⬜ Not started

## Phase 1 — Foundation
- ✅ Phone + OTP + password auth
- ✅ Email + password login
- ✅ Google / Apple / Facebook social login (schema + endpoint scaffolded — needs real
  token verification against provider SDKs before production, see TODO in authController.js)
- ✅ Guest mode (backend)
- ✅ Guest mode (app UI: "শুধু ঘুরে দেখুন" button on RoleSelectScreen + guard blocking
  booking on ProviderDetailScreen, which also blocks chat since chat is booking-scoped)
- ✅ Extended profile schema: avatar, cover photo, portfolio, skills, certificates,
  languages, education, address/GPS
- ✅ Profile endpoints (upload/update each of the above) + app screens (avatar/cover upload
  on ProfileScreen, skills+portfolio on ProviderProfileSetupScreen)
- ✅ ID verification + face verification status fields (schema only)
- ✅ ID/face verification upload flow (VerificationScreen: submit ID doc + selfie,
  status shown on ProfileScreen) — admin review queue itself is Phase 3, not built yet
- ✅ Certificate/Education CRUD in app UI (new CredentialsScreen, linked from
  ProviderProfileSetupScreen)
- ✅ Unlimited categories/subcategories (schema: parentId self-relation)
- ✅ Subcategory CRUD endpoints (admin-only POST/PATCH/DELETE /api/search/categories)
- ⬜ Subcategory management app UI (admin panel doesn't exist yet — Phase 3 item)
- ✅ Pricing types: fixed / hourly / package / subscription (schema)
- ✅ Pricing type logic in listing create/update + app UI (MyListingsScreen: pricing
  type chips, hourly rate field; packageTiers/subscription still need dedicated UI later)
- ✅ Emergency + instant booking flags (schema)
- ✅ Emergency/instant booking toggles in listing create UI (badges shown on listing card)
- ⬜ Emergency/instant booking *flow* (provider availability check, priority notify) — deferred to Phase 2
- ⬜ AI Search / Voice Search / Image Search → deferred (AI)
- ⬜ Nearby / Filter / Sort / Popular / Trending / Recommended / Recently Viewed search

## Phase 2 — Marketplace
- ✅ Job posting (customer posts need → nearby providers notified → bid) — JobPost model,
  createJobPost notifies providers within their serviceAreaRadiusKm for the matching category
- ✅ Bidding system — Bid model, placeBid, getMyBids, acceptBid (accepting awards the job,
  rejects other bids, and creates a real Booking via a placeholder ServiceListing so the
  existing booking/chat/payment pipeline just works)
- ⬜ Reverse marketplace (provider lists, customer buys) — partially done via ServiceListing
- ✅ Live calendar / available slots / reschedule / cancel — ProviderAvailability model
  (weekly recurring hours), getAvailableSlots computes open 1-hour slots minus existing
  bookings, BookingScreen now picks from real slots (falls back to manual date/time entry
  if a provider hasn't set a schedule yet), reschedule + cancel wired into MyBookingsScreen
  (reschedule resets status to PENDING so the other side re-confirms). Provider-side
  ProviderAvailabilityScreen lets providers set their weekly hours. Note: provider-side
  reschedule/cancel UI not added yet (backend already supports it for both parties) —
  IncomingBookingsScreen still only has accept/reject.
- ✅ Recurring booking — recurrenceService.getNextOccurrence (DAILY/WEEKLY/MONTHLY),
  createBooking accepts isRecurring/recurrenceRule, updateBookingStatus auto-spawns the
  next occurrence when a recurring booking is marked COMPLETED. BookingScreen has a
  recurrence chip selector.
- Chat: ✅ text/realtime, typing indicators, seen receipts, online presence, image/file/PDF
  sharing, voice notes (record+play), location share, save-to-phone-storage (WhatsApp-style,
  images go to gallery, files to Downloads/SkillMarketplace) and save-to-Google-Drive (needs
  GOOGLE_WEB_CLIENT_ID configured — see NATIVE_SETUP.md) — ⬜ stickers, screen share, group chat
- Calling: ✅ WebRTC signaling, real noise/echo cancellation + auto-gain (getUserMedia audio
  constraints), mute/camera-off/switch-camera/speaker toggle, call duration timer, draggable
  local-video preview, CallLog model + call history endpoint (GET /api/calls/history, no UI
  screen yet). ⬜ Group call (needs an SFU media server like mediasoup/LiveKit — a mesh relay
  doesn't scale past ~3-4 people and doesn't fit the 1:1 booking model; deferred, real infra
  project). ⬜ True OS-level PiP (minimize app, call keeps running in floating window — needs
  native PictureInPictureParams/AVPictureInPictureController work, not done; what exists now
  is just a draggable in-screen local video preview). ⬜ Server-side call recording (also
  needs the SFU — peer-to-peer calls have no server-side media to record from)
- Payment: ✅ SSLCommerz (BD cards + mobile banking) + Stripe (international card, and Google
  Pay/Apple Pay auto-offered via Stripe PaymentSheet — one integration covers all three, no
  separate GPay/ApplePay SDKs needed), ✅ coupon codes (flat or % discount, applied at payment
  start), ✅ escrow — payment holds as 'escrow_held' after gateway success, only released to
  the provider's wallet (minus platform commission) when the booking is marked COMPLETED,
  auto-refunded to the customer's wallet if CANCELLED first (walletService.js, wired into
  bookingController.updateBookingStatus). ⬜ PayPal, ⬜ true split-payment (multiple payers on
  one booking — not the same as escrow, deferred), ⬜ gift cards
- ✅ Wallet — balance + transaction history (GET /api/wallet/me), withdrawal requests (POST
  /api/wallet/withdraw, recorded but payout itself is manual/admin-processed — no admin panel
  yet, Phase 3), EarningsScreen shows real wallet balance (post-commission) alongside gross
  booking totals, new WithdrawScreen. ⬜ Referral bonus / cashback — WalletTransaction `type`
  values exist for these but nothing triggers them yet (no referral-code flow built)
- ⬜ Provider dashboard (income analytics, booking/rating graphs, goals)
- ⬜ Customer dashboard (orders, wishlist, invoices, saved providers)
- Reviews: ✅ text rating — ⬜ photo/video/voice review, like/reply/report

## Phase 3 — Platform
- ⬜ Admin panel (users, providers, orders, payments, reports, commission, coupons, CMS, disputes)
- Notifications: ✅ push (FCM), SMS gateway (bulksmsbd.net-style API, now actually wired
  into OTP delivery — was a console.log placeholder before), email (nodemailer/SMTP, wired
  into booking status updates), WhatsApp (Meta Cloud API, wired into job post alerts) — all
  three new channels degrade gracefully to a console.log if their env vars aren't set, so
  nothing breaks in dev without real credentials. ⬜ Telegram, ⬜ user-facing notification
  preferences (which channels to use per event — currently every configured channel always
  fires for its wired event)
- ⬜ Security: 2FA, biometric login, device management, login history, security alerts
- ⬜ Global: multi-language, multi-currency, dark mode, offline/low-data mode
- ⬜ Growth: referral program, affiliate program, loyalty points, badges, levels, leaderboards
- ⬜ Social: follow provider, posts/stories/reels, community/forum, live stream
- ⬜ Enterprise: business/team accounts, bulk booking, invoice generator, tax report

## Deferred — AI-based (do later, per your instruction)
- AI matching, AI chat assistant, AI auto-reply, AI price suggestion, AI fraud detection,
  AI translation, AI voice assistant, AI smart search, AI recommendation, AI resume builder,
  AI portfolio generator, AI avatar, AR service preview, VR consultation, AI voice clone,
  AI video generation, AI meeting summary, blockchain certificate, NFT portfolio, smart
  contract escrow

## Next up
Security (2FA, device management, login history, security alerts) — Phase 3, not started.
CMS/blogs and reports/analytics beyond dashboard counts also still open.

## Session log
- S1: Phase 1 schema extension (social auth, profile, verification, pricing/booking types, wallet/coupon), authController social/email/guest login, TASKS.md created.
- S2: Guest mode app-side (RoleSelectScreen button, guestGuard util, booking guard on ProviderDetailScreen).
- S3: userController+userRoutes (profile PATCH, ID/face verification submit), providerController certificate/education CRUD, ProfileScreen rebuilt (avatar/cover upload, verification status row), VerificationScreen added + wired into both tab navigators, ProviderProfileSetupScreen got skills + portfolio image upload.
- S4: CredentialsScreen (certificate/education CRUD UI) wired into provider nav; category
  controller got nested tree + admin CRUD (create/update/delete, with subcategory support);
  listing create/update extended with pricingType, hourlyRate, isEmergencyAvailable,
  isInstantBookingEnabled; MyListingsScreen UI updated with pricing-type chips, hourly rate
  field, emergency/instant toggles, and badges on listing cards.
- S5: JobPost + Bid models added; jobController (createJobPost w/ nearby-provider push
  notify, getNearbyJobPosts w/ distance sort, getMyJobPosts, placeBid, getMyBids, acceptBid
  using an interactive $transaction that awards the bid and spins up a real Booking via a
  placeholder ServiceListing); jobRoutes mounted at /api/jobs. App: jobService.js,
  PostJobScreen + MyJobPostsScreen (new "জব পোস্ট" tab for customers, guest-guarded),
  JobFeedScreen (new tab for providers, nearby feed + bid modal).
- S6: ProviderAvailability model + availabilityController (setWeeklyAvailability,
  getMyWeeklyAvailability, getAvailableSlots — computes open 1hr slots from weekly rules
  minus existing bookings that day); bookingController got rescheduleBooking (resets status
  to PENDING for re-confirmation). App: ProviderAvailabilityScreen (weekly hours editor,
  linked from provider profile setup), BookingScreen rebuilt to pick from real slots with a
  manual-entry fallback, MyBookingsScreen got reschedule (two-step date→time picker,
  Android-safe) and cancel buttons. Also fixed a bug from S5: PostJobScreen was importing
  listCategories from a nonexistent searchService — corrected to bookingService.
- S7: Recurring bookings — recurrenceService.js (getNextOccurrence), createBooking +
  updateBookingStatus updated to create the next occurrence automatically on COMPLETED;
  BookingScreen got a recurrence chip selector (একবার/প্রতিদিন/সাপ্তাহিক/মাসিক).
  IncomingBookingsScreen (provider side) got the same reschedule (two-step picker) + cancel
  buttons that MyBookingsScreen already had for customers — Phase 2's booking-management
  gap is now closed for both sides.
- S8: Chat upgraded end-to-end. Schema: Message got type (TEXT/IMAGE/FILE/VOICE/LOCATION),
  mediaUrl/fileName/fileSizeBytes/durationSeconds/latitude/longitude/seenAt. chatSocket.js
  rewritten: typing/stop_typing broadcast, presence_update (online users per room), mark_seen
  + message_seen, send_message now accepts any message type. Backend: new uploadChatMedia
  multer config (wider mimetypes, 20MB limit) + POST /api/upload/chat-media. App:
  fileStorageService.js (saveMediaToDevice — images to gallery via CameraRoll, files to
  Downloads/SkillMarketplace via react-native-fs, mirrors WhatsApp's local-save behavior;
  saveToGoogleDrive — Google Sign-In + Drive REST multipart upload, scoped to drive.file
  only), voiceRecordingService.js (react-native-audio-recorder-player wrapper). ChatRoomScreen
  rewritten: attachment menu (image/file/location), hold-to-record voice notes, typing
  indicator, online/offline presence in header, seen ticks, long-press any attachment for a
  "ফোনে সেভ করুন / গুগল ড্রাইভে সেভ করুন" action sheet. package.json got react-native-fs,
  react-native-document-picker, react-native-audio-recorder-player,
  @react-native-camera-roll/camera-roll, @react-native-google-signin/google-signin.
  NATIVE_SETUP.md documents the new Android/iOS permissions and the full Google Cloud
  Console OAuth setup needed for Drive uploads — GOOGLE_WEB_CLIENT_ID in constants.js must
  be filled in before Drive save will work, everything else works out of the box once native
  deps are linked. Stickers, screen share, and group chat are still open.
- S9: Calling upgrades. Schema: CallLog model (caller/callee/type/status/timestamps/duration)
  + CallType/CallStatus enums. callSignaling.js now creates a CallLog on call_user, marks it
  ONGOING on answer_call, and COMPLETED/MISSED with duration on end_call. New
  callController.js + GET /api/calls/history (no app screen surfacing this yet). App:
  webrtcService.js getUserMedia now requests real echoCancellation/noiseSuppression/
  autoGainControl audio constraints, plus toggleMute/toggleCamera/switchCamera helpers.
  CallScreen rewritten: mute, camera on/off, front/back camera switch, speaker toggle (via
  new react-native-incall-manager dependency), live call duration timer, and a draggable
  local-video preview (PanResponder-based, in-screen only). Was explicit in TASKS.md about
  what's still deferred and why: true multi-party group calling and server-side call
  recording both need an SFU media server (mediasoup/LiveKit-class infra), which this
  peer-to-peer signaling relay architecture can't provide — flagged as a real infra project,
  not something to fake with a mesh hack. Same honesty for PiP: what's built is a draggable
  in-screen preview, not OS-level Picture-in-Picture (that needs native
  PictureInPictureParams/AVPictureInPictureController work).
- S10: Payment/escrow/wallet. walletService.js (ensureWallet, creditWallet,
  releaseEscrowForBooking — pays provider minus 10% platform commission,
  refundEscrowForBooking — refunds customer), wired into bookingController so COMPLETED
  releases escrow and CANCELLED refunds it automatically. paymentController rewritten:
  payments now land in 'escrow_held' status after gateway success instead of 'success'
  directly; added coupon support (validate + apply discount at payment start, usage count
  incremented atomically); added Stripe as a second gateway (stripeService.js,
  createPaymentIntent with automatic_payment_methods so card/GPay/ApplePay all come free
  from one integration) via POST /api/payments/stripe/intent + a webhook stub at
  /api/payments/stripe/webhook (NOTE: webhook doesn't verify the Stripe signature yet —
  fine for dev, must add stripe.webhooks.constructEvent before production). New
  couponController.js (GET /api/coupons/:code to validate) and walletController.js (GET
  /api/wallet/me, POST /api/wallet/withdraw — withdrawal is recorded but payout is manual/
  admin-processed, no admin panel yet). App: walletService.js, EarningsScreen now shows real
  wallet balance + transaction history alongside the old gross-earnings view, new
  WithdrawScreen. Coupon entry UI on the payment flow and full Stripe PaymentSheet wiring
  (@stripe/stripe-react-native) are backend-ready but not yet built into BookingScreen/
  MyBookingsScreen — noted as follow-up, not silently skipped.
- S11: Admin panel (Phase 3, first slice). Schema: User.isSuspended (proper field — avoided
  the tempting shortcut of overloading isVerified, which is also used for OTP/social
  verification and would've collided with it), WalletTransaction.status (pending/processed/
  rejected, for withdrawal review). New adminController.js + adminRoutes.js at /api/admin,
  all requireRole('ADMIN'): dashboard stats, user list+search+suspend, verification review
  queue (approve/reject ID + face separately), withdrawal review (reject refunds the wallet
  atomically), coupon CRUD. Suspension is now actually enforced at login (phone/email/social)
  — previously it would've been cosmetic. App: new AdminNavigator + 5 screens (Dashboard,
  Verifications, Withdrawals, Coupons, Users), wired into AppNavigator as a third branch
  alongside Customer/Provider based on user.role === 'ADMIN'. prisma/seed.js now seeds a
  default admin (phone 01700000000 / password admin1234 — must be changed before production,
  noted loudly in the seed output). Still open: category management UI in the admin panel
  (backend CRUD exists from S4, just no screen yet), disputes (no model at all yet),
  CMS/blogs, reports/analytics beyond the dashboard counts.
- S12: Closed out the two remaining S11 follow-ups. Category management UI:
  AdminCategoriesScreen (create top-level or sub-category via a parent picker, delete —
  backend endpoints already existed from S4, just needed the screen). Disputes: new Dispute
  model + DisputeStatus enum, disputeController.js (createDispute — either party on a
  booking can raise one, blocks a second open dispute on the same booking; getMyDisputes;
  admin listOpenDisputes with booking/customer/provider context attached; resolveDispute —
  RESOLVED-with-refund calls the existing refundEscrowForBooking from walletService,
  RESOLVED-without-refund and REJECTED just close it with a note) at /api/disputes. App:
  disputeService.js, shared DisputeFormScreen (reason picker + description) wired into both
  customer and provider bookings stacks, "সমস্যা জানান" button shown on COMPLETED/CANCELLED
  bookings on both MyBookingsScreen and IncomingBookingsScreen. AdminDisputesScreen with
  three resolution actions (refund+resolve, resolve without refund, reject) plus a resolution
  note field. Dashboard now shows an open-dispute count badge too.
- S13: Multi-channel notifications, actually wired not just scaffolded. smsService.js
  (bulksmsbd.net-style HTTP API) replaces the OTP console.log placeholder — sendOtp now
  really sends. emailService.js (nodemailer/SMTP) wired into booking status-change
  notifications alongside the existing push. whatsappService.js (Meta WhatsApp Cloud API)
  wired into job-post alerts to nearby providers, on the reasoning that job posts can be
  urgent and WhatsApp has better open rates than push when the app isn't open. All three
  are no-ops that log to console if their env vars are missing, so nothing in dev breaks
  without real credentials — .env.example documents exactly what each needs. Replaced the
  old unused TWILIO_* placeholder vars with the ones actually read by the code.
