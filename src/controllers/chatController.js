const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const chatService = require('../chat/chatService');

function conversationRoom(conversationId) {
  return `conversation_${conversationId}`;
}

// GET /api/chat/bookings/:bookingId/conversation — lazily resolves (or
// creates) the CUSTOMER_PROVIDER conversation for a booking. This is how
// clients go from "I have a bookingId" to "I have a conversationId" to join
// on the socket — reads Booking.status only, never writes to it.
async function getBookingConversation(req, res) {
  try {
    const conversation = await chatService.getOrCreateBookingConversation(req.params.bookingId, req.user.id);
    return success(res, conversation);
  } catch (err) {
    return error(res, err.message, err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400);
  }
}

// POST /api/chat/conversations/support — start (or resume) a
// Customer↔Support conversation. One open support conversation per user at
// a time (repeated calls resume the existing one).
async function startSupportConversation(req, res) {
  const existing = await prisma.conversation.findFirst({
    where: { type: 'CUSTOMER_SUPPORT', status: 'ACTIVE', participants: { some: { userId: req.user.id, role: 'CUSTOMER' } } },
  });
  if (existing) return success(res, existing);

  const conversation = await prisma.conversation.create({
    data: {
      type: 'CUSTOMER_SUPPORT',
      participants: { create: [{ userId: req.user.id, role: 'CUSTOMER' }] },
      // A SUPPORT_AGENT participant is added when an admin picks it up
      // (see chatAdminController.js) — support conversations start
      // single-sided, matching how live-chat-support systems typically work.
    },
  });
  return success(res, conversation, 'Support conversation শুরু হয়েছে', 201);
}

// GET /api/chat/conversations — my conversations, most recent first
async function listMyConversations(req, res) {
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: req.user.id } } },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    },
  });
  return success(res, conversations);
}

// GET /api/chat/conversations/:id/messages?cursor=&limit= — cursor-based
// (createdAt+id), not offset — stays fast no matter how large the history.
async function getMessages(req, res) {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  try {
    await chatService.assertParticipant(id, req.user.id);
  } catch (err) {
    return error(res, err.message, 403);
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id, deletedAt: null, status: { not: 'PENDING_REVIEW' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(req.query.cursor && { cursor: { id: req.query.cursor }, skip: 1 }),
    include: { attachments: true, sender: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return success(res, {
    messages: messages.reverse(), // client renders oldest-first
    nextCursor: messages.length === limit ? messages[0].id : null,
  });
}

// POST /api/chat/conversations/:id/messages — REST fallback for clients not
// on a live socket connection right now. Broadcasts via Socket.IO too, so
// anyone who IS connected sees it in real time regardless of which path
// the sender used.
async function sendMessageRest(req, res) {
  const { id } = req.params;
  const { type, text, attachment } = req.body;

  try {
    const { message, policyOutcome, deliverToOthers } = await chatService.createMessage({
      conversationId: id, senderId: req.user.id, type: type || 'TEXT', text, attachment,
    });

    if (deliverToOthers) {
      const io = req.app.get('io');
      if (io) io.to(conversationRoom(id)).emit('message_received', message);
    }

    return success(res, { message, flagged: policyOutcome.action === 'ALLOW_FLAGGED', pendingReview: !deliverToOthers }, 'পাঠানো হয়েছে', 201);
  } catch (err) {
    return error(res, err.message, err.code === 'POLICY_BLOCKED' ? 422 : err.code === 'RATE_LIMITED' ? 429 : 400);
  }
}

// PATCH /api/chat/conversations/:id/read — bulk mark everything up to now read
async function markConversationRead(req, res) {
  const { id } = req.params;
  try {
    await chatService.assertParticipant(id, req.user.id);
  } catch (err) {
    return error(res, err.message, 403);
  }

  const latest = await prisma.message.findFirst({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } });
  if (latest) await chatService.markRead(id, req.user.id, latest.id);

  const io = req.app.get('io');
  if (io && latest) io.to(conversationRoom(id)).emit('message_read', { messageId: latest.id, userId: req.user.id, readAt: new Date() });

  return success(res, {}, 'পড়া হয়েছে হিসেবে চিহ্নিত');
}

// POST /api/chat/messages/:id/report
async function reportMessage(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return error(res, 'reason প্রয়োজন');

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return error(res, 'Message not found', 404);

  try {
    await chatService.assertParticipant(message.conversationId, req.user.id);
  } catch (err) {
    return error(res, err.message, 403);
  }

  const report = await prisma.messageReport.create({
    data: { messageId: id, reportedByUserId: req.user.id, reason },
  });
  return success(res, report, 'রিপোর্ট জমা হয়েছে', 201);
}

module.exports = {
  getBookingConversation, startSupportConversation, listMyConversations,
  getMessages, sendMessageRest, markConversationRead, reportMessage,
};
