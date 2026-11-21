# F07 — Bookings & Concurrency

**Phase:** 1 · **Modules:** 1.8 Concurrency, 1.12 · **Depends on:** F05, F06, F09 (audit hook)

## Goal

Create, reschedule and cancel bookings with **zero double bookings**, even when two customers click the same 10:00 slot in the same millisecond.

## Data model

```prisma
enum BookingStatus { HELD CONFIRMED CANCELLED EXPIRED COMPLETED NO_SHOW }

model Booking {
  id                String        @id @default(uuid(7)) @db.Uuid
  tenantId          String        @map("tenant_id") @db.Uuid
  staffId           String        @map("staff_id") @db.Uuid
  serviceId         String        @map("service_id") @db.Uuid
  customerId        String        @map("customer_id") @db.Uuid       // tenant-scoped Customer (F08)
  startAt           DateTime      @map("start_at") @db.Timestamptz(3) // UTC
  endAt             DateTime      @map("end_at")   @db.Timestamptz(3) // start + duration + buffer
  status            BookingStatus
  holdExpiresAt     DateTime?     @map("hold_expires_at") @db.Timestamptz(3)
  priceMinor        Int           @map("price_minor")
  depositMinor      Int           @map("deposit_minor")
  source            String                                           // ONLINE | STAFF
  notes             String?
  version           Int           @default(0)                        // optimistic locking for edits
  cancelledAt       DateTime?     @map("cancelled_at") @db.Timestamptz(3)
  cancelReason      String?       @map("cancel_reason")
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([tenantId, startAt, id])
  @@index([tenantId, customerId, startAt])
  @@map("booking")
}
```

## Preventing double bookings — the core of 1.8

**Primary guard: exclusion constraint** (custom SQL in a `--create-only` migration; Prisma can't express it):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status IN ('HELD', 'CONFIRMED'));
```

The second concurrent insert fails with SQLSTATE `23P01` → map to `409 SLOT_TAKEN`. `[)` means a 10:00–10:45 booking doesn't conflict with one starting at 10:45.

**The expired-hold problem:** the constraint's `WHERE` can't use `now()`, so an expired-but-not-yet-cleaned `HELD` row still blocks. Solution, in the same transaction before insert:

```sql
UPDATE booking SET status = 'EXPIRED'
WHERE tenant_id = $1 AND staff_id = $2 AND status = 'HELD' AND hold_expires_at < now()
  AND tstzrange(start_at, end_at, '[)') && tstzrange($3, $4, '[)');
```

**Learning comparison (document in `docs/perf/concurrency.md`):** also implement the alternative with `SELECT ... FROM staff WHERE id = $1 FOR UPDATE` (serialize per staff) then check-and-insert, and show with a load test (e.g. 50 parallel requests for one slot via `autocannon`/k6) that:

- naive check-then-insert → double bookings,
- `FOR UPDATE` → correct but serialized,
- exclusion constraint → correct, no app lock, exactly one 201 and 49 × 409.

Keep the constraint as the production mechanism.

## Flows

**Create (customer, public):** `POST /public/:slug/bookings` + `Idempotency-Key`

1. Validate service/staff/slot against availability rules (notice, horizon, working hours) — cheap pre-check for a good error, not the safety net.
2. Upsert tenant `Customer` for the signed-in account.
3. Transaction: release overlapping expired holds → insert `HELD` with `hold_expires_at = now() + 10 min` → audit entry → outbox event `booking.held`.
4. If `depositMinor = 0`, insert directly as `CONFIRMED`.
5. Return booking + `paymentRequired`.

**Create (staff side):** `POST /bookings` by Receptionist/Manager/Owner, or Staff for own calendar; may skip deposit (`CONFIRMED` immediately, `depositWaived = true`, audited).

**Reschedule:** `POST /bookings/:id/reschedule {startAt, staffId?, version}`

- One `UPDATE` of `start_at/end_at/staff_id` — the exclusion constraint checks the new range atomically. Compare-and-set on `version` → `409 STALE_BOOKING` if someone else edited it.
- Customer: only own `CONFIRMED` bookings, at least N hours before start (tenant policy). Deposit carries over.
- Audit records before/after times; reminders rescheduled (F15); events `booking.rescheduled`.

**Cancel:** `POST /bookings/:id/cancel {reason}` — status → `CANCELLED`, frees slot immediately. Refund policy (tenant setting): full deposit refund if cancelled ≥ 24 h before, else none. Refund goes through F10.

**Complete:** `POST /bookings/:id/complete` (staff on own, managers on any).

## API summary

| Method | Path                                                            | Who                    |
| ------ | --------------------------------------------------------------- | ---------------------- |
| POST   | `/public/:slug/bookings`                                        | Signed-in customer     |
| GET    | `/me/bookings`, `/me/bookings/:id`                              | Customer               |
| POST   | `/me/bookings/:id/reschedule` · `/cancel`                       | Customer               |
| GET    | `/bookings` (calendar range), `/bookings/:id`                   | Members, scoped by F03 |
| POST   | `/bookings`, `/bookings/:id/reschedule`, `/cancel`, `/complete` | Per F03 matrix         |

## Acceptance criteria

- Concurrency test: 50 parallel creates for one slot → exactly 1 success. Runs in e2e.
- Two staff can both be booked at 10:00 (constraint is per staff).
- Back-to-back bookings (10:00–10:45, 10:45–11:30) both succeed; with a 15-min buffer the second fails.
- Expired hold doesn't block a new booking even if the nightly job hasn't run.
- Reschedule with stale `version` → 409; reschedule onto a taken slot → 409 and the original booking is unchanged.
