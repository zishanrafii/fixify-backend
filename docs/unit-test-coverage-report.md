# Unit Test Coverage Report — Authentication Module

## ⚠️ গুরুত্বপূর্ণ নোট
এই sandbox environment-এ **network access বন্ধ**, তাই `npm install` চালিয়ে Jest রান করে real coverage percentage বের করা সম্ভব হয়নি। নিচের সব টেস্ট **লেখা হয়েছে ও syntax-validated**, কিন্তু আসল সংখ্যা (line/branch %) পেতে আপনাকে নিজের মেশিনে চালাতে হবে:

```bash
npm install
npm run test:coverage
```

এটা চালালে `coverage/lcov-report/index.html`-এ সম্পূর্ণ ভিজুয়াল রিপোর্ট পাবেন। নিচেরটা সেই রিপোর্টের জায়গায় একটা **manual/qualitative summary** — কোন ফাংশন টেস্ট করা হয়েছে, কোনটা হয়নি — যাতে `npm run test:coverage` চালানোর আগেও বুঝতে পারেন কী আছে।

## যা টেস্ট করা হয়েছে (ফাইল অনুযায়ী)

| ফাইল | টেস্ট করা হয়েছে | টেস্ট করা হয়নি |
|---|---|---|
| `src/validators/authValidators.js` | সবকটা schema (send-otp, signup, login, email-login, social-login) — valid/invalid উভয় কেস | — সম্পূর্ণ কভার |
| `src/utils/otpGenerator.js` | generate (hash+TTL+attempts reset), verify (সঠিক/ভুল OTP, no-pending-OTP, max-attempts burn) | Redis নিজে (mocked) — integration test-এ কভার হবে |
| `src/services/tokenService.js` | `generateAccessToken` (payload+TTL), `issueRefreshToken` (hash generation), `rotateRefreshToken` (৪টা branch: not-found, reuse-detected, expired, valid-rotation), `revokeRefreshToken`, `revokeAllUserTokens` | Prisma-এর real DB behavior (mocked) |
| `src/services/socialAuthVerifiers.js` | Google (valid, email not verified, verification failure), Apple (valid, verification failure), Facebook (valid, invalid token, app-id mismatch) | Real provider API call (mocked — network access লাগে) |
| `src/services/redisService.js` | ❌ টেস্ট লেখা হয়নি | Redis connect/fallback logic — integration-level টেস্ট দরকার (real বা fake Redis লাগবে, নিচে integration plan-এ আছে) |
| `src/services/auditService.js` | ❌ টেস্ট লেখা হয়নি | সহজ passthrough function, best-effort try/catch — নিম্ন অগ্রাধিকার |
| `src/middleware/validate.js` | ❌ সরাসরি টেস্ট লেখা হয়নি (`authValidators.test.js`-এর মাধ্যমে schema পরোক্ষভাবে কভার) | Express middleware wrapper নিজে — integration test-এ কভার হবে |
| `src/middleware/rateLimiter.js` | ❌ টেস্ট লেখা হয়নি | `RedisRateLimitStore` ক্লাস — নিচে gap হিসেবে নোট করলাম |
| `src/controllers/authController.js` | ❌ টেস্ট লেখা হয়নি | HTTP layer — supertest দিয়ে integration test-এ কভার হওয়া উচিত (unit না) |

## আনুমানিক (estimated, measured না) coverage

Pure-logic ফাইলগুলোর (validators, otpGenerator, tokenService, socialAuthVerifiers) জন্য প্রতিটা branch-ই টেস্ট করা হয়েছে বলে ধারণা করছি **৮৫-৯৫% line coverage** পাবেন এই ৪টা ফাইলে। কিন্তু controller/middleware layer টেস্ট না থাকায় **সামগ্রিক module coverage মাঝারি (~৫০-৬০%)** থাকবে যতক্ষণ না integration test যোগ হয় — সংখ্যাটা অনুমান, `npm run test:coverage` চালিয়ে যাচাই করবেন।

## Gap: `RedisRateLimitStore` ও `redisService.js`-এর জন্য টেস্ট নেই
এটা পরবর্তী priority — চাইলে এখনই লিখে দিতে পারি (একটা fake in-memory ioredis mock লাগবে)।
