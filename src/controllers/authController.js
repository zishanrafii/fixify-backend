const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { generateOTP, verifyOTP } = require('../utils/otpGenerator');
const { success, error } = require('../utils/responseHandler');
const { sendSMS } = require('../services/smsService');
const { generateUniqueReferralCode } = require('../utils/referralUtils');
const {
  generateAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require('../services/tokenService');
const { recordLoginEvent } = require('../services/auditService');
const {
  verifyGoogleToken,
  verifyAppleToken,
  verifyFacebookToken,
} = require('../services/socialAuthVerifiers');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

// Issues both tokens for a user, records the audit log entry, and returns
// the response payload shape used by every login/signup endpoint below.
async function buildAuthResponse(user, req, provider) {
  const accessToken = generateAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, requestMeta(req));
  await recordLoginEvent(user.id, provider, requestMeta(req));
  return { accessToken, refreshToken, user: sanitizeUser(user) };
}

// Step 1: user submits phone -> we send an OTP via SMS gateway
async function sendOtp(req, res) {
  const { phone } = req.body;

  const otp = await generateOTP(phone);
  await sendSMS(phone, `আপনার Fixify OTP কোড: ${otp}। এটা কাউকে শেয়ার করবেন না।`);

  return success(res, {}, 'OTP sent successfully');
}

// Step 2: user submits phone + otp + name + password + role -> account created
async function signup(req, res) {
  const { phone, otp, name, password, role, referralCode } = req.body;

  const isOtpValid = await verifyOTP(phone, otp);
  if (!isOtpValid) return error(res, 'Invalid or expired OTP');

  const existingUser = await prisma.user.findUnique({ where: { phone } });
  if (existingUser) return error(res, 'An account with this phone number already exists');

  // Referral code is optional and best-effort: an invalid/unknown code should
  // never block signup, it just means no referrer gets linked.
  let referredById = null;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    if (referrer) referredById = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newReferralCode = await generateUniqueReferralCode();

  const user = await prisma.user.create({
    data: {
      phone,
      name,
      passwordHash,
      role: role === 'PROVIDER' ? 'PROVIDER' : 'CUSTOMER',
      isVerified: true,
      referralCode: newReferralCode,
      referredById,
    },
  });

  const payload = await buildAuthResponse(user, req, 'PHONE');
  return success(res, payload, 'Account created successfully', 201);
}

// Login with phone + password
async function login(req, res) {
  const { phone, password } = req.body;

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return error(res, 'Invalid phone number or password', 401);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) return error(res, 'Invalid phone number or password', 401);
  if (user.isSuspended) return error(res, 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে, সাপোর্টের সাথে যোগাযোগ করুন', 403);

  const payload = await buildAuthResponse(user, req, 'PHONE');
  return success(res, payload, 'Logged in successfully');
}

// Email + password login (alternative to phone)
async function emailLogin(req, res) {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return error(res, 'Invalid email or password', 401);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) return error(res, 'Invalid email or password', 401);
  if (user.isSuspended) return error(res, 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে, সাপোর্টের সাথে যোগাযোগ করুন', 403);

  const payload = await buildAuthResponse(user, req, 'EMAIL');
  return success(res, payload, 'Logged in successfully');
}

// Finds the account linked to this verified provider id, or links/creates
// one. Linking by email only happens when the provider confirms the email
// is verified — an unverified email must never be used to attach a social
// identity to somebody else's existing account.
async function findOrCreateSocialUser(provider, profile) {
  const idField = { GOOGLE: 'googleId', APPLE: 'appleId', FACEBOOK: 'facebookId' }[provider];

  let user = await prisma.user.findUnique({ where: { [idField]: profile.providerId } });
  if (user) return user;

  if (profile.email && profile.emailVerified) {
    user = await prisma.user.findUnique({ where: { email: profile.email } });
    if (user) {
      return prisma.user.update({ where: { id: user.id }, data: { [idField]: profile.providerId } });
    }
  }

  try {
    return await prisma.user.create({
      data: {
        [idField]: profile.providerId,
        email: profile.emailVerified ? profile.email : null,
        name: profile.name || 'New User',
        avatarUrl: profile.avatarUrl || null,
        authProvider: provider,
        isVerified: true,
        role: 'CUSTOMER',
      },
    });
  } catch (err) {
    // Race: a concurrent request for the same identity created the account
    // first (unique constraint on googleId/appleId/facebookId/email).
    if (err.code === 'P2002') {
      const existing = await prisma.user.findUnique({ where: { [idField]: profile.providerId } });
      if (existing) return existing;
    }
    throw err;
  }
}

