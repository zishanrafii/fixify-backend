const prisma = require('../config/db');
const redisService = require('../services/redisService');
const { evaluateMessage } = require('./policy/policyEngine');

const SEND_RATE_LIMIT = 30; // messages per user per minute
const SEND_RATE_WINDOW_SECONDS = 60;

// Booking statuses that mean "the parties are allowed to talk" — anything
// before ACCEPTED (i.e. still PENDING) has no confirmed booking yet, so no
// chat. This only READS Booking.status; nothing in the Booking module is
// touched or modified.
const CHAT_ALLOWED_BOOKING_STATUSES = [
  'ACCEPTED', 'IN_PROGRESS', 'COMPLETED',
  'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'EXPIRED', 'DISPUTED',
];

class ChatError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Lazily gets or creates the CUSTOMER_PROVIDER conversation for a booking.
// Never called from bookingController.js — this is entirely Chat-module-
// owned; it's invoked the first time either party opens the chat.
async function getOrCreateBookingConversation(bookingId, requestingUserId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { provider: true },
  });
  if (!booking) throw new ChatError('Booking not found', 'NOT_FOUND');

  const isCustomer = booking.customerId === requestingUserId;
  const isProvider = booking.provider.userId === requestingUserId;
  if (!isCustomer && !isProvider) throw new ChatError('আপনি এই বুকিং-এর অংশ না', 'FORBIDDEN');

  if (!CHAT_ALLOWED_BOOKING_STATUSES.includes(booking.status)) {
    throw new ChatError('বুকিং কনফার্ম হওয়ার আগে চ্যাট শুরু করা যাবে না', 'BOOKING_NOT_CONFIRMED');
  }

  const existing = await prisma.conversation.findUnique({ where: { bookingId } });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      type: 'CUSTOMER_PROVIDER',
      bookingId,
      participants: {
        create: [
          { userId: booking.customerId, role: 'CUSTOMER' },
          { userId: booking.provider.userId, role: 'PROVIDER' },
        ],
      },
    },
  });
}

async function assertParticipant(conversationId, userId) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw new ChatError('আপনি এই কথোপকথনের অংশ না', 'FORBIDDEN');
  return participant;
}

async function checkRateLimit(userId) {
  const count = await redisService.incrWithTTL(`chat:rate:${userId}`, SEND_RATE_WINDOW_SECONDS);
  if (count > SEND_RATE_LIMIT) throw new ChatError('অনেক দ্রুত মেসেজ পাঠাচ্ছেন, একটু ধীরে', 'RATE_LIMITED');
}

// Creates a message, applying the Communication Policy Engine. Returns
// { message, policyOutcome, deliverToOthers } — deliverToOthers is false
// for BLOCK (nothing to deliver) and REVIEW (held pending moderation).
async function createMessage({ conversationId, senderId, type, text, attachment }) {
  await assertParticipant(conversationId, senderId);
  await checkRateLimit(senderId);

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.status !== 'ACTIVE') {
    throw new ChatError('এই কথোপকথন এখন সক্রিয় না', 'CONVERSATION_INACTIVE');
  }

  let policyOutcome = { action: 'ALLOW', matches: [] };
  if (type === 'TEXT' && text) {
    policyOutcome = await evaluateMessage(conversation, text);
  }

  if (policyOutcome.action === 'BLOCK') {
    // Still recorded for audit — but never delivered, and sender is told why.
    await prisma.message.create({
      data: { conversationId, senderId, type, text, status: 'BLOCKED', isFlagged: true },
    });
    throw new ChatError('এই মেসেজে সরাসরি যোগাযোগের তথ্য থাকার কারণে পাঠানো যায়নি', 'POLICY_BLOCKED');
  }

  const status = policyOutcome.action === 'HOLD_FOR_REVIEW' ? 'PENDING_REVIEW' : 'SENT';
  const isFlagged = policyOutcome.action !== 'ALLOW';

  const message = await prisma.message.create({
    data: {
      conversationId, senderId, type, text, status, isFlagged,
      ...(attachment && {
        attachments: {
          create: [{
            url: attachment.url, fileName: attachment.fileName, fileSizeBytes: attachment.fileSizeBytes,
            mimeType: attachment.mimeType, durationSeconds: attachment.durationSeconds,
            latitude: attachment.latitude, longitude: attachment.longitude,
          }],
        },
      }),
    },
    include: { attachments: true, sender: { select: { id: true, name: true, avatarUrl: true } } },
  });

  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });

  return { message, policyOutcome, deliverToOthers: policyOutcome.action !== 'HOLD_FOR_REVIEW' };
}

async function markDelivered(messageId, userId) {
  try {
    return await prisma.messageDelivery.create({ data: { messageId, userId } });
  } catch (err) {
    if (err.code === 'P2002') return null; // already marked — idempotent no-op
    throw err;
  }
}

async function markRead(conversationId, userId, upToMessageId) {
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: new Date() },
  });

  const message = await prisma.message.findUnique({ where: { id: upToMessageId } });
  if (!message) return;

  try {
    await prisma.messageRead.create({ data: { messageId: upToMessageId, userId } });
  } catch (err) {
    if (err.code !== 'P2002') throw err; // already read — idempotent no-op
  }
}

module.exports = {
  ChatError,
  getOrCreateBookingConversation,
  assertParticipant,
  createMessage,
  markDelivered,
  markRead,
  CHAT_ALLOWED_BOOKING_STATUSES,
};
