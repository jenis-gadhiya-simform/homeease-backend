# F19 — Platform Admin Console (API)

**Phase:** 5 · **Modules:** 1.10 (PII boundaries), operations for 2.8/2.15 · **Depends on:** F09, F11, F13, F15

## Goal

SlotWise operators can run the platform — tenants, failed jobs, webhook logs — **without seeing customer PII by default**.

## Access

- There is exactly one platform admin, created by `npm run db:seed` (F00). `User.isPlatformAdmin` is never set through the API. MFA strongly recommended (stretch).
- **Creating businesses and their Owner is already delivered in Phase 1** (F01: `POST /admin/tenants`, resend setup, replace pending Owner). This feature adds the operations console on top.
- Routes under `/admin/*` guarded by a `PlatformAdminGuard`; these paths use a DB role with `BYPASSRLS`.
- All admin actions audited with `actorType = PLATFORM_ADMIN`.

## Endpoints

| Method | Path                                                 | Purpose                                                                                  |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/admin/tenants?q=&status=&cursor=`                  | List tenants with counts (bookings 30d, staff, revenue)                                  |
| GET    | `/admin/tenants/:id`                                 | Tenant detail (no customer list)                                                         |
| POST   | `/admin/tenants/:id/suspend` · `/reactivate`         | Reason required                                                                          |
| GET    | `/admin/jobs?queue=&state=failed&cursor=`            | Failed/delayed/active jobs across queues (BullMQ API), payload **redacted**              |
| POST   | `/admin/jobs/:queue/:id/retry` · `DELETE`            | Retry or discard                                                                         |
| GET    | `/admin/webhooks/inbound?status=&cursor=`            | Inbound events: type, received, processed, attempts, error                               |
| POST   | `/admin/webhooks/inbound/:id/reprocess`              | Re-run processing (idempotent)                                                           |
| GET    | `/admin/webhooks/outbound?tenantId=&status=&cursor=` | Delivery log                                                                             |
| GET    | `/admin/system`                                      | Circuit breaker state (F12), queue depths, outbox lag                                    |
| POST   | `/admin/break-glass`                                 | `{ tenantId, reason, durationMin ≤ 60 }` → temporary PII access, audited, Owner notified |

## PII masking

- A response serializer applies `mask()` to customer `name`, `email`, `phone` (`J*** S****`, `j***@e***.com`, `+91 ***** **210`) for platform subjects.
- Job and webhook payloads pass through the same redaction before being returned.
- Break-glass grants are stored with expiry; the masking serializer checks for an active grant.

## Acceptance criteria

- Platform admin listing bookings of a tenant gets masked customer fields.
- With an active break-glass grant, unmasked; after expiry, masked again; both moments audited and the Owner emailed.
- Retrying a failed email job from the admin API sends exactly one email.
- A tenant Owner calling `/admin/*` → 403.
