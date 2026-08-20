// Run once after `npx prisma migrate dev` for the Admin Dashboard schema:
//   node prisma/seed-admin-rbac.js
//
// What this does:
//  1. Seeds the full Permission catalogue (21 permissions across every
//     existing admin capability + the new Dashboard/Analytics/Audit/Role/
//     Settings ones).
//  2. Maps each AdminRole to its permissions per the approved Permission
//     Matrix (docs/admin-dashboard-module-design.md). SUPER_ADMIN gets every
//     permission seeded for display/audit parity, even though enforcement
//     never actually reads the table for SUPER_ADMIN — see
//     permissionMiddleware.js's hardcoded bypass.
//  3. Bootstraps the existing seed admin (phone 01700000000, from
//     prisma/seed.js) as SUPER_ADMIN with mustChangePassword=true — the
//     production safety requirement: this account must change its password
//     before it can do anything else (see permissionMiddleware.js).
//
// Idempotent: Permission upsert by key, RolePermission upsert by
// (adminRole, permissionId), AdminProfile upsert by userId.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PERMISSIONS = [
  { key: 'dashboard.view', category: 'DASHBOARD', description: 'Dashboard overview ও লাইভ মেট্রিক্স দেখা' },
  { key: 'users.view', category: 'USER', description: 'ইউজার তালিকা ও প্রোফাইল দেখা' },
  { key: 'users.suspend', category: 'USER', description: 'ইউজার সাসপেন্ড/আনসাসপেন্ড করা' },
  { key: 'providers.view', category: 'PROVIDER', description: 'প্রোভাইডার তালিকা ও verification queue দেখা' },
  { key: 'providers.verify', category: 'PROVIDER', description: 'ID/face verification approve/reject করা' },
  { key: 'bookings.view', category: 'BOOKING', description: 'বুকিং তালিকা দেখা' },
  { key: 'wallet.view', category: 'WALLET', description: 'উত্তোলনের অনুরোধ ও ওয়ালেট তথ্য দেখা' },
  { key: 'wallet.approve', category: 'WALLET', description: 'উত্তোলনের অনুরোধ approve/reject করা' },
  { key: 'wallet.adjust', category: 'WALLET', description: 'ম্যানুয়াল ব্যালেন্স/মার্কেটিং ক্রেডিট সমন্বয়' },
  { key: 'payment.view', category: 'PAYMENT', description: 'পেমেন্ট reconciliation queue/report দেখা' },
  { key: 'payment.reconcile', category: 'PAYMENT', description: 'Reconciliation run/resolve করা' },
  { key: 'disputes.view', category: 'DISPUTE', description: 'খোলা অভিযোগ দেখা' },
  { key: 'disputes.resolve', category: 'DISPUTE', description: 'অভিযোগ সমাধান করা' },
  { key: 'notifications.view', category: 'NOTIFICATION', description: 'নোটিফিকেশন টেমপ্লেট/DLQ দেখা' },
  { key: 'notifications.manage', category: 'NOTIFICATION', description: 'টেমপ্লেট এডিট, DLQ retry' },
  { key: 'notifications.broadcast', category: 'NOTIFICATION', description: 'ব্রডকাস্ট নোটিফিকেশন পাঠানো' },
  { key: 'coupons.view', category: 'COUPON', description: 'কুপন তালিকা দেখা' },
  { key: 'coupons.manage', category: 'COUPON', description: 'কুপন তৈরি/মুছে ফেলা' },
  { key: 'categories.manage', category: 'SETTINGS', description: 'সার্ভিস ক্যাটাগরি তৈরি/এডিট/মুছে ফেলা' },
  { key: 'reports.view', category: 'REPORTS', description: 'Analytics ও financial report দেখা' },
  { key: 'audit.view', category: 'AUDIT', description: 'Admin audit log দেখা' },
  { key: 'roles.manage', category: 'ROLE', description: 'Admin role/permission ম্যানেজ করা (SUPER_ADMIN-only, hardcoded)' },
  { key: 'settings.view', category: 'SETTINGS', description: 'সিস্টেম সেটিংস দেখা' },
  { key: 'settings.manage', category: 'SETTINGS', description: 'সিস্টেম সেটিংস পরিবর্তন' },
  { key: 'chat.view', category: 'CHAT', description: 'কথোপকথনের তালিকা দেখা (মেসেজ কনটেন্ট না)' },
  { key: 'chat.view_messages', category: 'CHAT', description: 'কথোপকথনের ভেতরের মেসেজ দেখা — sensitive, audit হয়' },
  { key: 'chat.moderate', category: 'CHAT', description: 'রিপোর্ট রিভিউ, কথোপকথন লক/আর্কাইভ' },
  { key: 'chat.policy.manage', category: 'CHAT', description: 'Communication Policy ও Detection Rule কনফিগার করা' },
];

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ALL_KEYS, // seeded for display parity — enforcement is a hardcoded bypass regardless
  ADMIN: [
    'dashboard.view', 'users.view', 'users.suspend', 'providers.view', 'providers.verify', 'bookings.view',
    'wallet.view', 'payment.view',
    'disputes.view', 'disputes.resolve',
    'notifications.view', 'notifications.manage', 'notifications.broadcast',
    'coupons.view', 'coupons.manage', 'categories.manage',
    'reports.view', 'audit.view', 'settings.view',
    'chat.view', 'chat.view_messages', 'chat.moderate', 'chat.policy.manage',
  ],
  FINANCE_ADMIN: [
    'dashboard.view', 'users.view', 'providers.view', 'bookings.view',
    'wallet.view', 'wallet.approve', 'wallet.adjust',
    'payment.view', 'payment.reconcile',
    'disputes.view', 'notifications.view', 'coupons.view',
    'reports.view', 'audit.view',
  ],
  SUPPORT_ADMIN: [
    'dashboard.view', 'users.view', 'users.suspend', 'providers.view', 'providers.verify', 'bookings.view',
    'wallet.view', 'payment.view',
    'disputes.view', 'disputes.resolve',
    'notifications.view', 'reports.view', 'audit.view',
    'chat.view', 'chat.view_messages', 'chat.moderate',
  ],
  MODERATOR: [
    'dashboard.view', 'users.view', 'providers.view', 'providers.verify', 'bookings.view',
    'disputes.view', 'disputes.resolve',
    'chat.view', 'chat.view_messages', 'chat.moderate',
  ],
};

