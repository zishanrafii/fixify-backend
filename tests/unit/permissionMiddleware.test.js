jest.mock('../../src/config/db', () => ({
  adminProfile: { findUnique: jest.fn() },
  permission: { findUnique: jest.fn() },
  rolePermission: { findUnique: jest.fn() },
  adminAuditLog: { create: jest.fn() },
}));

const prisma = require('../../src/config/db');
const { permissionMiddleware, CHANGE_PASSWORD_ACTION } = require('../../src/middleware/permissionMiddleware');

function mockRes() {
  const listeners = {};
  return {
    statusCode: 200,
    on: (event, cb) => { listeners[event] = cb; },
    _trigger: (event) => listeners[event] && listeners[event](),
  };
}

describe('permissionMiddleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('denies (401) if req.user is missing', async () => {
    const req = { user: null };
    const res = mockRes();
    const next = jest.fn();
    await permissionMiddleware('users.view')(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('denies and audit-logs if the caller has no AdminProfile', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue(null);
    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'GET', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('users.view')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wasDenied: true }) })
    );
  });

  test('SUPER_ADMIN bypasses the permission table entirely', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN', isActive: true, mustChangePassword: false });
    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'GET', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('roles.manage')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(prisma.permission.findUnique).not.toHaveBeenCalled(); // never even checks the table
  });

  test('mustChangePassword blocks every action except CHANGE_PASSWORD_ACTION', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'ADMIN', isActive: true, mustChangePassword: true });
    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'GET', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('users.view')(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('mustChangePassword still allows CHANGE_PASSWORD_ACTION through, without checking RolePermission', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'ADMIN', isActive: true, mustChangePassword: true });
    const req = { user: { id: 'u1' }, params: {}, body: { newPassword: 'x' }, method: 'POST', originalUrl: '/change-password', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware(CHANGE_PASSWORD_ACTION)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(prisma.rolePermission.findUnique).not.toHaveBeenCalled();
  });

  test('ADMIN with a granted RolePermission passes', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'ADMIN', isActive: true, mustChangePassword: false });
    prisma.permission.findUnique.mockResolvedValue({ id: 'p1', key: 'users.suspend' });
    prisma.rolePermission.findUnique.mockResolvedValue({ id: 'rp1' });
    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'PATCH', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('users.suspend')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('ADMIN WITHOUT a granted RolePermission is denied (e.g. roles.manage)', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'ADMIN', isActive: true, mustChangePassword: false });
    prisma.permission.findUnique.mockResolvedValue({ id: 'p2', key: 'roles.manage' });
    prisma.rolePermission.findUnique.mockResolvedValue(null); // no grant for ADMIN

    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'PUT', originalUrl: '/roles/ADMIN/permissions', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('roles.manage')(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('an inactive AdminProfile is denied even if the role would otherwise qualify', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN', isActive: false, mustChangePassword: false });
    const req = { user: { id: 'u1' }, params: {}, body: {}, method: 'GET', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('dashboard.view')(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('logs the real response status code on allow, via res.on(finish)', async () => {
    prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN', isActive: true, mustChangePassword: false });
    const req = { user: { id: 'u1' }, params: { id: 'target1' }, body: {}, method: 'PATCH', originalUrl: '/x', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await permissionMiddleware('users.suspend', 'User')(req, res, next);
    res.statusCode = 200;
    res._trigger('finish');

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wasDenied: false, statusCode: 200, targetId: 'target1' }) })
    );
  });
});
