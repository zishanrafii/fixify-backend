const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { permissionMiddleware, CHANGE_PASSWORD_ACTION } = require('../middleware/permissionMiddleware');
const {
  getDashboardStats,
  listUsers,
  toggleUserSuspension,
  listPendingVerifications,
  reviewIdVerification,
  reviewFaceVerification,
  listPendingWithdrawals,
  processWithdrawal,
  createCoupon,
  listCoupons,
  deleteCoupon,
} = require('../controllers/adminController');
const {
  triggerReconciliation,
  getReconciliationQueue,
  resolveReconciliationItem,
} = require('../controllers/reconciliationAdminController');
const {
  grantMarketingCreditAdmin,
  adjustUserBalance,
  getFinancialReport,
} = require('../controllers/walletAdminController');
const {
  listTemplates,
  upsertTemplate,
  getDeadLetterQueue,
  retryDeadLetterItem,
} = require('../controllers/notificationAdminController');
const {
  getOverview, getRevenueAnalytics, getBookingTrends, getUserGrowth, getProviderGrowth,
  getCategoryPerformance, getCityAnalytics, getTopProviders, getRetention, getRepeatBookingRate,
} = require('../controllers/adminDashboardController');
const { listProviders, listBookings } = require('../controllers/adminManagementController');
const {
  listPermissions, getPermissionMatrix, updateRolePermissions,
  listAdmins, grantAdminAccess, revokeAdminAccess, changeOwnPassword,
} = require('../controllers/adminRoleController');
const { listAuditLogs } = require('../controllers/adminAuditController');
const { listSettings, upsertSetting, sendBroadcast } = require('../controllers/adminSettingsController');
const {
  listConversations, getConversationMessages, lockConversation, archiveConversation,
  listReports, resolveReport,
  getPolicies, updatePolicy, listDetectionRules, upsertDetectionRule,
  listPendingReviewMessages, approveMessage, rejectMessage,
} = require('../controllers/chatAdminController');

const perm = (key, targetType) => [authMiddleware, permissionMiddleware(key, targetType)];

router.get('/dashboard', perm('dashboard.view'), getDashboardStats);

router.get('/users', perm('users.view', 'User'), listUsers);
router.patch('/users/:id/toggle-suspension', perm('users.suspend', 'User'), toggleUserSuspension);

router.get('/verifications/pending', perm('providers.view', 'User'), listPendingVerifications);
router.patch('/verifications/:userId/id', perm('providers.verify', 'User'), reviewIdVerification);
router.patch('/verifications/:userId/face', perm('providers.verify', 'User'), reviewFaceVerification);

router.get('/withdrawals/pending', perm('wallet.view', 'WithdrawalRequest'), listPendingWithdrawals);
router.patch('/withdrawals/:transactionId', perm('wallet.approve', 'WithdrawalRequest'), processWithdrawal);

router.get('/coupons', perm('coupons.view', 'Coupon'), listCoupons);
router.post('/coupons', perm('coupons.manage', 'Coupon'), createCoupon);
router.delete('/coupons/:id', perm('coupons.manage', 'Coupon'), deleteCoupon);

router.post('/reconciliation/run', perm('payment.reconcile', 'Payment'), triggerReconciliation);
router.get('/reconciliation/queue', perm('payment.view', 'Payment'), getReconciliationQueue);
router.patch('/reconciliation/queue/:id/resolve', perm('payment.reconcile', 'Payment'), resolveReconciliationItem);

router.post('/wallet/marketing-credit', perm('wallet.adjust', 'Account'), grantMarketingCreditAdmin);
router.post('/wallet/adjustment', perm('wallet.adjust', 'Account'), adjustUserBalance);
router.get('/wallet/financial-report', perm('reports.view'), getFinancialReport);

