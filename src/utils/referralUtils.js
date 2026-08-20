const prisma = require('../config/db');

// Flat bonus credited to the REFERRER's wallet once the person they referred
// completes their first booking. A flat amount (rather than a % of that
// booking) keeps this simple and predictable for the MVP.
const REFERRAL_BONUS_AMOUNT = 50;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easier to read/type

function randomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// Generates a unique referral code, retrying on the rare collision.
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  // Extremely unlikely fallback: widen with a timestamp fragment
  return `${randomCode()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

module.exports = { REFERRAL_BONUS_AMOUNT, generateUniqueReferralCode };
