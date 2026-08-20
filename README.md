# Skill Marketplace — Backend

## Setup

```bash
npm install
cp .env.example .env
# .env ফাইলে DATABASE_URL ও JWT_SECRET বসান

npx prisma migrate dev --name init
npm run prisma:seed   # Electrician, Plumber, Tutor, Photographer, Cook ক্যাটাগরি বসাবে
npm run dev
```

Server চালু হবে: `http://localhost:5000`

## Redis সেটআপ (OTP, Rate Limiting, ও পরে Wallet/Booking/Notification/Cache-এর জন্য)

**Local development:**
```bash
docker compose up -d redis
# .env এ REDIS_URL=redis://localhost:6379 বসান
```
`REDIS_URL` খালি রাখলেও চলবে — তখন in-memory fallback ব্যবহার হবে (`src/services/redisService.js`), কিন্তু সেটা **শুধু single-instance** dev/test-এর জন্য; একাধিক server instance/process চালালে Redis অবশ্যই লাগবে, নাহলে OTP/rate-limit counter প্রতিটা instance-এ আলাদা হয়ে যাবে।

**Production সুপারিশ:**
- Managed Redis ব্যবহার করুন (AWS ElastiCache, Upstash, Redis Cloud, ইত্যাদি) — নিজে Redis হোস্ট না করাই ভালো
- `REDIS_URL`-এ TLS ব্যবহার করুন (`rediss://...`)
- Multi-instance/load-balanced deploy করলে `REDIS_URL` **অবশ্যই সেট থাকতে হবে** — fallback শুধু আপনাকে বাঁচাবে যদি Redis সাময়িকভাবে ডাউন হয়ে যায়, permanent সমাধান হিসেবে না
- Eviction policy `noeviction` বা `volatile-lru` রাখুন যাতে OTP/rate-limit key হারিয়ে না যায় ভুলবশত

## যা রেডি আছে (Phase 1 + 2 + 3 + 4)
- User signup/login (phone + OTP + password)
- JWT authentication middleware + role-based access
- Prisma schema (সব model: User, ProviderProfile, ServiceListing, Booking, Review, Message, Payment)
- Provider profile তৈরি ও listing CRUD
- Category + location (Haversine distance) ভিত্তিক সার্চ
- Booking create → accept/reject/complete flow
- **রিয়েল-টাইম চ্যাট** — Socket.io দিয়ে, JWT দিয়ে অথেন্টিকেটেড, মেসেজ DB-তে সেভ হয়
- **WebRTC কল সিগন্যালিং** — voice/video call এর SDP/ICE relay
- **রিভিউ সিস্টেম** — বুকিং COMPLETED হলে রিভিউ দেওয়া যায়, provider এর average rating অটো-আপডেট হয়
- **পেমেন্ট** — SSLCommerz ইন্টিগ্রেশন (sandbox-রেডি, স্টোর আইডি বসালেই লাইভ)
- **ছবি আপলোড** — listing/profile ছবির জন্য (এখন লোকাল ডিস্কে, প্রোডাকশনে S3/Firebase Storage দিয়ে বদলান)
- **Push notification** — নতুন বুকিং, স্ট্যাটাস আপডেট, নতুন মেসেজে FCM push যায়

## Firebase Push Notification সেটআপ

1. Firebase Console এ প্রজেক্ট বানান
2. Project Settings → Service Accounts → Generate New Private Key
3. ডাউনলোড হওয়া JSON ফাইলটাকে `serviceAccountKey.json` নামে backend রুটে রাখুন (এটা `.gitignore` এ আছে, কমিট হবে না)
4. মোবাইল অ্যাপ থেকে `POST /api/notifications/register-token` কল হলেই push কাজ শুরু করবে

## Socket.io ব্যবহার (ক্লায়েন্ট সাইড)