// Google/Apple/Facebook login. The client sends only the raw provider token
// (Google idToken, Apple identityToken, or Facebook accessToken) — never a
// self-reported profile. We verify it server-side and derive the profile
// exclusively from the verified payload.
async function socialLogin(req, res) {
  const { provider, token, fullName } = req.body;

  let profile;
  try {
    if (provider === 'GOOGLE') profile = await verifyGoogleToken(token);
    else if (provider === 'APPLE') profile = await verifyAppleToken(token);
    else if (provider === 'FACEBOOK') profile = await verifyFacebookToken(token);
    else return error(res, 'Unsupported provider');
  } catch (err) {
    return error(res, err.message, err.statusCode || 401);
  }

  // Apple's ID token never carries a name — Apple hands it to the client only
  // once, on first authorization. Accepted here purely to seed a brand-new
  // account; never used to overwrite an existing linked account's name.
  if (provider === 'APPLE' && fullName) profile.name = fullName;

  let user;
  try {
    user = await findOrCreateSocialUser(provider, profile);
  } catch (err) {
    return error(res, 'Could not sign in with this account', 500);
  }

  if (user.isSuspended) return error(res, 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে, সাপোর্টের সাথে যোগাযোগ করুন', 403);

  const payload = await buildAuthResponse(user, req, provider);
  return success(res, payload, 'Logged in successfully');
}

// Guest mode: creates a temporary, unauthenticated-feeling browsing account.
// Guests can browse/search but should be blocked from booking/chat by
// checking req.user.isGuest in relevant middleware/controllers.
async function guestLogin(req, res) {
  const user = await prisma.user.create({
    data: {
      name: 'Guest',
      isGuest: true,
      authProvider: 'GUEST',
      role: 'CUSTOMER',
    },
  });
  const payload = await buildAuthResponse(user, req, 'GUEST');
  return success(res, payload, 'Continuing as guest');
}

// Exchanges a valid (unexpired, unrevoked) refresh token for a new access
// token + a new rotated refresh token.
async function refreshToken(req, res) {
  const { refreshToken: rawToken } = req.body;
  if (!rawToken) return error(res, 'refreshToken is required', 400);

  try {
    const { user, rawToken: newRawToken } = await rotateRefreshToken(rawToken, requestMeta(req));
    if (user.isSuspended) return error(res, 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে, সাপোর্টের সাথে যোগাযোগ করুন', 403);

    const accessToken = generateAccessToken(user);
    return success(res, { accessToken, refreshToken: newRawToken }, 'Token refreshed');
  } catch (err) {
    return error(res, err.message, err.statusCode || 401);
  }
}

// Revokes the given refresh token. Access tokens are short-lived (15m) and
// intentionally not blacklisted — they simply expire on their own.
async function logout(req, res) {
  const { refreshToken: rawToken } = req.body;
  if (rawToken) await revokeRefreshToken(rawToken);
  return success(res, {}, 'Logged out successfully');
}

// GET /auth/me — returns the current user's fresh data from the DB (not just
// the JWT payload), so isSuspended/profile changes are always up to date.
async function getMe(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return error(res, 'User not found', 404);
  return success(res, { user: sanitizeUser(user) }, 'Current user');
}

function sanitizeUser(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

module.exports = {
  sendOtp,
  signup,
  login,
  emailLogin,
  socialLogin,
  guestLogin,
  refreshToken,
  logout,
  getMe,
};
