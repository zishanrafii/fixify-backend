const { z } = require('zod');

const createBookingSchema = z.object({
  listingId: z.string().trim().min(1, 'listingId is required'),
  addressId: z.string().trim().min(1, 'addressId is required'),
  scheduledTime: z.string().trim().refine((v) => !isNaN(Date.parse(v)), 'scheduledTime must be a valid date'),
  bookingType: z.enum(['SCHEDULED', 'INSTANT', 'EMERGENCY']).optional(),
  isRecurring: z.boolean().optional(),
  recurrenceRule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
});

const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation reason is required').max(500),
});

const rescheduleBookingSchema = z.object({
  scheduledTime: z.string().trim().refine((v) => !isNaN(Date.parse(v)), 'scheduledTime must be a valid date'),
});

const createAddressSchema = z.object({
  label: z.string().trim().max(50).optional(),
  addressLine: z.string().trim().min(3, 'addressLine is required').max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().optional(),
});

module.exports = {
  createBookingSchema,
  cancelBookingSchema,
  rescheduleBookingSchema,
  createAddressSchema,
};
