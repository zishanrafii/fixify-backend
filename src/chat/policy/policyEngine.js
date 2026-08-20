const prisma = require('../../config/db');
const { detectAll } = require('./detectorRegistry');

const DEFAULT_PHASE_MAPPING = {
  PENDING: 'BEFORE_BOOKING',
  ACCEPTED: 'BEFORE_BOOKING',
  IN_PROGRESS: 'DURING_BOOKING',
  COMPLETED: 'AFTER_BOOKING',
  CANCELLED_BY_CUSTOMER: 'AFTER_BOOKING',
  CANCELLED_BY_PROVIDER: 'AFTER_BOOKING',
  REJECTED: 'AFTER_BOOKING',
  EXPIRED: 'AFTER_BOOKING',
  DISPUTED: 'DURING_BOOKING',
};

// Non-booking conversations (support/admin) have no booking-status phase —
// this is also a configurable default, not hardcoded to a single value.
const DEFAULT_NO_BOOKING_PHASE = 'DURING_BOOKING';

async function getPhaseMapping() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'chat.booking_phase_mapping' } });
  return setting ? { ...DEFAULT_PHASE_MAPPING, ...setting.value } : DEFAULT_PHASE_MAPPING;
}

async function getNoBookingPhase() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'chat.no_booking_phase' } });
  return setting ? setting.value : DEFAULT_NO_BOOKING_PHASE;
}

async function resolvePhase(conversation) {
  if (!conversation.bookingId) return getNoBookingPhase();

  const booking = await prisma.booking.findUnique({ where: { id: conversation.bookingId } });
  if (!booking) return getNoBookingPhase();

  const mapping = await getPhaseMapping();
  return mapping[booking.status] || DEFAULT_NO_BOOKING_PHASE;
}

async function getPolicyMode(phase) {
  const policy = await prisma.communicationPolicy.findUnique({ where: { phase } });
  return policy ? policy.mode : 'OFF'; // fail-open by default if never configured
}

// Returns:
//   { action: 'ALLOW' }
//   { action: 'ALLOW_FLAGGED', matches }   // WARN
//   { action: 'HOLD_FOR_REVIEW', matches } // REVIEW
//   { action: 'BLOCK', matches }           // BLOCK
async function evaluateMessage(conversation, text) {
  const matches = await detectAll(text);
  if (matches.length === 0) return { action: 'ALLOW', matches: [] };

  const phase = await resolvePhase(conversation);
  const mode = await getPolicyMode(phase);

  if (mode === 'OFF') return { action: 'ALLOW', matches, phase };
  if (mode === 'WARN') return { action: 'ALLOW_FLAGGED', matches, phase };
  if (mode === 'REVIEW') return { action: 'HOLD_FOR_REVIEW', matches, phase };
  if (mode === 'BLOCK') return { action: 'BLOCK', matches, phase };
  return { action: 'ALLOW', matches, phase };
}

module.exports = { evaluateMessage, resolvePhase, getPolicyMode, DEFAULT_PHASE_MAPPING };
