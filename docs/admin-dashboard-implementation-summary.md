# Admin Dashboard & Analytics Module — Implementation Summary

## Final Permission Matrix (২১টা permission, seed script অনুযায়ী)

| Permission | SUPER_ADMIN | ADMIN | FINANCE_ADMIN | SUPPORT_ADMIN | MODERATOR |
|---|:---:|:---:|:---:|:---:|:---:|
| dashboard.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| users.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| users.suspend | ✅ | ✅ | — | ✅ | — |
| providers.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| providers.verify | ✅ | ✅ | — | ✅ | ✅ |
| bookings.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| wallet.view | ✅ | ✅ | ✅ | ✅ | — |
| wallet.approve | ✅ | — | ✅ | — | — |
| wallet.adjust | ✅ | — | ✅ | — | — |
| payment.view | ✅ | ✅ | ✅ | ✅ | — |
| payment.reconcile | ✅ | — | ✅ | — | — |
| disputes.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| disputes.resolve | ✅ | ✅ | — | ✅ | ✅ |
| notifications.view | ✅ | ✅ | ✅ | ✅ | — |
| notifications.manage | ✅ | ✅ | — | — | — |
| notifications.broadcast | ✅ | ✅ | — | — | — |
| coupons.view | ✅ | ✅ | ✅ | — | — |
| coupons.manage | ✅ | ✅ | — | — | — |
| categories.manage | ✅ | ✅ | — | — | — |
| reports.view | ✅ | ✅ | ✅ | ✅ | — |
| audit.view | ✅ | ✅ | ✅ | ✅ | — |
| roles.manage | ✅ (hardcoded, DB দিয়ে বদলানো যাবে না) | — | — | — | — |
| settings.view | ✅ | ✅ | — | — | — |
| settings.manage | ✅ | — | — | — | — |

**SUPER_ADMIN নোট:** উপরের ✅ গুলো `RolePermission` টেবিলে seed করা আছে (display/audit parity-এর জন্য), কিন্তু বাস্তবে enforcement `permissionMiddleware.js`-এ **hardcoded bypass** — টেবিল এডিট করে SUPER_ADMIN-এর ক্ষমতা কমানো/বাড়ানো কোনোটাই সম্ভব না। `PUT /api/admin/roles/:role/permissions` endpoint স্পষ্টভাবে `role === 'SUPER_ADMIN'`-এ `403` রিটার্ন করে।

---

## Migration Summary

### নতুন কী যোগ হলো
- Schema: `AdminRole`, `AdminProfile`, `Permission`, `RolePermission`, `AdminAuditLog`, `DailyMetricsSnapshot`, `SystemSetting`; `Address`-এ `city`/`district`/`division`/`country` (additive, nullable, backward compatible)
- `src/middleware/permissionMiddleware.js` — flat `requireRole('ADMIN')`-এর replacement
- `src/services/adminAuditService.js` — audit log writer
- `prisma/seed-admin-rbac.js` — migration script: Permission catalogue + RolePermission mapping + **সব বিদ্যমান `User.role='ADMIN'` অ্যাকাউন্টের জন্য `AdminProfile` তৈরি** (শুধু seed অ্যাকাউন্ট না — grep করে দেখেছিলাম অন্য কোনো admin থাকলে সেও যেন access না হারায়)
- Dashboard/Analytics/Management/Role/Audit/Settings/Broadcast controller ও route — সব নতুন

### কীভাবে permission map করা হলো (audit trail)
`prisma/seed-admin-rbac.js`-এ `ROLE_PERMISSIONS` অবজেক্ট explicit ভাবে প্রতিটা role-কে কোন permission দেওয়া হলো তার সম্পূর্ণ তালিকা — এটাই মাইগ্রেশনের "before → after" রেকর্ড। মূলনীতি: **আগে যা flat ADMIN করতে পারত, নতুন `ADMIN` role-এও তা রাখা হয়েছে** (dashboard/user/provider/booking/dispute/notification/coupon/category — সব RW; শুধু wallet/payment-এর write action আর role/settings management বাদ, যেগুলো design review-তে আলাদা tier-এ ভাগ করার সিদ্ধান্ত হয়েছিল)।

### Regression নিশ্চয়তা (আপনার শর্ত অনুযায়ী)
- **Route URL অপরিবর্তিত** — `adminRoutes.js`/`disputeRoutes.js`/`searchRoutes.js`-এর কোনো path বদলায়নি
- **Controller logic অপরিবর্তিত** — `adminController.js`, `walletAdminController.js`, `notificationAdminController.js`, `reconciliationAdminController.js`, `disputeController.js`, `searchController.js`-এর **একটা ফাংশনও এডিট করা হয়নি** — শুধু route ফাইলে middleware বদলেছে
- **Request/Response format অপরিবর্তিত** — controller-ই response বানায়, তাতে হাত দেওয়া হয়নি
- পুরো codebase grep করে যাচাই করা হয়েছে — `requireRole('ADMIN')`-এর আর কোনো ব্যবহার অবশিষ্ট নেই (`grep -rln "requireRole('ADMIN')" src` → খালি ফলাফল)

---

## Regression Report

**পদ্ধতি:** এই sandbox-এ DB না থাকায় (আগের মডিউলগুলোর মতোই) বাস্তব রান দেখানো যায়নি। যা করা হয়েছে:

1. `tests/unit/permissionMiddleware.test.js` — ৯টা টেস্ট: SUPER_ADMIN bypass, mustChangePassword gate (ও তার exception change-password-এর জন্য), granted/denied permission উভয় পথ, inactive profile denial, no-profile denial, audit log-এ real status code capture
2. Static verification: প্রতিটা migrated route ফাইলে controller import অপরিবর্তিত (diff-এ শুধু middleware লাইন বদলেছে)
3. **আপনার করণীয়:** `npm install && npm run test:coverage`; staging-এ migration চালিয়ে প্রতিটা tier (SUPER_ADMIN, ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, MODERATOR) দিয়ে আগের প্রতিটা endpoint ম্যানুয়ালি hit করে দেখা উচিত deploy-এর আগে

**Deploy checklist এই মডিউলের জন্য:**
```bash
npx prisma migrate dev --name admin_dashboard_rbac
npm run seed:admin-rbac   # Permission + RolePermission + AdminProfile bootstrap
```
এরপর seed admin (ফোন `01700000000`) দিয়ে লগইন করে **প্রথমেই `POST /api/admin/change-password`** কল করতে হবে — এর আগে সেই অ্যাকাউন্ট দিয়ে অন্য কিছুই করা যাবে না (`mustChangePassword=true`)।

**Known gap:** MFA schema-তে reserved (`mfaEnabled`/`mfaSecret` ফিল্ড আছে) কিন্তু actual MFA flow implement করা হয়নি — future scope হিসেবে রাখা হলো, যেমনটা আলোচনা হয়েছিল।
