const express = require('express');
const router = express.Router();
const {
  sendOtp,
  signup,
  login,
  emailLogin,
  socialLogin,
  guestLogin,
  refreshToken,
  logout,
  getMe,
} = require('../controllers/authController');
const { otpLimiter, loginLimiter } = require('../middleware/rateLimiter');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
  sendOtpSchema,
  signupSchema,
  loginSchema,
  emailLoginSchema,
  socialLoginSchema,
} = require('../validators/authValidators');

router.post('/send-otp', otpLimiter, validate(sendOtpSchema), sendOtp);
router.post('/signup', loginLimiter, validate(signupSchema), signup);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/email-login', loginLimiter, validate(emailLoginSchema), emailLogin);
router.post('/social-login', loginLimiter, validate(socialLoginSchema), socialLogin); // { provider: 'GOOGLE'|'APPLE'|'FACEBOOK', providerId, email, name, avatarUrl }
router.post('/guest-login', guestLogin);
router.post('/refresh-token', refreshToken); // { refreshToken }
router.post('/logout', logout); // { refreshToken }
router.get('/me', authMiddleware, getMe);

module.exports = router;
