# API Inconsistency Report

**কোনো কোড এই রিপোর্টের ভিত্তিতে পরিবর্তন করা হয়নি — শুধু documentation যোগ হয়েছে। নিচের প্রতিটা ফিক্স করার আগে আপনার approval লাগবে।**

সম্পূর্ণ backend-এর ১৬টা route ফাইল (~১২৩টা endpoint) systematically review করে যা পাওয়া গেছে:

## ✅ ভালো খবর — যা consistent
- **Response envelope সম্পূর্ণ consistent**: প্রতিটা endpoint `src/utils/responseHandler.js`-এর একই `success()`/`error()` ব্যবহার করে — সব জায়গায় `{ success, message, data }` / `{ success, message }`। কোনো ব্যতিক্রম পাইনি।
- **404 ব্যবহার consistent**: "not found" এর প্রতিটা কেস 404 রিটার্ন করে (৩০+ জায়গা চেক করেছি, সব মিলেছে)।
- **Booking transition endpoint-এর verb-in-path প্যাটার্ন** (`/accept`, `/reject` ইত্যাদি) — এটা inconsistency না, ইচ্ছাকৃত ডিজাইন (প্রতিটা transition-এর আলাদা permission/side-effect আছে, generic `PATCH /:id { status }` দিয়ে করলে bug-prone হতো — Booking module design doc-এই এটা ব্যাখ্যা করা আছে)।

## ⚠️ পাওয়া inconsistency

### ১. Validation approach — দুই ভিন্ন প্যাটার্ন
Auth/User/Provider/Address/Booking module Zod `validate()` middleware ব্যবহার করে (কেন্দ্রীভূত schema, `422` status)। কিন্তু Wallet/Payment/Notification/Chat/Admin Dashboard/Dispute module-এর route কোনো Zod middleware ব্যবহার করে না — controller-এর ভেতরে ম্যানুয়াল `if (!field) return error(...)` চেক (default `400` status)।

**প্রভাব:** একই ধরনের "missing required field" ভুলের জন্য কোথাও `422` কোথাও `400` আসে — client-side error-handling-এ predictability কমায়।

**সুপারিশ (fix না, শুধু প্রস্তাব):** নতুন module-গুলোতেও Zod validator যোগ করা, অথবা পুরো codebase-এ সিদ্ধান্ত নেওয়া যে "validation failure = 422" সবখানে standard হবে।

### ২. `PATCH /api/admin/withdrawals/{transactionId}` — নামকরণ legacy
Wallet Module-এর ledger rewrite-এর সময় `WalletTransaction` মডেল (যেখানে param-এর নাম `transactionId` সার্থক ছিল) সরে গিয়ে `WithdrawalRequest` মডেল এসেছে — কিন্তু path param-এর নাম আপডেট হয়নি, এখনো `transactionId` বলে, বাস্তবে এটা `WithdrawalRequest.id`।

**সুপারিশ:** `:id`-তে rename (path বদলাবে না, শুধু param-এর নাম — যদিও req.params key বদলালে controller-এর একটা লাইন বদলাতে হবে, তাই এটাও technically একটা controller change, approval দরকার)।

### ৩. Category management endpoint-এর ভুল জায়গায় থাকা
`POST/PATCH/DELETE /api/search/categories` — admin-only write endpoint, কিন্তু `/api/search` (পাবলিক প্রিফিক্স)-এর নিচে বসানো, `/api/admin`-এর নিচে না। ফাংশনালি ঠিকভাবে কাজ করে (permission middleware দিয়ে গার্ডেড), কিন্তু placement অস্বাভাবিক — অন্য সব admin-write endpoint `/api/admin/*`-এর নিচে।

**সুপারিশ:** `/api/admin/categories`-এ সরানো (route file পাল্টাতে হবে, `searchRoutes.js`-এ শুধু read-only থাকবে)।

### ৪. Financial report endpoint-এর tag/placement mismatch
`GET /api/admin/wallet/financial-report` — conceptually এটা analytics/reporting (আমি OpenAPI-তে tag `Analytics` দিয়েছি), কিন্তু URL path-এ `/wallet/`-এর নিচে বসানো, `/api/admin/analytics/*`-এর অন্য ৯টা endpoint-এর সাথে না।

**সুপারিশ:** `/api/admin/analytics/financial-report`-এ সরানো (সামান্য change, কিন্তু URL বদলায় — approval দরকার)।

### ৫. Deprecated endpoint এখনো আছে
`GET /api/admin/dashboard` — Admin Dashboard module-এর `overview` endpoint (`/api/admin/dashboard/overview`) আসার পর এটা কার্যত পুরনো, কম তথ্য দেয়, কিন্তু কখনো সরানো/deprecated মার্ক করা হয়নি কোডে (এই ডকুমেন্টেশন-মডিউলে OpenAPI spec-এ `deprecated: true` মার্ক করেছি, কিন্তু কোড/response-এ কোনো deprecation header নেই)।

**সুপারিশ:** response-এ `Deprecation`/`Sunset` header যোগ করা (নতুন কোড, approval দরকার), অথবা একটা নির্দিষ্ট তারিখে endpoint সরিয়ে ফেলা।

### ৬. Path param naming convention — মিশ্র কিন্তু বেশিরভাগ ইচ্ছাকৃত
বেশিরভাগ resource `:id` ব্যবহার করে, কিছু জায়গায় natural key ব্যবহার হয় (`:key` টেমপ্লেট/সেটিং/detection-rule-এ, `:code` কুপনে, `:phase`/`:role` policy/role endpoint-এ, `:userId` verification endpoint-এ)। এগুলো বেশিরভাগই **ইচ্ছাকৃত ও যুক্তিসঙ্গত** (natural key থাকলে সেটাই ব্যবহার করা ভালো অভ্যাস) — শুধু `#2`-এর `transactionId`-টাই প্রকৃত সমস্যা, বাকিগুলো নোট করে রাখলাম যাতে ভবিষ্যতে ভুল করে "সব `:id` হওয়া উচিত" ধরে নিয়ে fix না করা হয়।

### ৭. Duplicate endpoint — পাওয়া যায়নি
পুরো inventory-তে কোনো সত্যিকারের duplicate route পাইনি। (`/api/users/me` আগে ছিল, Auth module-এর সময়ই সরিয়ে `/api/auth/me`-তে consolidate করা হয়েছিল — সেটা এই রিপোর্টের আগেই resolved।)

## সারসংক্ষেপ — approval-এর অপেক্ষায় থাকা সম্ভাব্য fix

| # | পরিবর্তন | ধরন |
|---|---|---|
| ১ | সব module-এ Zod validation স্ট্যান্ডার্ডাইজ করা | মাঝারি স্কোপ |
| ২ | `transactionId` → `id` rename | ছোট, ১ লাইন controller |
| ৩ | Category admin endpoint `/api/admin/categories`-এ সরানো | route পুনর্বিন্যাস |
| ৪ | Financial report endpoint সরানো | route পুনর্বিন্যাস |
| ৫ | Deprecation header যোগ | নতুন ছোট middleware |

কোনটা করতে চান জানালে, শুধু সেটার জন্য আলাদা approval নিয়ে এগোব — এখন শুধু documentation হিসেবে রিপোর্ট করা হলো।
