const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

const SLOT_MINUTES = 60; // MVP: fixed 1-hour slots. Per-listing custom durations are a future improvement.

// Provider sets/replaces their full weekly schedule in one call.
// body: { schedule: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }, ...] }
async function setWeeklyAvailability(req, res) {
  const { schedule } = req.body;
  if (!Array.isArray(schedule)) return error(res, 'schedule must be an array');

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Create your provider profile first', 400);

  await prisma.$transaction([
    prisma.providerAvailability.deleteMany({ where: { providerId: profile.id } }),
    prisma.providerAvailability.createMany({
      data: schedule.map((s) => ({
        providerId: profile.id,
        dayOfWeek: s.dayOfWeek,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
      })),
    }),
  ]);

  const saved = await prisma.providerAvailability.findMany({ where: { providerId: profile.id } });
  return success(res, saved, 'সাপ্তাহিক সময়সূচি সেভ হয়েছে');
}

async function getMyWeeklyAvailability(req, res) {
  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Provider profile not found', 404);

  const schedule = await prisma.providerAvailability.findMany({ where: { providerId: profile.id } });
  return success(res, schedule);
}

// Public: computes open 1-hour slots for a given provider on a given date,
// based on their weekly schedule minus already-booked times that day.
// query: ?date=YYYY-MM-DD
async function getAvailableSlots(req, res) {
  const { providerId } = req.params;
  const { date } = req.query;
  if (!date) return error(res, 'date query param (YYYY-MM-DD) is required');

  const targetDate = new Date(`${date}T00:00:00`);
  const dayOfWeek = targetDate.getDay();

  const weeklyRules = await prisma.providerAvailability.findMany({
    where: { providerId, dayOfWeek },
  });
  if (weeklyRules.length === 0) return success(res, []);

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  const existingBookings = await prisma.booking.findMany({
    where: {
      providerId,
      scheduledTime: { gte: dayStart, lte: dayEnd },
      status: { in: ['PENDING', 'ACCEPTED'] },
    },
    select: { scheduledTime: true },
  });
  const bookedHours = new Set(existingBookings.map((b) => new Date(b.scheduledTime).getHours()));

  const now = new Date();
  const slots = [];

  weeklyRules.forEach((rule) => {
    for (let minute = rule.startMinute; minute + SLOT_MINUTES <= rule.endMinute; minute += SLOT_MINUTES) {
      const hour = Math.floor(minute / 60);
      const slotTime = new Date(targetDate);
      slotTime.setHours(hour, minute % 60, 0, 0);

      if (slotTime <= now) continue; // অতীতের স্লট বাদ
      if (bookedHours.has(hour)) continue; // ইতিমধ্যে বুকড

      slots.push(slotTime.toISOString());
    }
  });

  return success(res, slots.sort());
}

module.exports = { setWeeklyAvailability, getMyWeeklyAvailability, getAvailableSlots };