router.get('/notifications/templates', perm('notifications.view', 'NotificationTemplate'), listTemplates);
router.put('/notifications/templates/:key', perm('notifications.manage', 'NotificationTemplate'), upsertTemplate);
router.get('/notifications/dlq', perm('notifications.view'), getDeadLetterQueue);
router.post('/notifications/dlq/:id/retry', perm('notifications.manage'), retryDeadLetterItem);

// --- Own account (works even mid mustChangePassword — see permissionMiddleware.js) ---
router.post('/change-password', authMiddleware, permissionMiddleware(CHANGE_PASSWORD_ACTION), changeOwnPassword);

// --- Dashboard & Analytics ---
router.get('/dashboard/overview', perm('dashboard.view'), getOverview);
router.get('/analytics/revenue', perm('reports.view'), getRevenueAnalytics);
router.get('/analytics/bookings/trends', perm('reports.view'), getBookingTrends);
router.get('/analytics/users/growth', perm('reports.view'), getUserGrowth);
router.get('/analytics/providers/growth', perm('reports.view'), getProviderGrowth);
router.get('/analytics/categories/performance', perm('reports.view'), getCategoryPerformance);
router.get('/analytics/cities', perm('reports.view'), getCityAnalytics);
router.get('/analytics/providers/top', perm('reports.view'), getTopProviders);
router.get('/analytics/retention', perm('reports.view'), getRetention);
router.get('/analytics/repeat-booking-rate', perm('reports.view'), getRepeatBookingRate);

// --- Provider & Booking management (User management's listUsers is above) ---
router.get('/providers', perm('providers.view', 'ProviderProfile'), listProviders);
router.get('/bookings', perm('bookings.view', 'Booking'), listBookings);

// --- Role & Permission management (SUPER_ADMIN hardcoded for writes) ---
router.get('/permissions', perm('roles.manage'), listPermissions);
router.get('/roles/matrix', perm('roles.manage'), getPermissionMatrix);
router.put('/roles/:role/permissions', perm('roles.manage'), updateRolePermissions);
router.get('/admins', perm('roles.manage', 'AdminProfile'), listAdmins);
router.post('/admins', perm('roles.manage', 'AdminProfile'), grantAdminAccess);
router.patch('/admins/:id/revoke', perm('roles.manage', 'AdminProfile'), revokeAdminAccess);

// --- Audit Logs ---
router.get('/audit-logs', perm('audit.view', 'AdminAuditLog'), listAuditLogs);

// --- System Settings ---
router.get('/settings', perm('settings.view'), listSettings);
router.put('/settings/:key', perm('settings.manage', 'SystemSetting'), upsertSetting);

// --- Broadcast ---
router.post('/broadcast', perm('notifications.broadcast'), sendBroadcast);

// --- Chat moderation ---
router.get('/chat/conversations', perm('chat.view', 'Conversation'), listConversations);
router.get('/chat/conversations/:id/messages', perm('chat.view_messages', 'Conversation'), getConversationMessages);
router.patch('/chat/conversations/:id/lock', perm('chat.moderate', 'Conversation'), lockConversation);
router.patch('/chat/conversations/:id/archive', perm('chat.moderate', 'Conversation'), archiveConversation);
router.get('/chat/reports', perm('chat.moderate', 'MessageReport'), listReports);
router.patch('/chat/reports/:id', perm('chat.moderate', 'MessageReport'), resolveReport);

router.get('/chat/messages/pending-review', perm('chat.moderate', 'Message'), listPendingReviewMessages);
router.patch('/chat/messages/:id/approve', perm('chat.moderate', 'Message'), approveMessage);
router.patch('/chat/messages/:id/reject', perm('chat.moderate', 'Message'), rejectMessage);

// --- Communication Policy configuration ---
router.get('/chat/policy', perm('chat.policy.manage'), getPolicies);
router.put('/chat/policy/:phase', perm('chat.policy.manage'), updatePolicy);
router.get('/chat/detection-rules', perm('chat.policy.manage'), listDetectionRules);
router.put('/chat/detection-rules/:key', perm('chat.policy.manage'), upsertDetectionRule);

module.exports = router;
