const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

// কুপন কোড ভ্যালিড কিনা যাচাই করে, ভ্যালিড হলে discount তথ্য রিটার্ন করে
// (আসল discount payment শুরু করার সময় প্রয়োগ হয় — startPayment দেখুন)
async function validateCoupon(req, res) {
  const { code } = req.params;

  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!coupon) return error(res, 'কুপন কোড পাওয়া যায়নি', 404);
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return error(res, 'কুপনের মেয়াদ শেষ হয়ে গেছে');
  }
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return error(res, 'এই কুপনের ব্যবহারসীমা শেষ হয়ে গেছে');
  }

  return success(res, {
    code: coupon.code,
    discountPct: coupon.discountPct,
    discountFlat: coupon.discountFlat,
  });
}

// startPayment থেকে কল হয় — coupon.usedCount বাড়ায় (রেস কন্ডিশন এড়াতে atomic increment)
async function incrementCouponUsage(code) {
  await prisma.coupon.update({
    where: { code: code.toUpperCase() },
    data: { usedCount: { increment: 1 } },
  }).catch(() => {}); // কুপন না পেলে চুপচাপ ইগনোর
}

function applyCouponDiscount(amount, coupon) {
  if (!coupon) return amount;
  if (coupon.discountFlat) return Math.max(0, amount - coupon.discountFlat);
  if (coupon.discountPct) return Math.max(0, amount - (amount * coupon.discountPct) / 100);
  return amount;
}

module.exports = { validateCoupon, incrementCouponUsage, applyCouponDiscount };
