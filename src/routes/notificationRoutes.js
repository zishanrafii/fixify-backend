const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const {
  registerDeviceToken,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
} = require('../controllers/notificationController');

router.post('/register-token', authMiddleware, registerDeviceToken);
router.get('/me', authMiddleware, getMyNotifications);
router.patch('/:id/read', authMiddleware, markAsRead);
router.patch('/read-all', authMiddleware, markAllAsRead);
router.get('/preferences', authMiddleware, getPreferences);
router.put('/preferences', authMiddleware, updatePreferences);

module.exports = router;
