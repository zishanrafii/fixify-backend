# Wallet Module — Migration Summary & Regression Report

## Files Changed ও কেন

| ফাইল | পরিবর্তন |
|---|---|
| `prisma/schema.prisma` | `Wallet`/`WalletTransaction`/`LedgerEntry` — deprecated মার্ক করা হলো (ডিলিট না, historical read-access-এর জন্য থেকে যাবে)। নতুন: `Account`, `LedgerTransaction`, `WithdrawalRequest` + সংশ্লিষ্ট enum |
| `src/services/ledgerService.js` (নতুন) | Core double-entry engine — `moveMoney`, `getOrCreateSystemAccount`, `getOrCreateUserAccount` |
| `src/services/marketingCreditService.js` (নতুন) | Referral/cashback/promo credit — সবসময় `PLATFORM_MARKETING_POOL` থেকে, `PLATFORM_REVENUE` থেকে সম্পূর্ণ আলাদা |
| `src/services/walletService.js` | **পুরো ভেতরটা নতুন ledger ব্যবহার করে, কিন্তু exported ফাংশনের নাম/সিগনেচার/রিটার্ন-শেপ অপরিবর্তিত** — নিচে বিস্তারিত |
| `src/controllers/walletController.js` | নতুন ledger থেকে balance/history পড়ে (paginated), withdrawal এখন `WithdrawalRequest` + atomic reservation দিয়ে |
| `src/controllers/adminController.js` | `listPendingWithdrawals`/`processWithdrawal` নতুন `WithdrawalRequest` মডেল ব্যবহার করে, guarded/atomic (আগের TOCTOU race ফিক্সড) |
| `src/controllers/walletAdminController.js` (নতুন) | Marketing credit grant, generic adjustment, financial report (revenue vs marketing expense আলাদা) |
| `src/services/reconciliation/reconciliationEngine.js` | Orphaned-escrow check এখন নতুন `LedgerTransaction` চেক করে (পুরনো `LedgerEntry`-তে আর কিছু লেখা হয় না বলে) |
| `src/routes/walletRoutes.js`, `src/routes/adminRoutes.js` | নতুন endpoint যোগ (additive) |
| `prisma/scripts/migrate-wallet-to-ledger.js` (নতুন) | One-off migration script |
| `tests/unit/ledgerService.test.js`, `tests/unit/walletService.regression.test.js` (নতুন) | Unit + regression tests |

---

## ✅ Booking Module-এর Public API ও Business Behavior — কিছুই বদলায়নি

আপনার শর্ত অনুযায়ী যাচাই করা হয়েছে:

- `bookingController.js`, `disputeController.js`, `bookingExpiryJob.js` — **এই তিনটা ফাইলের একটা লাইনও পরিবর্তন করা হয়নি এই কাজে।** তিনটাই এখনো `require('../services/walletService')` থেকে ঠিক আগের মতোই `releaseEscrowForBooking`/`refundEscrowForBooking` import ও call করছে (grep দিয়ে confirm করা হয়েছে)।
- `Payment.status` transition logic **অক্ষত**: `escrow_held → success` (release) এবং `escrow_held → refunded` (refund) guard শব্দে-শব্দে আগের মতোই।
- Return shape অপরিবর্তিত: `{ alreadyProcessed: true }` বা `{ alreadyProcessed: false, providerPayout, commission }` / `{ alreadyProcessed: false, refundedAmount }` — Booking module যা আশা করে, ঠিক তাই পাচ্ছে।
- Booking API routes (`/api/bookings/...`), state machine, transition rules — কিছুই টাচ করা হয়নি।

---

## যা বদলেছে (শুধু Wallet Module-এর architecture)

- `Wallet`/`WalletTransaction` আর লেখা হয় না — `Account`/`LedgerTransaction` একমাত্র উৎস
- `creditWallet` ফাংশন **সরানো হয়েছে** পুরো codebase grep করে যাচাই করার পর যে এর কোনো caller নেই (শুধু walletService নিজেই ব্যবহার করত, যেটা এখন সরাসরি `moveMoney` কল করে)
- Withdrawal flow: request → reserve (atomic, double-withdraw impossible) → admin approve/reject → settle

---

## Migration চালানোর ধাপ

```bash
npx prisma migrate dev --name wallet_ledger_rewrite
npm run migrate:wallet-ledger   # prisma/scripts/migrate-wallet-to-ledger.js
```

স্ক্রিপ্টটা idempotent — দুইবার চালালেও সমস্যা নেই (deterministic `idempotencyKey` দিয়ে duplicate ধরা পড়ে)। প্রতিটা ইউজারের বর্তমান `Wallet.balance`-কে নতুন `Account`-এ কপি করে, আর একটা "opening balance" ledger entry (`EXTERNAL_GATEWAY → account`) লেখে যাতে নতুন ledger দিন থেকেই zero-sum হিসেবে balance করে। পুরনো প্রতিটা `WalletTransaction`-ও archival record হিসেবে নতুন ledger-এ কপি হয় (balance-এ প্রভাব ফেলে না, শুধু ইতিহাস দেখার জন্য)।

**সীমাবদ্ধতা (honest disclosure):** Migration-পূর্ব ইতিহাসের প্রতিটা লেনদেনের সঠিক from/to account নিখুঁতভাবে reconstruct করা সম্ভব না (পুরনো ডেটা মডেলে সেই তথ্য ছিলই না) — তাই historical entry-গুলো best-effort, `metadata.migrated=true` দিয়ে ট্যাগ করা। Cutover-এর পর থেকে সব entry সম্পূর্ণ নিখুঁত double-entry।

---

## Regression Report

**পদ্ধতি:** এই sandbox-এ network/DB access নেই, তাই বাস্তব DB-তে end-to-end রান করে দেখানো সম্ভব হয়নি (Auth module-এর coverage report-এও একই সীমাবদ্ধতা জানিয়েছিলাম)। যা করেছি:

1. **Static import verification** — Booking module-এর তিনটা ফাইল-ই এখনো ঠিক একই ফাংশন নাম import করছে `walletService.js` থেকে (grep-এ confirmed, উপরে দেখানো)
2. **Unit tests লেখা হয়েছে** (`tests/unit/ledgerService.test.js`, `tests/unit/walletService.regression.test.js`) যা যাচাই করে:
   - `releaseEscrowForBooking`/`refundEscrowForBooking`-এর Payment-status guard query (`where: { bookingId, status: 'escrow_held' }`) অক্ষত
   - Return shape অপরিবর্তিত
   - Idempotent no-op path (Payment already processed) কাজ করছে
   - `moveMoney`-এর balance guard, idempotency, EXTERNAL_* exemption সব ঠিকভাবে কাজ করছে
3. **আপনার করণীয়:** `npm install && npm run test:coverage` — real pass/fail দেখতে

**পরামর্শ:** production deploy করার আগে staging DB-তে migration script চালিয়ে একটা পুরো booking lifecycle (create → accept → complete → escrow release) manually verify করে নেওয়া উচিত, যেহেতু এই sandbox-এ সেটা করা যায়নি।

---

## নতুন API (additive, Booking-এর সাথে সম্পর্কহীন)

| Method | Path |
|---|---|
| GET | `/api/wallet/me` (paginated হলো) |
| GET | `/api/wallet/withdrawals/me` |
| POST | `/api/wallet/withdraw` (নতুন reservation flow) |
| POST | `/api/admin/wallet/marketing-credit` |
| POST | `/api/admin/wallet/adjustment` |
| GET | `/api/admin/wallet/financial-report` — revenue বনাম marketing expense আলাদা, `campaignId`-ready |
