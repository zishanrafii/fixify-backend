const { z } = require('zod');

const upsertProviderProfileSchema = z.object({
  bio: z.string().trim().max(2000).optional(),
  experienceYears: z.number().int().min(0).max(80).optional(),
  serviceAreaRadiusKm: z.number().positive().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  skills: z.array(z.string().trim().min(1)).max(50).optional(),
  portfolioImages: z.array(z.string().trim().url()).max(30).optional(),
});

const certificateSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200),
  issuer: z.string().trim().max(200).optional(),
  fileUrl: z.string().trim().url().optional(),
  issuedAt: z.string().trim().optional(), // parsed with `new Date()` in the controller
});

const educationSchema = z.object({
  institution: z.string().trim().min(1, 'institution is required').max(200),
  degree: z.string().trim().max(200).optional(),
  yearEnd: z.number().int().min(1950).max(2100).optional(),
});

const pricingType = z.enum(['FIXED', 'HOURLY', 'PACKAGE', 'SUBSCRIPTION']);

const createListingSchema = z.object({
  categoryId: z.string().trim().min(1, 'categoryId is required'),
  title: z.string().trim().min(1, 'title is required').max(200),
  description: z.string().trim().max(3000).optional(),
  price: z.number().positive('price must be a positive number'),
  photos: z.array(z.string().trim().url()).max(20).optional(),
  pricingType: pricingType.optional(),
  hourlyRate: z.number().positive().optional(),
  packageTiers: z.unknown().optional(), // structured JSON, validated at feature level when packages are built out
  isEmergencyAvailable: z.boolean().optional(),
  isInstantBookingEnabled: z.boolean().optional(),
});

const updateListingSchema = createListingSchema.partial();

module.exports = {
  upsertProviderProfileSchema,
  certificateSchema,
  educationSchema,
  createListingSchema,
  updateListingSchema,
};
