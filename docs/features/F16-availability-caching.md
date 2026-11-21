# F16 — Availability Caching

**Phase:** 4 · **Modules:** 1.16 Caching · **Depends on:** F06, F07

## Goal

Public booking pages are read 100× more than they're written. Serve availability from Redis, and **never** show a slot that was just taken for longer than it takes to invalidate.

## Design (`@nestjs/cache-manager` with the existing Redis)

- **Cache unit:** one staff × one UTC day × one service duration bucket → list of free slot starts.
  `avail:v{tenantVersion}:{tenantId}:{staffId}:{yyyy-mm-dd}:{durationMin}`
- **TTL:** 5 min (safety net; correctness comes from invalidation).
- **Versioned keys for broad invalidation:** `avail:ver:{tenantId}` is an integer; bumping it (INCR) invalidates every key of that tenant at once without `SCAN`/`DEL`. Use for tenant-wide changes (holiday, service duration, slot settings).
- **Targeted invalidation:** booking create/reschedule/cancel/expire deletes keys for the affected staff + day(s) (reschedule touches old and new day).
- Invalidation is driven by **outbox events** (F13), plus synchronously in the request after commit for the fastest path.
- **Stampede protection:** a short Redis lock (`SET NX PX 3000`) per key while recomputing; other requests wait briefly or recompute without caching.
- HTTP: `Cache-Control: public, max-age=15` + `ETag` on the public endpoint.

## The cache is not the safety net

A stale cache can at worst show a slot that's gone; the booking then fails with `409 SLOT_TAKEN` from the exclusion constraint (F07) and the client refreshes. Document this explicitly.

## Invalidation triggers

| Change                                               | Invalidate                                  |
| ---------------------------------------------------- | ------------------------------------------- |
| Booking held/confirmed/rescheduled/cancelled/expired | staff × affected day(s)                     |
| Working hours, staff services, staff deactivated     | staff × all days (bump a per-staff version) |
| Time off                                             | staff × days in range                       |
| Holiday, slot granularity, notice/horizon            | tenant version bump                         |
| Service duration/buffer                              | tenant version bump                         |

## Acceptance criteria

- Second identical availability request hits Redis (verify via metric/log); p95 < 10 ms.
- After a booking, the next availability request excludes that slot (e2e).
- Redis down → availability still served from Postgres (cache fails open), `/ready` reports Redis down.
- Load test: 500 rps on public availability with p95 < 50 ms on the seed dataset; results in `docs/perf/caching.md`.
