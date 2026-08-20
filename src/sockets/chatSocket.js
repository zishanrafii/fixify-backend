const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const redisService = require('../services/redisService');
const { notify } = require('../notifications/notificationEngine');
const chatService = require('../chat/chatService');

const PRESENCE_TTL_SECONDS = 90; // heartbeat must arrive within this window or the user is considered offline

function presenceKey(userId) {
  return `chat:presence:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation_${conversationId}`;
}

function registerChatSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, role, phone, isGuest }
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    redisService.set(presenceKey(userId), '1', PRESENCE_TTL_SECONDS);

    socket.on('join_conversation', async ({ conversationId }) => {
      if (!conversationId) return;
      try {
        await chatService.assertParticipant(conversationId, userId);
        socket.join(conversationRoom(conversationId));
        io.to(conversationRoom(conversationId)).emit('presence_update', { userId, online: true });
      } catch (err) {
        socket.emit('chat_error', { message: err.message, code: err.code });
      }
    });

    socket.on('leave_conversation', ({ conversationId }) => {
      if (!conversationId) return;
      socket.leave(conversationRoom(conversationId));
    });

    socket.on('heartbeat', () => {
      redisService.set(presenceKey(userId), '1', PRESENCE_TTL_SECONDS);
    });

    socket.on('typing', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(conversationRoom(conversationId)).emit('typing', { userId });
    });

    socket.on('stop_typing', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(conversationRoom(conversationId)).emit('stop_typing', { userId });
    });

    socket.on('send_message', async (payload) => {
      const { conversationId, type, text, attachment } = payload || {};
      if (!conversationId) return socket.emit('chat_error', { message: 'conversationId প্রয়োজন' });
      if (type === 'TEXT' && !text) return socket.emit('chat_error', { message: 'text প্রয়োজন' });
      if (['IMAGE', 'DOCUMENT', 'VOICE'].includes(type) && !attachment?.url) {
        return socket.emit('chat_error', { message: 'attachment প্রয়োজন' });
      }
      if (type === 'LOCATION' && (attachment?.latitude == null || attachment?.longitude == null)) {
        return socket.emit('chat_error', { message: 'latitude/longitude প্রয়োজন' });
      }

      try {
        const { message, policyOutcome, deliverToOthers } = await chatService.createMessage({
          conversationId, senderId: userId, type: type || 'TEXT', text, attachment,
        });

        if (policyOutcome.action === 'ALLOW_FLAGGED') {
          socket.emit('message_flagged', { messageId: message.id, reason: 'possible_contact_info', matches: policyOutcome.matches.map((m) => m.ruleKey) });
        }

        if (!deliverToOthers) {
          // HOLD_FOR_REVIEW — sender gets an ack but the room doesn't see it yet.
          socket.emit('message_received', { ...message, pendingReview: true });
          return;
        }

        io.to(conversationRoom(conversationId)).emit('message_received', message);

        // Offline recipients: push notification via the Notification Module.
        // conversationId থেকে bookingId বের করা হচ্ছে (Conversation.bookingId
        // ইউনিক/1:1, সব conversation-এ থাকে না - যেমন CUSTOMER_SUPPORT টাইপে
        // নেই) - এটা push payload-এ দরকার যাতে অ্যাপ ট্যাপ করলে সঠিক
        // চ্যাটে ডিপ-লিংক করতে পারে (দেখুন pushNotificationService.js)।
        const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { bookingId: true } });
        const participants = await prisma.conversationParticipant.findMany({ where: { conversationId } });
        const others = participants.filter((p) => p.userId !== userId);
        for (const p of others) {
          const isOnline = await redisService.get(presenceKey(p.userId));
          if (!isOnline) {
            const preview = type === 'TEXT' ? text
              : type === 'IMAGE' ? '📷 একটা ছবি পাঠিয়েছেন'
              : type === 'VOICE' ? '🎤 ভয়েস নোট পাঠিয়েছেন'
              : type === 'LOCATION' ? '📍 লোকেশন শেয়ার করেছেন'
              : '📎 একটা ফাইল পাঠিয়েছেন';
            notify(
              'chat.new_message',
              p.userId,
              { senderName: message.sender.name, preview, ...(conversation?.bookingId && { bookingId: conversation.bookingId }) },
              { idempotencySuffix: message.id }
            );
          }
        }
      } catch (err) {
        socket.emit('chat_error', { message: err.message, code: err.code });
      }
    });

    socket.on('mark_delivered', async ({ messageId }) => {
      if (!messageId) return;
      try {
        const delivery = await chatService.markDelivered(messageId, userId);
        if (delivery) {
          const message = await prisma.message.findUnique({ where: { id: messageId } });
          if (message) io.to(conversationRoom(message.conversationId)).emit('message_delivered', { messageId, userId, deliveredAt: delivery.deliveredAt });
        }
      } catch (err) {
        socket.emit('chat_error', { message: err.message, code: err.code });
      }
    });

    socket.on('mark_read', async ({ conversationId, messageId }) => {
      if (!conversationId || !messageId) return;
      try {
        await chatService.markRead(conversationId, userId, messageId);
        io.to(conversationRoom(conversationId)).emit('message_read', { messageId, userId, readAt: new Date() });
      } catch (err) {
        socket.emit('chat_error', { message: err.message, code: err.code });
      }
    });

    socket.on('disconnect', async () => {
      // Grace period: don't flip to "offline" immediately in case of a quick
      // reconnect (network blip) — the presence key's own TTL (90s) handles
      // that naturally; we just persist lastSeenAt here for the profile view.
      await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
    });
  });
}

module.exports = registerChatSocket;