```js
const socket = io('http://localhost:5000', { auth: { token: jwtToken } });

// চ্যাট
socket.emit('join_booking_room', bookingId);
socket.emit('send_message', { bookingId, text: 'হ্যালো' });
socket.on('receive_message', (msg) => { /* ... */ });

// কল
socket.emit('call_user', { bookingId, targetUserId, offer });
socket.on('incoming_call', ({ fromUserId, offer }) => { /* ... */ });
socket.emit('answer_call', { bookingId, targetUserId, answer });
socket.on('call_answered', ({ answer }) => { /* ... */ });
socket.emit('ice_candidate', { targetUserId, candidate });
```

## API Endpoints

### Auth
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/auth/send-otp | `{ phone }` | OTP পাঠায় (এখন console.log এ, পরে SMS gateway) |
| POST | /api/auth/signup | `{ phone, otp, name, password, role }` | নতুন অ্যাকাউন্ট তৈরি করে |
| POST | /api/auth/login | `{ phone, password }` | লগইন করে JWT টোকেন দেয় |

### Provider (JWT + role=PROVIDER প্রয়োজন)
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/providers/profile | `{ bio, experienceYears, serviceAreaRadiusKm, latitude, longitude }` | প্রোফাইল তৈরি/আপডেট |
| GET | /api/providers/profile/me | — | নিজের প্রোফাইল + listings দেখা |
| POST | /api/providers/listings | `{ categoryId, title, description, price, photos }` | নতুন সার্ভিস লিস্টিং |
| GET | /api/providers/listings/me | — | নিজের সব লিস্টিং |
| PATCH | /api/providers/listings/:id | `{ title, description, price, photos }` | লিস্টিং আপডেট |
| DELETE | /api/providers/listings/:id | — | লিস্টিং ডিলিট |

### Search (পাবলিক)
| Method | Endpoint | Query | বিবরণ |
|---|---|---|---|
| GET | /api/search | `categoryId, lat, lng, radiusKm` | ক্যাটাগরি ও দূরত্ব অনুযায়ী প্রোভাইডার খোঁজা |
| GET | /api/search/categories | — | সব সার্ভিস ক্যাটাগরির লিস্ট |

### Booking (JWT প্রয়োজন)
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/bookings | `{ listingId, scheduledTime }` | কাস্টমার বুকিং রিকোয়েস্ট পাঠায় |
| GET | /api/bookings/me | — | নিজের সব বুকিং (customer/provider হিসেবে) |
| PATCH | /api/bookings/:id/status | `{ status }` (ACCEPTED/REJECTED/COMPLETED/CANCELLED) | বুকিং স্ট্যাটাস আপডেট |

### Reviews
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/reviews | `{ bookingId, rating, comment }` | কাস্টমার রিভিউ দেয় (শুধু COMPLETED বুকিং-এ) |
| GET | /api/reviews/provider/:providerId | — | একজন প্রোভাইডারের সব রিভিউ |

### Chat
| Method | Endpoint | বিবরণ |
|---|---|---|
| GET | /api/chat/:bookingId/messages | নির্দিষ্ট বুকিং-এর মেসেজ হিস্টোরি (JWT প্রয়োজন) |

### Payment
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/payments/start | `{ bookingId }` | পেমেন্ট শুরু করে, SSLCommerz গেটওয়ে URL রিটার্ন করে |
| POST | /api/payments/callback/:status | SSLCommerz পাঠায় | success/fail/cancel কলব্যাক হ্যান্ডেল করে |

### Upload (JWT প্রয়োজন)
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/upload | `multipart/form-data`, ফিল্ড নাম `images` (max 5) | ছবি আপলোড করে URL রিটার্ন করে |

### Notifications (JWT প্রয়োজন)
| Method | Endpoint | Body | বিবরণ |
|---|---|---|---|
| POST | /api/notifications/register-token | `{ fcmToken }` | ডিভাইসের push token রেজিস্টার করে |

## পরের ধাপ (Phase 5 — Polish ও Launch)
- Push notification (Firebase Cloud Messaging)
- Admin panel ও provider ভেরিফিকেশন
- Testing (Android + iOS) ও Play Store/App Store প্রস্তুতি
- React Native ফ্রন্টএন্ড অ্যাপ
