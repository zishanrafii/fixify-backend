const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { revokeAllUserTokens } = require('../services/tokenService');

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'MODERATOR'];

async function listPermissions(req, res) {
  const permissions = await prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  return success(res, permissions);
}

// Full matrix: every AdminRole x its granted permission keys.
async function getPermissionMatrix(req, res) {
  const rolePermissions = await prisma.rolePermission.findMany({ include: { permission: true } });
  const matrix = Object.fromEntries(ADMIN_ROLES.map((r) => [r, []]));
  for (const rp of rolePermissions) matrix[rp.adminRole].push(rp.permission.key);
  matrix.SUPER_ADMIN = (await prisma.permission.findMany()).map((p) => p.key); // always all — hardcoded bypass, shown here for transparency
  return success(res, matrix);
}

// PUT /api/admin/roles/:role/permissions { permissionKeys: [...] }
// Hard rule, enforced in code (not just via the permission table itself):
// SUPER_ADMIN's permission set can never be edited through this endpoint —
// editing it here would be exactly the privilege-escalation-via-table-edit
// this whole design is meant to prevent.
async function updateRolePermissions(req, res) {
  const { role } = req.params;
  const { permissionKeys } = req.body;

  if (!ADMIN_ROLES.includes(role)) return error(res, `role must be one of ${ADMIN_ROLES.join(', ')}`);
  if (role === 'SUPER_ADMIN') return error(res, 'SUPER_ADMIN-এর permission এই endpoint দিয়ে বদলানো যাবে না', 403);
  if (!Array.isArray(permissionKeys)) return error(res, 'permissionKeys একটা array হতে হবে');

  const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
  const foundKeys = permissions.map((p) => p.key);
  const unknown = permissionKeys.filter((k) => !foundKeys.includes(k));
  if (unknown.length) return error(res, `অজানা permission key: ${unknown.join(', ')}`);

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { adminRole: role } }),
    prisma.rolePermission.createMany({ data: permissions.map((p) => ({ adminRole: role, permissionId: p.id })) }),
  ]);

  return success(res, {}, `${role}-এর permission আপডেট হয়েছে`);
}

async function listAdmins(req, res) {
  const admins = await prisma.adminProfile.findMany({
    include: { user: { select: { name: true, phone: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return success(res, admins);
}

// POST /api/admin/admins { userId, adminRole }
// Grants admin access to an existing user. Cannot be used to create another
// SUPER_ADMIN — SUPER_ADMIN is bootstrap-only (see prisma/seed-admin-rbac.js);
// promoting one requires a direct DB operation by whoever controls
// infrastructure access, deliberately outside the reach of the API surface.
async function grantAdminAccess(req, res) {
  const { userId, adminRole } = req.body;
  if (!ADMIN_ROLES.includes(adminRole) || adminRole === 'SUPER_ADMIN') {
    return error(res, 'adminRole must be one of ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, MODERATOR');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return error(res, 'User not found', 404);

  const existing = await prisma.adminProfile.findUnique({ where: { userId } });
  if (existing) return error(res, 'এই ইউজারের আগে থেকেই admin access আছে');

  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  const profile = await prisma.adminProfile.create({
    data: { userId, adminRole, createdByUserId: req.user.id },
  });

  return success(res, profile, 'Admin access দেওয়া হয়েছে', 201);
}

// PATCH /api/admin/admins/:id/revoke — deactivates an AdminProfile (never
// deletes it — the grant itself stays in the audit trail forever).
async function revokeAdminAccess(req, res) {
  const { id } = req.params;
  const profile = await prisma.adminProfile.findUnique({ where: { id } });
  if (!profile) return error(res, 'Admin profile not found', 404);
  if (profile.adminRole === 'SUPER_ADMIN') return error(res, 'SUPER_ADMIN access এই endpoint দিয়ে revoke করা যাবে না', 403);

  await prisma.adminProfile.update({ where: { id }, data: { isActive: false } });
  await revokeAllUserTokens(profile.userId);

  return success(res, {}, 'Admin access বাতিল হয়েছে');
}

// POST /api/admin/change-password { currentPassword, newPassword }
// Clears mustChangePassword — this is the only route permissionMiddleware
// allows through while that flag is set (see permissionMiddleware.js).
async function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return error(res, 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword || '', user.passwordHash))) {
    return error(res, 'বর্তমান পাসওয়ার্ড ভুল', 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.adminProfile.update({ where: { userId: user.id }, data: { mustChangePassword: false } }),
  ]);

  await revokeAllUserTokens(user.id); // force re-login with the new password everywhere

  return success(res, {}, 'পাসওয়ার্ড পরিবর্তন হয়েছে, আবার লগইন করুন');
}

module.exports = {
  listPermissions, getPermissionMatrix, updateRolePermissions,
  listAdmins, grantAdminAccess, revokeAdminAccess, changeOwnPassword,
};
