const { z } = require('zod');

// Assumption: Bangladeshi phone numbers, e.g. 01712345678 or +8801712345678.
// Flag to the team if international numbers need to be supported too.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+?88)?01[3-9]\d{8}$/, 'Enter a valid Bangladeshi phone number');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password is too long'); // bcrypt silently truncates beyond 72 bytes

const sendOtpSchema = z.object({
  phone: phoneSchema,
});

const signupSchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().length(6, 'OTP must be 6 digits'),
  name: z.string().trim().min(2, 'Name is too short').max(100),
  password: passwordSchema,
  role: z.enum(['CUSTOMER', 'PROVIDER']).optional(),
  referralCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
});

const emailLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const socialLoginSchema = z.object({
  provider: z.enum(['GOOGLE', 'APPLE', 'FACEBOOK']),
  token: z.string().trim().min(10, 'token is required'), // Google idToken / Apple identityToken / Facebook accessToken
  fullName: z.string().trim().max(100).optional(), // Apple only, first sign-in — unverified, seeding only
});

module.exports = {
  sendOtpSchema,
  signupSchema,
  loginSchema,
  emailLoginSchema,
  socialLoginSchema,
};
