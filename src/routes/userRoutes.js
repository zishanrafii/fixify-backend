const express = require('express');
const router = express.Router();
const { authMiddleware, blockGuest } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
  updateProfile,
  getMyReferralStats,
  submitIdVerification,
  submitFaceVerification,
} = require('../controllers/userController');
const {
  updateProfileSchema,
  idVerificationSchema,
  faceVerificationSchema,
} = require('../validators/userValidators');

router.get('/referral-stats', authMiddleware, getMyReferralStats);
router.patch('/profile', authMiddleware, blockGuest, validate(updateProfileSchema), updateProfile);
router.post('/verification/id', authMiddleware, blockGuest, validate(idVerificationSchema), submitIdVerification);
router.post('/verification/face', authMiddleware, blockGuest, validate(faceVerificationSchema), submitFaceVerification);

module.exports = router;