async function seedPermissions() {
  const byKey = {};
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({ where: { key: p.key }, update: p, create: p });
    byKey[p.key] = row;
  }
  return byKey;
}

async function seedRolePermissions(byKey) {
  let count = 0;
  for (const [adminRole, keys] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of keys) {
      const permission = byKey[key];
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: { adminRole_permissionId: { adminRole, permissionId: permission.id } },
        update: {},
        create: { adminRole, permissionId: permission.id },
      });
      count++;
    }
  }
  return count;
}

// The one specific account known to ship with a default, publicly-visible
// password (see prisma/seed.js) — this is the only one forced to change its
// password. Any other pre-existing ADMIN account was presumably already
// given a real password by whoever created it.
const SEED_BOOTSTRAP_PHONE = '01700000000';

async function bootstrapAdminProfiles() {
  const adminUsers = await prisma.user.findMany({ where: { role: 'ADMIN' } });
  if (adminUsers.length === 0) {
    console.warn('No User.role=ADMIN accounts found — nothing to bootstrap. Run prisma/seed.js first if this is a fresh database.');
    return [];
  }

  const results = [];
  for (const user of adminUsers) {
    const isSeedBootstrap = user.phone === SEED_BOOTSTRAP_PHONE;
    const profile = await prisma.adminProfile.upsert({
      where: { userId: user.id },
      update: {}, // never downgrade/overwrite an existing profile on re-run
      create: {
        userId: user.id,
        adminRole: isSeedBootstrap ? 'SUPER_ADMIN' : 'ADMIN',
        mustChangePassword: isSeedBootstrap,
        createdByUserId: null,
      },
    });
    results.push(profile);
  }
  return results;
}

async function migrate() {
  const byKey = await seedPermissions();
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  const mappedCount = await seedRolePermissions(byKey);
  console.log(`Seeded ${mappedCount} role-permission mappings.`);

  const profiles = await bootstrapAdminProfiles();
  for (const p of profiles) {
    console.log(`AdminProfile ready: userId=${p.userId} role=${p.adminRole} mustChangePassword=${p.mustChangePassword}`);
  }
}

migrate()
  .catch((err) => {
    console.error('Admin RBAC migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
