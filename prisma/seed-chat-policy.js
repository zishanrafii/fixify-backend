const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Starting defaults — admins can change any of these via
// GET/PUT /api/admin/chat/policy and /api/admin/chat/detection-rules
// afterward, with no redeploy needed.
const POLICIES = [
  { phase: 'BEFORE_BOOKING', mode: 'BLOCK' }, // no confirmed booking yet — strongest protection against fee circumvention
  { phase: 'DURING_BOOKING', mode: 'WARN' },  // some logistics coordination is normal — warn, don't block
  { phase: 'AFTER_BOOKING', mode: 'BLOCK' },  // booking's done — no legitimate platform reason to exchange contact info
];

const DETECTION_RULES = [
  {
    key: 'phone_number',
    type: 'REGEX',
    pattern: '(?:\\+?88)?01[3-9]\\d{8}|\\b\\d{10,11}\\b',
    description: 'বাংলাদেশি মোবাইল নম্বর বা সাধারণ ১০-১১ ডিজিটের নম্বর',
  },
  {
    key: 'email',
    type: 'REGEX',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    description: 'ইমেইল ঠিকানা',
  },
  {
    key: 'whatsapp_id',
    type: 'REGEX',
    pattern: '\\bwhats\\s*app\\b',
    description: 'WhatsApp উল্লেখ (নাম্বারের সাথে সাধারণত)',
  },
  {
    key: 'telegram_id',
    type: 'REGEX',
    pattern: '\\btelegram\\b|@[a-zA-Z0-9_]{5,32}\\b',
    description: 'Telegram উল্লেখ বা @handle প্যাটার্ন',
  },
  {
    key: 'facebook_profile',
    type: 'REGEX',
    pattern: 'facebook\\.com/\\S+|\\bfb\\.com/\\S+|\\bfb\\s*id\\b',
    description: 'Facebook প্রোফাইল লিংক বা "fb id" উল্লেখ',
  },
  {
    key: 'payment_info',
    type: 'REGEX',
    pattern: '\\b(bkash|nagad|rocket|bank\\s*account|routing\\s*number)\\b.{0,20}\\d{4,}',
    description: 'সরাসরি পেমেন্ট তথ্য (bKash/Nagad/ব্যাংক অ্যাকাউন্ট নম্বরসহ)',
  },
];

const SETTINGS = [
  { key: 'chat.retention_days', value: 7, description: 'বুকিং সম্পন্ন হওয়ার কতদিন পর কথোপকথন archive হবে' },
  {
    key: 'chat.booking_phase_mapping',
    value: {
      PENDING: 'BEFORE_BOOKING', ACCEPTED: 'BEFORE_BOOKING', IN_PROGRESS: 'DURING_BOOKING',
      COMPLETED: 'AFTER_BOOKING', CANCELLED_BY_CUSTOMER: 'AFTER_BOOKING', CANCELLED_BY_PROVIDER: 'AFTER_BOOKING',
      REJECTED: 'AFTER_BOOKING', EXPIRED: 'AFTER_BOOKING', DISPUTED: 'DURING_BOOKING',
    },
    description: 'কোন Booking status কোন Communication Policy phase-এ পড়ে',
  },
  { key: 'chat.no_booking_phase', value: 'DURING_BOOKING', description: 'Support/Admin chat (booking-লিঙ্কড না)-এর জন্য default phase' },
];

async function migrate() {
  for (const p of POLICIES) {
    await prisma.communicationPolicy.upsert({ where: { phase: p.phase }, update: {}, create: p });
  }
  console.log(`Seeded ${POLICIES.length} communication policies (only if not already set — existing admin config is never overwritten).`);

  for (const r of DETECTION_RULES) {
    await prisma.detectionRule.upsert({ where: { key: r.key }, update: {}, create: r });
  }
  console.log(`Seeded ${DETECTION_RULES.length} detection rules.`);

  for (const s of SETTINGS) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, update: {}, create: s });
  }
  console.log(`Seeded ${SETTINGS.length} system settings.`);
}

migrate()
  .catch((err) => {
    console.error('Chat policy seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
