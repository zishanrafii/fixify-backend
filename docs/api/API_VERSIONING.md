# API Versioning Policy

## বর্তমান অবস্থা
সব endpoint এখন `/api/*`-এ, কোনো explicit version prefix ছাড়া (যেমন `/api/v1/...` না)। ব্যবহারিকভাবে এটাই **v1** — কিন্তু path-এ সেটা লেখা নেই। **এই ডকুমেন্ট অনুযায়ী কোনো বিদ্যমান route rename করা হয়নি** ("Do NOT change any existing endpoint behavior" — path বদলানো একটা breaking behavior change, তাই করা হয়নি)।

## নীতি (ভবিষ্যতের জন্য)

1. **v1 = সব বর্তমান `/api/*` endpoint** (implicit)। এই স্পেসিফিকেশন সেটাই ডকুমেন্ট করে।
2. **Breaking change** (response shape বদলানো, required field যোগ, path রিনেম) দরকার হলে নতুন prefix চালু হবে: `/api/v2/...`। v1 চলতে থাকবে একটা ঘোষিত deprecation window পর্যন্ত (সুপারিশ: কমপক্ষে ৬ মাস, mobile app-এর release cycle বিবেচনায়)।
3. **Non-breaking change** (নতুন optional field, নতুন endpoint, নতুন enum value যেটা client-এ break করে না) — v1-এই যোগ হবে, নতুন version লাগবে না।
4. **Deprecation marking:** কোনো endpoint deprecated হলে OpenAPI spec-এ `deprecated: true` (এই স্পেসিফিকেশনে ইতিমধ্যে একটা উদাহরণ আছে — `GET /api/admin/dashboard`, `/api/admin/dashboard/overview`-এর পক্ষে deprecated) + response-এ `Deprecation` header যোগ করার সুপারিশ (এখনো implement করা হয়নি, ভবিষ্যতের কাজ)।
5. **Version header (ঐচ্ছিক, ভবিষ্যতে):** ক্লায়েন্ট `Accept-Version: v1` হেডার পাঠাতে পারবে এমন সাপোর্ট ভবিষ্যতে যোগ করা যেতে পারে যদি path-based versioning যথেষ্ট flexible না হয় — এখনই দরকার নেই।

## কেন এখনই path বদলানো হয়নি
Mobile app (React Native) ইতিমধ্যে বর্তমান path-এর সাথে hardcoded — path বদলানো মানে app-এর একটা নতুন release ছাড়া backend deploy করা যাবে না, যেটা এই ডকুমেন্টেশন-মডিউলের scope-এর বাইরে ("Do NOT change any existing endpoint behavior")।
