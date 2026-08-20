const bcrypt = require('bcryptjs');
const redisService = require('./redisService');

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5;

function hashKey(phone) {
  return `otp:hash:${phone}`;
}
function attemptsKey(phone) {
  return `otp:attempts:${phone}`;
}

async function generateOTP(phone) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hash = await bcrypt.hash(otp, 10);
  await redisService.set(hashKey(phone), hash, OTP_TTL_SECONDS);
  await redisService.del(attemptsKey(phone)); // fresh OTP resets any prior attempt count
  return otp;
}

async function verifyOTP(phone, otp) {
  const hash = await redisService.get(hashKey(phone));
  if (!hash) return false; // no OTP pending, or it expired

  const attempts = await redisService.incrWithTTL(attemptsKey(phone), OTP_TTL_SECONDS);
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    await redisService.del(hashKey(phone)); // burn it — force a fresh /send-otp
    await redisService.del(attemptsKey(phone));
    return false;
  }

  const isValid = await bcrypt.compare(otp, hash);
  if (isValid) {
    await redisService.del(hashKey(phone));
    await redisService.del(attemptsKey(phone));
  }
  return isValid;
}

module.exports = { generateOTP, verifyOTP };
