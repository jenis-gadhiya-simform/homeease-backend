# F09 — Audit Log

**Phase:** 1 (table + booking hooks) / 2 (API) · **Modules:** 1.13 Audit · **Depends on:** F00 request context

## Goal

When a customer says "I never cancelled that!", the business can show **who** did **what**, **when**, from **where**, and **what it was before**.

## Data model

```prisma
model AuditLog {
  id          String   @id @default(uuid(7)) @db.Uuid
  tenantId    String?  @map("tenant_id") @db.Uuid      // null = platform-level event
  actorType   String   @map("actor_type")              // USER | CUSTOMER | SYSTEM | PLATFORM_ADMIN | WEBHOOK
  actorId     String?  @map("actor_id") @db.Uuid
  actorRole   String?  @map("actor_role")              // role at the time of the action
  action      String                                   // booking.cancelled, booking.rescheduled, service.updated …
  entityType  String   @map("entity_type")
  entityId    String   @map("entity_id") @db.Uuid
  before      Json?                                    // changed fields only
  after       Json?
  reason      String?
  requestId   String?  @map("request_id")
  ip          String?  @db.Inet
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([tenantId, entityType, entityId, createdAt])
  @@index([tenantId, createdAt])
  @@map("audit_log")
}
```

## Rules

- **Same transaction** as the change: `AuditService.record(tx, {...})`. If the audit insert fails, the change rolls back. No fire-and-forget.
- **Append-only:** the app DB role has `INSERT, SELECT` only on `audit_log` (no `UPDATE/DELETE`); a trigger rejects updates as a second guard.
- **Diff, don't dump:** store only changed fields (`{ startAt: "…10:00Z" } → { startAt: "…11:00Z" }`).
- **PII minimisation:** never put passwords/tokens; store customer contact changes as `"[changed]"` unless needed.
- Actor comes from `RequestContext`; jobs use `SYSTEM` with the job name, webhooks use `WEBHOOK` with the event id.
- Retention: 2 years, then a monthly job moves rows to cold storage (optional; partition by month to make this cheap).

## Audited actions (minimum)

Booking: created, confirmed, rescheduled, cancelled, completed, no-show, deposit waived, refund issued. Also: service/price changes, working hours, time off, membership role changes, ownership transfer, deposit policy, webhook endpoint changes, platform-admin break-glass PII access.

## API

| Method | Path                                            | Who                                                                                       |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/bookings/:id/history`                         | Members who can see the booking; customer sees a simplified timeline of their own booking |
| GET    | `/audit?entityType=&actorId=&from=&to=&cursor=` | Owner, Manager (cursor-paginated, F08 pattern)                                            |
| GET    | `/admin/audit`                                  | Platform admin (PII fields masked)                                                        |

## Acceptance criteria

- Reschedule by a receptionist produces one entry with actor, role, before/after times, requestId matching the log line.
- An attempted `UPDATE audit_log` from the app role fails.
- A failure after the audit insert rolls back both the booking change and the entry.
