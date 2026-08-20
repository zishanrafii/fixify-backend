# Environment Variables Reference

সম্পূর্ণ তালিকা `.env.example`-এর সাথে মিলিয়ে — কোন module কোন var ব্যবহার করে ও কেন।

## Core
| Variable | Module | বিবরণ |
|---|---|---|
| `PORT` | সব | সার্ভার পোর্ট (default 5000) |
| `APP_BASE_URL` | সব | নিজের base URL (webhook callback ইত্যাদিতে ব্যবহৃত হতে পারে) |
| `DATABASE_URL` | সব | PostgreSQL connection string |
| `JWT_SECRET` | Auth | Access token sign করার secret — লম্বা, random, environment-ভিত্তিক আলাদা |

## Redis (Auth, Wallet, Booking, Notification, Chat)
| Variable | বিবরণ |
|---|---|
| `REDIS_URL` | OTP store, rate limiting, BullMQ queue, Socket.IO horizontal scaling, presence, caching — সব একই Redis। খালি রাখলে single-instance in-memory fallback (production multi-instance-এ **আবশ্যক**) |

## CORS
| Variable | বিবরণ |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated। Mobile app-এ প্রভাব ফেলে না (Origin header পাঠায় না) |

## Social Login (Auth)
| Variable | বিবরণ |
|---|---|
| `GOOGLE_CLIENT_IDS` | Comma-separated সব platform-এর client ID |
| `APPLE_CLIENT_ID` | Apple Services ID |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | |

## SMS (Auth OTP)
| Variable | বিবরণ |
|---|---|
| `SMS_API_KEY` / `SMS_SENDER_ID` | কনফিগার না থাকলে console-এ log হয় (dev fallback) |

## Email (Notification)
| Variable | বিবরণ |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | কনফিগার না থাকলে console-এ log হয় |

## WhatsApp (Job posting alert)
| Variable | বিবরণ |
|---|---|
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API |

## Payment Gateways (Payment, Reconciliation)
| Variable | বিবরণ |
|---|---|
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` | |
| `SSLCOMMERZ_SANDBOX` | `true`/`false` — sandbox বনাম live API endpoint |
| `STRIPE_SECRET_KEY` | |
| `STRIPE_WEBHOOK_SECRET` | **আবশ্যক** — না থাকলে webhook fail-closed (সব event reject) |

## Firebase Push Notification (Notification)
Env var না — `serviceAccountKey.json` ফাইল backend root-এ রাখতে হয় (Firebase Console > Project Settings > Service Accounts)। `.gitignore`-এ আছে, secret হিসেবে ট্রিট করুন।

## Production Checklist
- [ ] `JWT_SECRET`, `STRIPE_WEBHOOK_SECRET` — প্রতিটা environment-এ আলাদা, দীর্ঘ, random
- [ ] `REDIS_URL` — multi-instance deploy করলে mandatory
- [ ] `ALLOWED_ORIGINS` — production domain, খালি না
- [ ] `SSLCOMMERZ_SANDBOX=false` — live যাওয়ার আগে
- [ ] `serviceAccountKey.json` — production Firebase project-এর, repo-তে commit না হওয়া নিশ্চিত করুন
