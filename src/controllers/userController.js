const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

// Fields any user (customer or provider) can update on their own account.
async function updateProfile(req, res) {
  const userId = req.user.id;
  const { name, avatarUrl, coverPhotoUrl, address, latitude, longitude, languages, preferredLanguage } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(coverPhotoUrl !== undefined && { coverPhotoUrl }),
      ...(address !== undefined && { address }),
      ...(latitude !== undefined && { latitude }),
      ...(longitude !== undefined && { longitude }),
      ...(languages !== undefined && { languages }),
      ...(preferredLanguage !== undefined && { preferredLanguage }),
    },
  });

  const { passwordHash, ...safeUser } = user;
  return success(res, safeUser, 'প্রোফাইল আপডেট হয়েছে');
}

// Referral code + a simple summary of how many people have been rewarded so
// far, for the Referral screen in the app.
async function getMyReferralStats(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return error(res, 'User not found', 404);

  const referredUsers = await prisma.user.findMany({
    where: { referredById: req.user.id },
    select: { id: true, name: true, referralBonusGranted: true, createdAt: true },
  });

  const rewardedCount = referredUsers.filter((u) => u.referralBonusGranted).length;

  return success(res, {
    referralCode: user.referralCode,
    totalReferred: referredUsers.length,
    rewardedCount,
    referrals: referredUsers,
  });
}

// Customer/provider submits an ID document photo/URL for verification.
// Sets status to PENDING — an admin reviews and flips it to VERIFIED/REJECTED
// (admin review queue is a Phase 3 item, not built yet — see TASKS.md).
async function submitIdVerification(req, res) {
  const { idDocumentUrl } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { idDocumentUrl, idVerificationStatus: 'PENDING' },
  });

  const { passwordHash, ...safeUser } = user;
  return success(res, safeUser, 'আইডি ভেরিফিকেশনের জন্য জমা হয়েছে, রিভিউ চলছে');
}

// Submits a selfie for face verification. Fixed: selfieUrl is now actually
// persisted (previously accepted in the request but never saved — the
// `selfieUrl` column didn't exist on User until this module's review).
// Real face-match logic (vs the ID photo) is deferred as an AI feature.
async function submitFaceVerification(req, res) {
  const { selfieUrl } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { selfieUrl, faceVerificationStatus: 'PENDING' },
  });

  const { passwordHash, ...safeUser } = user;
  return success(res, safeUser, 'ফেস ভেরিফিকেশনের জন্য জমা হয়েছে, রিভিউ চলছে');
}

module.exports = { updateProfile, getMyReferralStats, submitIdVerification, submitFaceVerification };
