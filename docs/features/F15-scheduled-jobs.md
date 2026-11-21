# F15 — Scheduled & Background Jobs

**Phase:** 4 · **Modules:** 2.8 / 2.9 Jobs · **Depends on:** F07, F14, existing `SharedQueueModule`

## Goal

Time-driven work that runs exactly when it should, once, on one instance, and survives restarts.

## Jobs

| Job                          | Kind                                  | Schedule        | Idempotency key                                               |
| ---------------------------- | ------------------------------------- | --------------- | ------------------------------------------------------------- |
| Reminder 24 h                | BullMQ **delayed** job                | `startAt − 24h` | `reminder-24h-${bookingId}-${version}`                        |
| Reminder 1 h                 | BullMQ delayed job                    | `startAt − 1h`  | `reminder-1h-${bookingId}-${version}`                         |
| Release unpaid holds         | Every 5 min sweep + nightly 02:00 IST | —               | `holds-sweep-${windowStart}` · `holds-${tenantId}-${istDate}` |
| Mark no-shows                | Nightly 02:00 IST                     | —               | `noshow-${tenantId}-${istDate}`                               |
| Staff daily agenda digest    | Daily 07:00 IST                       | —               | `digest-${staffId}-${istDate}`                                |
| Payment reconciliation (F11) | Every 15 min                          | —               | `recon-${windowStart}`                                        |
| Payment retry (F12)          | Delayed with backoff                  | —               | `payment-retry-${paymentId}`                                  |
| Monthly revenue report (F18) | 1st of month 03:00 IST                | —               | `revenue-${tenantId}-${yyyy-mm}`                              |

(Job ids avoid `:` per project convention.)

## Reminders

The send instant is absolute and computed in UTC (`startAt − 24h`, `startAt − 1h`). The email shows the time in IST (`DISPLAY_TIMEZONE`, see F14). Rules:

- **Quiet hours:** if the 24 h reminder falls between 22:00–07:00 IST, send it at 20:00 IST the previous evening instead.
- Skip reminders if booking was created less than 24 h / 1 h before start.
- On **reschedule**: remove old delayed jobs (`queue.remove(jobId)`) and schedule new ones (version in the id prevents stale sends anyway). On **cancel**: remove.
- At send time, the processor **re-reads the booking** and only sends if still `CONFIRMED` and `version` matches — so a missed removal never sends a wrong reminder.

## When daily jobs run

Daily jobs have no frontend, so their run time uses `DISPLAY_TIMEZONE`: `@nestjs/schedule` with `timeZone: 'Asia/Kolkata'` (e.g. `0 2 * * *` = 02:00 IST = 20:30Z). The cron enqueues one job per tenant (or per staff for digests) with the deterministic ids above. Wrap each cron in `@nestjs/locks` so only one instance enqueues; the `jobId` is a second guard.

## Nightly work details

- **Release holds:** `UPDATE booking SET status='EXPIRED' WHERE status='HELD' AND hold_expires_at < now()` in batches of 500; audit as `SYSTEM`; emit `booking.expired` → cache invalidation.
- **No-shows:** `CONFIRMED` bookings whose `end_at < now() − 2h` and not completed → `NO_SHOW`; deposit kept per policy; audited.
- **Digest:** the staff member's bookings for today in IST, queried as a UTC range (`[today 00:00 IST, tomorrow 00:00 IST)` = `[yesterday 18:30Z, today 18:30Z)`), one email, skip if empty or opted out.

## Operations

- Every processor is idempotent (jobs retry 3× by default).
- Failed jobs stay visible to platform admins (F19); retry from the admin API.
- Graceful shutdown: workers finish the current job before exit.

## Acceptance criteria

- Booking at 10:00 IST (04:30Z) → reminder jobs at 04:30Z the previous day and 03:30Z the same day, verified with fake timers.
- Reschedule twice → only the last reminders send.
- Two app instances → each nightly job runs once (lock + jobId).
- Digest runs at 07:00 IST (01:30Z) and includes a booking at 00:30 IST that day.
