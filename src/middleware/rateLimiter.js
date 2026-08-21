const rateLimit = require('express-rate-limit');
const redisService = require('../services/redisService');

// A minimal express-rate-limit Store backed by RedisService.incrWithTTL().
// Deliberately NOT using the rate-limit-redis package — going through our
// own RedisService keeps this on the same connection, and inherits its
// automatic in-memory fallback for free instead of needing a second,
// separately-configured fallback path.
class RedisRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const ttlSeconds = Math.ceil(this.windowMs / 1000);
    const totalHits = await redisService.incrWithTTL(`ratelimit:${this.prefix}:${key}`, ttlSeconds);
    return { totalHits, resetTime: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async decrement() {
    // Not needed for our limiters (they don't use skipFailedRequests), so
    // this is intentionally a no-op rather than a half-correct decrement.
  }

  async resetKey(key) {
    await redisService.del(`ratelimit:${this.prefix}:${key}`);
  }
}

// OTP spam / SMS-bomb protection: max 3 OTP requests per IP per 15 min
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many OTP requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('otp'),
});

// Login brute-force protection: max 8 attempts per IP per 15 min across all login routes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('login'),
});

module.exports = { otpLimiter, loginLimiter };
