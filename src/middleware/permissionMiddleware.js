const prisma = require('../config/db');
const { error } = require('../utils/responseHandler');
const { logAdminAction } = require('../services/adminAuditService');

const CHANGE_PASSWORD_ACTION = 'account.change_password';

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

// permissionMiddleware(actionKey, targetType?)
//
// Usage: router.patch('/users/:id/toggle-suspension', authMiddleware,
//   permissionMiddleware('users.suspend', 'User'), toggleUserSuspension);
//
// Must run AFTER authMiddleware (needs req.user.id). Looks up the caller's
// AdminProfile, then:
//  1. If they have no active AdminProfile at all -> deny.
//  2. If mustChangePassword is set -> deny everything except the
//     change-password action itself (applies even to SUPER_ADMIN).
//  3. SUPER_ADMIN -> always allowed (hardcoded, not driven by the
//     RolePermission table — see file header).
//  4. Otherwise -> allowed only if RolePermission has a row for
//     (adminRole, actionKey).
//
// Every decision is audit-logged: denials immediately (we already know the
// outcome), allowances via a res.on('finish') hook so the logged entry
// includes the real HTTP status code the controller ended up returning.
function permissionMiddleware(actionKey, targetType = null) {
  return async (req, res, next) => {
    const adminUserId = req.user && req.user.id;
    if (!adminUserId) return error(res, 'Unauthorized', 401);

    const profile = await prisma.adminProfile.findUnique({ where: { userId: adminUserId } });

    const deny = async (message) => {
      await logAdminAction({
        adminUserId, action: actionKey, method: req.method, path: req.originalUrl,
        targetType, targetId: req.params.id || null, requestSummary: req.body,
        wasDenied: true, ...requestMeta(req),
      });
      return error(res, message, 403);
    };

    if (!profile || !profile.isActive) return deny('Admin access required');

    if (profile.mustChangePassword && actionKey !== CHANGE_PASSWORD_ACTION) {
      return deny('প্রথমে আপনার পাসওয়ার্ড পরিবর্তন করতে হবে');
    }

    if (actionKey === CHANGE_PASSWORD_ACTION) {
      req.adminProfile = profile;
      res.on('finish', () => {
        logAdminAction({
          adminUserId, action: actionKey, method: req.method, path: req.originalUrl,
          targetType, targetId: adminUserId, requestSummary: { note: 'password change — body not logged' },
          statusCode: res.statusCode, wasDenied: false, ...requestMeta(req),
        });
      });
      return next();
    }

    let allowed = profile.adminRole === 'SUPER_ADMIN'; // hardcoded bypass — see file header

    if (!allowed) {
      const permission = await prisma.permission.findUnique({ where: { key: actionKey } });
      if (permission) {
        const grant = await prisma.rolePermission.findUnique({
          where: { adminRole_permissionId: { adminRole: profile.adminRole, permissionId: permission.id } },
        });
        allowed = !!grant;
      }
    }

    if (!allowed) return deny('এই অ্যাকশনের অনুমতি নেই');

    req.adminProfile = profile;
    res.on('finish', () => {
      logAdminAction({
        adminUserId, action: actionKey, method: req.method, path: req.originalUrl,
        targetType, targetId: req.params.id || null, requestSummary: req.body,
        statusCode: res.statusCode, wasDenied: false, ...requestMeta(req),
      });
    });

    next();
  };
}

module.exports = { permissionMiddleware, CHANGE_PASSWORD_ACTION };
