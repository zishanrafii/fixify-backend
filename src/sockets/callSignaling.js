const prisma = require('../config/db');

// WebRTC signaling relay over the same authenticated Socket.io connection.
// The actual audio/video stream goes peer-to-peer; this only relays the
// SDP offer/answer and ICE candidates needed to establish that connection,
// plus logs call history (CallLog) for the call history / earnings screens.
//
// Note on group calling: true multi-party calls need an SFU media server
// (e.g. mediasoup/LiveKit) — a peer-to-peer mesh relay like this one doesn't
// scale past ~3-4 participants and doesn't fit the platform's 1:1 booking
// model anyway. Deferred; see TASKS.md.
//
// Client flow:
//   caller  -> emit('call_user',    { bookingId, targetUserId, offer, callType })
//   callee  -> on('incoming_call',  { bookingId, fromUserId, offer, callType, callId })
//   callee  -> emit('answer_call',  { bookingId, targetUserId, answer, callId })
//   caller  -> on('call_answered',  { bookingId, fromUserId, answer })
//   both    -> emit('ice_candidate',{ targetUserId, candidate })
//   both    -> emit('end_call',     { bookingId, targetUserId, callId })

function registerCallSignaling(io) {
  // Track which socket belongs to which user so we can target a specific person
  const userSockets = new Map(); // userId -> socketId

  io.on('connection', (socket) => {
    userSockets.set(socket.user.id, socket.id);

    socket.on('call_user', async ({ bookingId, targetUserId, offer, callType }) => {
      // caller ও targetUserId সত্যিই এই bookingId-এর customer/provider জোড়া
      // কিনা যাচাই - chatService.js-এর assertParticipant()-এর একই স্পিরিট,
      // কল সিগন্যালিং-এর জন্য। আগে এই চেক ছিল না - যেকোনো authenticated user
      // যেকোনো targetUserId-কে call করতে পারতো এবং যেকোনো bookingId দিয়ে
      // fabricated CallLog তৈরি করতে পারতো।
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { customerId: true, provider: { select: { userId: true } } },
      });
      if (!booking) return socket.emit('call_error', { message: 'Booking not found' });

      const participantIds = [booking.customerId, booking.provider.userId];
      const isAuthorizedCallPair =
        participantIds.includes(socket.user.id) &&
        participantIds.includes(targetUserId) &&
        socket.user.id !== targetUserId;
      if (!isAuthorizedCallPair) {
        return socket.emit('call_error', { message: 'You are not authorized to call for this booking' });
      }

      const targetSocketId = userSockets.get(targetUserId);
      if (!targetSocketId) return socket.emit('call_error', { message: 'User is offline' });

      const callLog = await prisma.callLog.create({
        data: {
          bookingId,
          callerId: socket.user.id,
          calleeId: targetUserId,
          type: callType === 'VOICE' ? 'VOICE' : 'VIDEO',
          status: 'RINGING',
        },
      });

      io.to(targetSocketId).emit('incoming_call', {
        bookingId,
        fromUserId: socket.user.id,
        offer,
        callType,
        callId: callLog.id,
      });
      socket.emit('call_initiated', { callId: callLog.id });
    });

    socket.on('answer_call', async ({ bookingId, targetUserId, answer, callId }) => {
      const targetSocketId = userSockets.get(targetUserId);

      if (callId) {
        await prisma.callLog.update({
          where: { id: callId },
          data: { status: 'ONGOING', connectedAt: new Date() },
        }).catch(() => {});
      }

      if (!targetSocketId) return;
      io.to(targetSocketId).emit('call_answered', {
        bookingId,
        fromUserId: socket.user.id,
        answer,
      });
    });

    socket.on('ice_candidate', ({ targetUserId, candidate }) => {
      const targetSocketId = userSockets.get(targetUserId);
      if (!targetSocketId) return;

      io.to(targetSocketId).emit('ice_candidate', {
        fromUserId: socket.user.id,
        candidate,
      });
    });

    socket.on('end_call', async ({ targetUserId, callId }) => {
      if (callId) {
        const log = await prisma.callLog.findUnique({ where: { id: callId } }).catch(() => null);
        if (log) {
          const endedAt = new Date();
          const durationSeconds = log.connectedAt
            ? Math.round((endedAt - log.connectedAt) / 1000)
            : 0;
          await prisma.callLog.update({
            where: { id: callId },
            data: {
              status: log.connectedAt ? 'COMPLETED' : 'MISSED',
              endedAt,
              durationSeconds,
            },
          }).catch(() => {});
        }
      }

      const targetSocketId = userSockets.get(targetUserId);
      if (targetSocketId) io.to(targetSocketId).emit('call_ended', { fromUserId: socket.user.id });
    });

    socket.on('disconnect', () => {
      userSockets.delete(socket.user.id);
    });
  });
}

module.exports = registerCallSignaling;
