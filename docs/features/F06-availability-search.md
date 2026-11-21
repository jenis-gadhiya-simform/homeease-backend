# F06 — Availability (Free-Slot Search)

**Phase:** 1 · **Modules:** 1.6 SQL, 1.12 Time · **Depends on:** F05

## Goal

Answer "which start times can I book _Haircut (45 min)_ with _any/specific staff_ between dates X and Y?" quickly and correctly.

**Free time = working hours − holidays − time off − active bookings (HELD with unexpired hold, CONFIRMED) − buffers.**

## API

```
GET /public/:slug/availability?serviceId=…&from=2026-11-30T18:30:00Z&to=2026-12-07T18:30:00Z&staffId=…(optional)
```

- `from`/`to` are **UTC instants**; the frontend computes them from the local days the user is viewing. Max range 31 days. There is no timezone parameter.
- Response is a flat, sorted list of slots, each with `startsAt` (UTC ISO with `Z`) and `staffId`. The frontend groups them by local day.
- Slot granularity: every 15 min (tenant setting), stepping from the start of each working-hours window, so slots line up with the hours the owner entered.
- Minimum notice (e.g. 2 h) and maximum horizon (e.g. 90 days) from tenant settings.

## Approach

Do the interval math **in PostgreSQL** with range types — this is the SQL learning goal.

1. **Expand working hours** into UTC `tstzrange`s for the window: `generate_series` over the UTC dates in range (plus the day before, for rows that run past midnight), keep rows whose `weekday` matches, then `tstzrange(d + start_time, d + start_time + duration_min * interval '1 minute')`. All UTC; no `AT TIME ZONE`.
2. **Remove holidays**: subtract `tstzrange(starts_at, ends_at)` of overlapping holidays, the same way as time off.
3. **Subtract busy intervals**: time off + bookings (with `buffer_after` added: `tstzrange(start_at, end_at + buffer)`). PostgreSQL 14+ has **multiranges**: `range_agg(work) - range_agg(busy)` gives free `tstzmultirange` per staff.
4. **Cut into slots**: `generate_series(lower, upper - duration, '15 min')` per free range, keeping slots where `[s, s+duration+buffer)` fits.

Write it as one raw query (`prisma.$queryRaw` / TypedSQL) in `AvailabilityRepository`. Keep a pure-TypeScript reference implementation for unit tests and compare both on random fixtures (property test).

## Indexes (verify with `EXPLAIN (ANALYZE, BUFFERS)`)

```sql
-- bookings that occupy time, searched by staff + time window
CREATE INDEX booking_busy_idx ON booking USING gist (tenant_id, staff_id, tstzrange(start_at, end_at, '[)'))
  WHERE status IN ('HELD', 'CONFIRMED');           -- needs btree_gist; doubles as the exclusion constraint in F07
CREATE INDEX time_off_staff_range_idx ON time_off USING gist (tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'));
-- working_hours (tenant_id, staff_id, weekday) btree; holiday (tenant_id, date) unique
```

Deliverable: `docs/perf/availability-explain.md` with the plan before and after indexes on a seeded dataset (e.g. 50 staff, 200k bookings), and the p95 latency.

## Edge cases

- Service not offered by the requested staff → 404.
- Inactive staff/service excluded.
- Holds whose `hold_expires_at < now()` count as free even before the cleanup job runs.
- A working-hours row that runs past UTC midnight gives continuous slots across the date change.

## Acceptance criteria

- Property test: SQL result == TS reference for 500 random schedules.
- Fixtures with UTC-midnight-crossing hours and 18:30Z-bounded holidays produce the expected slot lists.
- `EXPLAIN` shows index scans on booking/time_off, no seq scan on booking at 200k rows.
- p95 < 100 ms uncached for 1 staff × 7 days on the seed dataset (F16 adds caching).
