# Authentication Module — Production Deployment Checklist

## Environment Variables
- [ ] `DATABASE_URL` — production Postgres, connection pooling enabled (PgBouncer বা managed pooler)
- [ ] `JWT_SECRET` — long, random, unique per environment (dev/staging/prod আলাদা)
- [ ] `REDIS_URL` — **mandatory** if deploying more than one instance; TLS (`rediss://`)
- [ ] `ALLOWED_ORIGINS` — actual production domain(s), comma-separated (খালি রাখবেন না প্রোডাকশনে)
- [ ] `GOOGLE_CLIENT_IDS` — সব client ID (Android/iOS/Web)
- [ ] `APPLE_CLIENT_ID` — production Services ID
- [ ] `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` — production app credentials
- [ ] `.env` কোনোভাবে git-এ commit না হওয়া নিশ্চিত করুন (`.gitignore` চেক করুন)

## Database
- [ ] `npx prisma migrate deploy` (migrate dev না — production-এ deploy কমান্ড)
- [ ] `RefreshToken`, `LoginEvent` টেবিল তৈরি হয়েছে কিনা যাচাই
- [ ] Backup/point-in-time recovery চালু আছে কিনা

## Redis
- [ ] Managed Redis provision করা (self-host না)
- [ ] TLS চালু
- [ ] Eviction policy `noeviction` বা `volatile-lru`
- [ ] Multi-instance deploy করলে সব instance একই Redis-এ পয়েন্ট করছে কিনা

## Security
- [ ] Helmet, CORS whitelist, rate limiting — সব active (কোড-এ আছে, শুধু env var মিসিং থাকলে কাজ করবে না)
- [ ] JWT_SECRET rotate করার প্ল্যান আছে কিনা (rotate করলে সব existing access token invalid হবে — জেনেশুনে)
- [ ] HTTPS enforced (load balancer/reverse proxy level-এ)
- [ ] Social provider console-এ (Google/Apple/Facebook) production redirect URI/bundle ID সঠিকভাবে whitelisted

## Monitoring / Observability
- [ ] Error logging (console.error বর্তমানে) কোনো centralized logging service-এ পাঠানো হচ্ছে কিনা (এখনো সেটআপ নেই — gap হিসেবে নোট করছি)
- [ ] Rate-limit hit / failed login spike-এর জন্য alert (এখনো নেই — future improvement)
- [ ] `LoginEvent` টেবিল periodically review/archive করার প্ল্যান

## Smoke Test (deploy-এর পর সাথে সাথে)
- [ ] `/send-otp` → real SMS পৌঁছাচ্ছে
- [ ] Signup → Login → `/me` → Refresh → Logout — পুরো flow end-to-end
- [ ] প্রতিটা social provider দিয়ে একবার করে login test
- [ ] Rate limit trigger করে ৪২৯ পাচ্ছে কিনা

## Rollback Plan
- [ ] আগের migration-এ rollback করার কমান্ড রেডি রাখুন
- [ ] Redis fallback (in-memory) আছে বলে Redis আউটেজে auth সম্পূর্ণ বন্ধ হবে না, কিন্তু single-instance সীমাবদ্ধতা মাথায় রাখুন

## Known Gaps (এই checklist অনুযায়ী launch-blocking না, কিন্তু ট্র্যাক করা দরকার)
- Password reset flow implement হয়নি
- Centralized error/log monitoring সেটআপ হয়নি
- Nonce-based replay protection (social login) নেই
