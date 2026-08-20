# Authentication Module — Integration Test Plan

## Setup
- **Tooling:** Jest + Supertest (already added to `devDependencies`)
- **Test database:** আলাদা Postgres DB (`fixify_test`), `.env.test`-এ `DATABASE_URL` আলাদা রাখুন — কখনো dev/prod DB-তে integration test চালাবেন না
- **Test Redis:** `docker-compose.yml`-এর Redis container ব্যবহার করুন, অথবা প্রতিটা টেস্ট suite শেষে `FLUSHDB`
- প্রতিটা test file শুরুতে migration চালানো (`prisma migrate deploy` against test DB), শেষে truncate/cleanup

## Scenarios

### Phone OTP flow
1. `POST /send-otp` → `200`, Redis-এ key সেট হয়েছে যাচাই
2. ভুল formatted phone → `422`
3. একই phone-এ ৪ বার `/send-otp` → ৪র্থটা `429`
4. সঠিক OTP দিয়ে `/signup` → `201`, DB-তে user তৈরি হয়েছে, `accessToken`/`refreshToken` valid format
5. ভুল OTP দিয়ে `/signup` → `400`
6. একই phone দিয়ে দ্বিতীয়বার `/signup` → "already exists" error
7. ৫ বার ভুল OTP দেওয়ার পর সঠিকটাও reject হওয়া (burned) → পরে নতুন `/send-otp` লাগবে
8. `/login` সঠিক phone+password → `200`
9. `/login` ভুল password → `401`
10. Suspended user `/login` → `403`

### Email login
11. `/email-login` সঠিক credential → `200`
12. ভুল credential → `401`

### Social login (মক করা provider verification সহ — real Google/Apple/Facebook API call না করে `jest.mock` দিয়ে verifier স্তর মক করুন)
13. নতুন Google account → নতুন user তৈরি, `201`/`200`
14. একই email-এ আগে থেকে phone-signup করা user থাকলে, verified email-সহ Google login → নতুন account না বানিয়ে existing-এ link
15. Unverified email → link না হয়ে নতুন account তৈরি (isolation বজায় থাকা উচিত)
16. একই user-এ Google + Facebook দুটোই sequentially link করা যাচ্ছে কিনা
17. Invalid/expired provider token → `401`
18. অন্য app-এর জন্য ইস্যু করা Facebook token → `401`

### Refresh token rotation
19. Signup/login-এর পাওয়া `refreshToken` দিয়ে `/refresh-token` → নতুন pair, `200`
20. পুরনো (এখন revoked) `refreshToken` আবার ব্যবহার → `401`, এবং **আগের ধাপের নতুন token-ও** এখন invalid হয়ে গেছে কিনা যাচাই (theft-detection পুরো chain revoke করে)
21. Expired `refreshToken` (DB-তে manually `expiresAt` past বসিয়ে) → `401`
22. Suspended user-এর refresh → `403`, এবং token আসলেই revoke হয়েছে কিনা DB-তে

### Logout / Me
23. `/logout` valid token দিয়ে → `200`, তারপর সেই token দিয়ে `/refresh-token` → `401`
24. `/logout` invalid/missing token দিয়েও → `200` (idempotent)
25. `/me` valid access token → `200`, সঠিক user data
26. `/me` expired/invalid access token → `401`
27. Admin suspend করার পর ওই user-এর সব refresh token বাতিল হয়েছে কিনা (adminController-এর সাথে cross-check)

### Rate limiting (Redis-backed)
28. দুটো আলাদা Node process (একই Redis)-এ থেকে একই IP simulate করে rate limit শেয়ার হচ্ছে কিনা — multi-instance সত্যিকারের সুবিধা যাচাই
29. Redis বন্ধ অবস্থায় rate limiting এখনো কাজ করছে কিনা (in-memory fallback)

## Out of scope এই plan-এ
- Load/performance testing (আলাদা plan দরকার হলে জানাবেন)
- Penetration testing / security audit (third-party দিয়ে করানো ভালো)
