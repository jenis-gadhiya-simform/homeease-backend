# F05 — Services, Working Hours, Time Off & Holidays

**Phase:** 1 · **Modules:** 1.12 Time and money · **Depends on:** F01, F04

## Goal

Let a business describe **what** it sells and **when** each person works, storing **everything time-related in UTC**. The frontend converts to and from local time; the backend never does.

## Data model

```prisma
model Service {
  id                 String  @id @default(uuid(7)) @db.Uuid
  tenantId           String  @map("tenant_id") @db.Uuid
  name               String
  durationMin        Int     @map("duration_min")          // 15..480
  bufferAfterMin     Int     @default(0) @map("buffer_after_min")
  priceMinor         Int     @map("price_minor")           // 50000 = ₹500.00 (paise)
  depositMinor       Int     @default(0) @map("deposit_minor")
  active             Boolean @default(true)
  @@index([tenantId, active])
  @@map("service")
}

model StaffService { staffId String @db.Uuid; serviceId String @db.Uuid; tenantId String @db.Uuid; @@id([staffId, serviceId]) }

model WorkingHours {          // weekly recurring, all in UTC (frontend converts from local)
  id           String    @id @default(uuid(7)) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  staffId      String    @map("staff_id") @db.Uuid
  weekday      Int                                       // UTC ISO weekday 1=Mon..7=Sun
  startTime    DateTime  @map("start_time") @db.Time(0)  // UTC time, e.g. 03:30 (= 09:00 IST)
  durationMin  Int       @map("duration_min")            // 1..1440; may run past UTC midnight
  validFrom    DateTime? @map("valid_from") @db.Timestamptz(3)
  validTo      DateTime? @map("valid_to")   @db.Timestamptz(3)
  @@index([tenantId, staffId, weekday])
  @@map("working_hours")
}

model TimeOff {               // EXACT instants
  id        String   @id @default(uuid(7)) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  staffId   String   @map("staff_id") @db.Uuid
  startsAt  DateTime @map("starts_at") @db.Timestamptz(3)
  endsAt    DateTime @map("ends_at")   @db.Timestamptz(3)
  reason    String?
  @@index([tenantId, staffId, startsAt])
  @@map("time_off")
}

model Holiday {               // business-wide closure, UTC range
  id        String   @id @default(uuid(7)) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  startsAt  DateTime @map("starts_at") @db.Timestamptz(3)
  endsAt    DateTime @map("ends_at")   @db.Timestamptz(3)
  name      String
  @@index([tenantId, startsAt])
  @@map("holiday")
}
```

## Time rules (1.12)

**Everything time-related is UTC in the database and in the API. The frontend converts.** No timezone is stored, chosen or sent.

| Concept                                         | Stored as                                | Frontend's job                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Appointment, time off, hold expiry, audit times | `timestamptz(3)`, UTC                    | Show in local time; send UTC.                                                                                                           |
| Working hours                                   | UTC weekday + UTC `time` + `durationMin` | Owner enters "Mon 09:00–17:00"; the frontend sends `{ weekday: 1, startTime: "03:30", durationMin: 480 }`. On display it converts back. |
| Holiday                                         | `starts_at` / `ends_at` UTC range        | Owner picks "26 Jan"; the frontend sends that local day as UTC: `2026-01-25T18:30:00Z` → `2026-01-26T18:30:00Z`.                        |
| Time off entered as days                        | UTC range                                | Same as holidays.                                                                                                                       |

**Why `durationMin` instead of an end time:** a local shift can cross UTC midnight. 04:00–07:00 IST is Sunday 22:30 UTC + 180 min, which runs into Monday UTC. Start + duration stores that as one row with no special case. The backend expands each row into UTC ranges for the requested window, including a row that starts on the previous UTC weekday and runs into the window.

**Cases to test:**

- A working-hours row that runs past UTC midnight produces one continuous range across two UTC days.
- A holiday range from 18:30Z to 18:30Z removes exactly the slots inside it, across two UTC dates.
- API input without `Z` (e.g. `2026-12-01T09:00:00`) → 400.

## Money rules (1.12)

- INR only. `priceMinor`, `depositMinor` are integer **paise**; `0 ≤ depositMinor ≤ priceMinor`. No currency column.
- Format with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` → `₹1,23,456.00`; never hand-roll `/100` formatting in templates.
- Deposit policy (Owner only): `fixed` per service, or `percent` of price rounded **half-up to the paisa**.
- (Stretch) GST: if added later, store tax as its own paise column; never derive it from floats.

## API

| Method  | Path                       | Who                                                                             |
| ------- | -------------------------- | ------------------------------------------------------------------------------- |
| CRUD    | `/services`                | Owner, Manager (read: any member; public read via F06)                          |
| PUT     | `/staff/:id/services`      | Owner, Manager                                                                  |
| GET/PUT | `/staff/:id/working-hours` | Owner, Manager, or the staff member themself. PUT replaces the week atomically. |
| CRUD    | `/staff/:id/time-off`      | Owner, Manager, the staff member                                                |
| CRUD    | `/holidays`                | Owner, Manager                                                                  |

## Validation

- Working-hours rows of the same staff must not overlap once expanded to minutes of the week (check in the service; ranges are `[weekday·1440 + start, +durationMin)`, wrapping at the end of the week).
- Time off `endsAt > startsAt`, max 90 days.
- Creating time off or a holiday that overlaps confirmed bookings → `409 CONFLICTS_WITH_BOOKINGS` with the list, unless `?force=true` by Owner/Manager (then bookings are flagged, not auto-cancelled).
- Every change invalidates availability cache for that staff/tenant (F16).

## Acceptance criteria

- Unit tests for expanding UTC working-hours rows into ranges, including rows that cross UTC midnight and the Sunday→Monday wrap.
- Price `199.99` sent as a float is rejected; API accepts only integer paise. Timestamps without `Z`/offset are rejected.
