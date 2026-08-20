const express = require('express');
const router = express.Router();
const { authMiddleware, blockGuest } = require('../middleware/authMiddleware');
const {
  getBookingConversation,
  startSupportConversation,
  listMyConversations,
  getMessages,
  sendMessageRest,
  markConversationRead,
  reportMessage,
} = require('../controllers/chatController');

router.get('/bookings/:bookingId/conversation', authMiddleware, blockGuest, getBookingConversation);
router.post('/conversations/support', authMiddleware, blockGuest, startSupportConversation);
router.get('/conversations', authMiddleware, listMyConversations);
router.get('/conversations/:id/messages', authMiddleware, getMessages);
router.post('/conversations/:id/messages', authMiddleware, blockGuest, sendMessageRest);
router.patch('/conversations/:id/read', authMiddleware, markConversationRead);
router.post('/messages/:id/report', authMiddleware, reportMessage);

module.exports = router;
