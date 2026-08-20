# Changelog

## [Unreleased] — API Documentation Module
- OpenAPI 3.1 spec (`docs/api/openapi.json`), Swagger UI at `/api-docs`, Postman collection (auto-generated from the spec)
- Inconsistency report: `docs/api/INCONSISTENCY_REPORT.md`

## Chat & Messaging Module
- General-purpose `Conversation`/`Message` model (replaces booking-scoped chat) — Customer↔Provider, Customer↔Support, Admin↔Customer, Admin↔Provider
- Delivery/read receipts, presence, typing indicators, WebSocket + REST parity
- Communication Policy Engine — configurable (OFF/WARN/REVIEW/BLOCK), phase-scoped, extensible detection rules (no hardcoded rules)
- Auto-start/auto-close tied to booking lifecycle (read-only integration, Booking Module untouched)

## Admin Dashboard & Analytics Module
- RBAC: 5-tier `AdminRole`, granular `Permission`/`RolePermission`, `AdminAuditLog` (every admin action, including denials)
- Dashboard overview + 9 analytics endpoints, `DailyMetricsSnapshot` precompute
- Provider/Booking management (search/filter/sort/export), Role management, System Settings, Broadcast

## Notification Module
- Multi-channel (Push/Email/SMS/In-App), `NotificationTemplate`/`NotificationPreference`, BullMQ queue + DLQ, retry/backoff
- 14 event templates wired across Booking/Payment/Admin flows

## Wallet Module (ledger rewrite)
- Double-entry `Account`/`LedgerTransaction` — single source of truth, superseding the old `Wallet`/`WalletTransaction`
- `PLATFORM_REVENUE`/`PLATFORM_MARKETING_POOL` kept structurally separate
- Withdrawal reservation flow (`WithdrawalRequest`)

## Payment Reconciliation System
- Provider-agnostic reconciliation engine (Stripe/SSLCommerz), scheduled + on-demand, manual review queue

## Booking Module — Financial Consistency Refactor
- Atomic, idempotent escrow release/refund/commission (single Prisma transaction)
- Stripe webhook signature verification + SSLCommerz server-side validation (previously unverified — critical fix)

## Booking Module
- State-machine-guarded transitions (fixed critical self-completion bug), address/price snapshots, provider status gating, soft delete, `Address` model

## User & Provider Module
- Profile/verification endpoints, guest restrictions, provider listings/certificates/education/availability

## Authentication Module
- Phone OTP, email, social login (server-verified), guest mode, rotating refresh tokens, Redis-backed OTP/rate-limiting, RBAC-ready
