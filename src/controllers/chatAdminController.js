const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');
const { notify } = require('../notifications/notificationEngine');
const redisService = require('../services/redisService');

function conversationRoom(conversationId) {
  return `conversation_${conversationId}`;
}

function presenceKey(userId) {
  return `chat:presence:${userId}`;
}

// GET /api/admin/chat/conversations?type=&status=&search=
async function listConversations(req, res) {
  const { type, status, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  const where = {
    ...(type && { type }),
    ...(status && { status }),
    ...(search && {
      participants: { some: { user: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } } },
    }),
  };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: { participants: { include: { user: { select: { id: true, name: true, phone: true } } } } },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ]);

  return success(res, { conversations, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// GET /api/admin/chat/conversations/:id/messages
// This is deliberately gated by permissionMiddleware('chat.view_messages', ...)
// in the route (not here) — that's what makes every admin view of private
// message content land in AdminAuditLog, which matters wherever viewing
// private communications requires a legal basis/audit trail.
async function getConversationMessages(req, res) {
  const { id } = req.params;
  const messages = await prisma.message.findMany({
    where: { conversationId: id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { attachments: true, sender: { select: { id: true, name: true } } },
  });
  return success(res, messages);
}

async function lockConversation(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  const updated = await prisma.conversation.update({
    where: { id },
    data: { status: 'LOCKED', lockedReason: reason || null },
  });
  return success(res, updated, 'কথোপকথন লক করা হয়েছে');
}

async function archiveConversation(req, res) {
  const { id } = req.params;
  const updated = await prisma.conversation.update({
    where: { id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  return success(res, updated, 'কথোপকথন আর্কাইভ করা হয়েছে');
}

// GET /api/admin/chat/reports?status=
async function listReports(req, res) {
  const { status = 'OPEN' } = req.query;
  const reports = await prisma.messageReport.findMany({
    where: { status },
    include: { message: { include: { sender: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  return success(res, reports);
}

// PATCH /api/admin/chat/reports/:id { decision: 'REVIEWED' | 'DISMISSED' }
async function resolveReport(req, res) {
  const { id } = req.params;
  const { decision } = req.body;
  if (!['REVIEWED', 'DISMISSED'].includes(decision)) return error(res, 'decision must be REVIEWED or DISMISSED');

  const result = await prisma.messageReport.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: decision, reviewedByUserId: req.user.id, reviewedAt: new Date() },
  });
  if (result.count !== 1) return error(res, 'এই রিপোর্ট ইতিমধ্যে প্রসেস হয়ে গেছে');

  return success(res, {}, 'রিপোর্ট প্রসেস হয়েছে');
}

// --- Communication Policy configuration ---

async function getPolicies(req, res) {
  const policies = await prisma.communicationPolicy.findMany();
  return success(res, policies);
}

async function updatePolicy(req, res) {
  const { phase } = req.params;
  const { mode } = req.body;
  if (!['BEFORE_BOOKING', 'DURING_BOOKING', 'AFTER_BOOKING'].includes(phase)) return error(res, 'অবৈধ phase');
  if (!['OFF', 'WARN', 'REVIEW', 'BLOCK'].includes(mode)) return error(res, 'অবৈধ mode');

  const policy = await prisma.communicationPolicy.upsert({
    where: { phase },
    update: { mode, updatedByUserId: req.user.id },
    create: { phase, mode, updatedByUserId: req.user.id },
  });
  return success(res, policy, 'পলিসি আপডেট হয়েছে');
}

async function listDetectionRules(req, res) {
  const rules = await prisma.detectionRule.findMany({ orderBy: { key: 'asc' } });
  return success(res, rules);
}

async function upsertDetectionRule(req, res) {
  const { key } = req.params;
  const { type, pattern, description, isActive } = req.body;

  const rule = await prisma.detectionRule.upsert({
    where: { key },
    update: {
      ...(type !== undefined && { type }),
      ...(pattern !== undefined && { pattern }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
    },
    create: { key, type: type || 'REGEX', pattern, description: description || key },
  });
  return success(res, rule, 'ডিটেকশন রুল সেভ হয়েছে');
}

module.exports = {
  listConversations, getConversationMessages, lockConversation, archiveConversation,
  listReports, resolveReport,
  getPolicies, updatePolicy, listDetectionRules, upsertDetectionRule,
  listPendingReviewMessages, approveMessage, rejectMessage,
};

// ============================================================================
// REVIEW mode moderation queue
// ----------------------------------------------------------------------------
// Fixes a confirmed bug: a message held as PENDING_REVIEW (chatService.js's
// createMessage(), HOLD_FOR_REVIEW policy action) previously had NO way to
// ever leave that state - no endpoint existed to approve or reject it, so it
// stayed undelivered forever. These three functions are the missing piece.
// Existing policy engine / Booking module logic is untouched - this only
// acts on Message rows that are already PENDING_REVIEW.
// ============================================================================

// GET /api/admin/chat/messages/pending-review
async function listPendingReviewMessages(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
        attachments: true,
        conversation: { select: { id: true, bookingId: true, type: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.message.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);

  return success(res, { messages, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// PATCH /api/admin/chat/messages/:id/approve
async function approveMessage(req, res) {
  const { id } = req.params;

  // guardedTransition-এর একই প্যাটার্ন (bookingController.js) - atomic,
  // শুধু এখনো PENDING_REVIEW থাকলেই এগোয়, ডাবল-অ্যাপ্রুভ/রেস প্রতিরোধ করে।
  const result = await prisma.message.updateMany({
    where: { id, status: 'PENDING_REVIEW' },
    data: { status: 'SENT' },
  });
  if (result.count !== 1) return error(res, 'Message not found or already reviewed', 404);

  const message = await prisma.message.findUnique({
    where: { id },
    include: {
      sender: { select: { id: true, name: true, avatarUrl: true } },
      attachments: true,
      conversation: { select: { id: true, bookingId: true } },
    },
  });

  // এখন প্রকৃত delivery হচ্ছে - chatService.createMessage() এর normal
  // (non-review) পাথ ঠিক যা করতো, সেটাই এখন approval-এর পর ঘটছে।
  const io = req.app.get('io');
  if (io) io.to(conversationRoom(message.conversationId)).emit('message_received', message);

  const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: message.conversationId } });
  const others = participants.filter((p) => p.userId !== message.senderId);
  for (const p of others) {
    const isOnline = await redisService.get(presenceKey(p.userId));
    if (!isOnline) {
      notify(
        'chat.new_message',
        p.userId,
        {
          senderName: message.sender.name,
          preview: message.text || '📎 একটা ফাইল পাঠিয়েছেন',
          ...(message.conversation.bookingId && { bookingId: message.conversation.bookingId }),
        },
        { idempotencySuffix: message.id }
      );
    }
  }

  return success(res, message, 'মেসেজ অনুমোদন করা হয়েছে');
}

// PATCH /api/admin/chat/messages/:id/reject
async function rejectMessage(req, res) {
  const { id } = req.params;

  // BLOCKED স্ট্যাটাস পুনর্ব্যবহার করা হচ্ছে (নতুন enum ভ্যালু/মাইগ্রেশনের
  // দরকার নেই) - recipient-এর দৃষ্টিকোণ থেকে "admin reject করেছে" আর
  // "system block করেছে" কার্যত একই: কখনো deliver হয়নি, history-তে দেখা যায় না।
  const result = await prisma.message.updateMany({
    where: { id, status: 'PENDING_REVIEW' },
    data: { status: 'BLOCKED' },
  });
  if (result.count !== 1) return error(res, 'Message not found or already reviewed', 404);

  const message = await prisma.message.findUnique({ where: { id }, select: { id: true, senderId: true, conversationId: true } });

  // sender এখনো conversation room-এ থাকলে সাথে সাথে জানানো হচ্ছে - recipient
  // এই মেসেজের অস্তিত্বই জানে না (কখনো deliver হয়নি) বলে room-ব্রডকাস্ট
  // নিরাপদ, শুধু sender-ই messageId মিলিয়ে এটাতে react করবে। Offline/
  // persistent কেসের জন্য notify() ব্যবহার হচ্ছে, ঠিক অন্য সব চ্যানেলের মতোই।
  const io = req.app.get('io');
  if (io) io.to(conversationRoom(message.conversationId)).emit('message_rejected', { messageId: message.id, conversationId: message.conversationId });
  notify('chat.message_rejected', message.senderId, {}, { idempotencySuffix: message.id });

  return success(res, {}, 'মেসেজ প্রত্যাখ্যান করা হয়েছে');
}
