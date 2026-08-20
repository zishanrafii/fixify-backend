const { z } = require('zod');

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  avatarUrl: z.string().trim().url().optional(),
  coverPhotoUrl: z.string().trim().url().optional(),
  address: z.string().trim().max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  languages: z.array(z.string().trim().min(1)).max(20).optional(),
  // অ্যাপের ভাষা তালিকার সাথে backend-কে টাইট-কাপল না করার জন্য নির্দিষ্ট enum
  // ব্যবহার না করে শুধু length-bound স্ট্রিং ভ্যালিডেশন - app-এর সাপোর্টেড ভাষা
  // বদলালেও এখানে কিছু বদলাতে হয় না।
  preferredLanguage: z.string().trim().min(2).max(10).optional(),
});

const idVerificationSchema = z.object({
  idDocumentUrl: z.string().trim().url('A valid idDocumentUrl is required'),
});

const faceVerificationSchema = z.object({
  selfieUrl: z.string().trim().url('A valid selfieUrl is required'),
});

module.exports = { updateProfileSchema, idVerificationSchema, faceVerificationSchema };
