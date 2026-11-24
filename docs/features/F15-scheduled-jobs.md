# F15 — Scheduled & Background Jobs

**Phase:** 4 · **Modules:** 2.8 / 2.9 Jobs · **Depends on:** F07, F14, existing `SharedQueueModule`

**Status:** 🚧 In progress — **v1** (2026-11-24): scheduling foundation + abandoned-account cleanup · see [Implementation summary (v1)](#implementation-summary-v1). The booking jobs below wait for F07 / F10–F14 / F18.

## Goal

Time-driven work that runs exactly when it should, once, on one instance, and survives restarts.

## Jobs

| Job                                     | Kind                                   | Schedule        | Idempotency key                                                                                  |
| --------------------------------------- | -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Reminder 24 h                           | BullMQ **delayed** job                 | `startAt − 24h` | `reminder-24h-${bookingId}-${version}`                                                           |
| Reminder 1 h                            | BullMQ delayed job                     | `startAt − 1h`  | `reminder-1h-${bookingId}-${version}`                                                            |
| Release unpaid holds                    | Every 5 min sweep + nightly 02:00 IST  | —               | `holds-sweep-${windowStart}` · `holds-${tenantId}-${istDate}`                                    |
| Mark no-shows                           | Nightly 02:00 IST                      | —               | `noshow-${tenantId}-${istDate}`                                                                  |
| Staff daily agenda digest               | Daily 07:00 IST                        | —               | `digest-${staffId}-${istDate}`                                                                   |
| Payment reconciliation (F11)            | Every 15 min                           | —               | `recon-${windowStart}`                                                                           |
| Payment retry (F12)                     | Delayed with backoff                   | —               | `payment-retry-${paymentId}`                                                                     |
| Monthly revenue report (F18)            | 1st of month 03:00 IST                 | —               | `revenue-${tenantId}-${yyyy-mm}`                                                                 |
| Purge abandoned customer accounts (F02) | Daily 03:00 IST (BullMQ job scheduler) | —               | Idempotent by the DELETE's own conditions; manual runs `purge-unverified-customers-manual-${ms}` |

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

## Implementation summary (v1)

**Completed:** 2026-11-24 (partial: the booking-related jobs need F07 and later) · **Branch:** `main` (not yet committed at time of writing)

### What was built

| Item                                                                                                              | Status | Where                                                                                                                                                 | Notes                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling foundation: one queue for housekeeping, schedules in IST, worker, admin routes                         | ✅     | `src/modules/maintenance/`                                                                                                                            | BullMQ job schedulers (see decisions).                                                                                                                                                                        |
| Purge abandoned customer accounts (nightly, 03:00 IST)                                                            | ✅     | `src/modules/auth/unverified-accounts-cleanup.service.ts`, `CustomerAccountsRepository.findAbandonedIds()` / `deleteAbandoned()` / `abandonedSince()` | Never verified, no password, no Google/Microsoft link, no magic link requested within the retention; batches of 500, max 100 per run; cascades leftover magic-link tokens. Follow-up from the security audit. |
| `GET /admin/maintenance/schedules`, `POST /admin/maintenance/jobs/:job/run`, `GET /admin/maintenance/jobs/:jobId` | ✅     | `maintenance.controller.ts`                                                                                                                           | `@PlatformAdminOnly()`. Precursor of F19's job operations.                                                                                                                                                    |
| Processors idempotent; graceful shutdown                                                                          | ✅     | `maintenance.processor.ts`                                                                                                                            | Purge re-checks its conditions in the DELETE; `@nestjs/bullmq` closes workers after the active job.                                                                                                           |
| Reminders 24 h / 1 h, quiet hours                                                                                 | ⏭️     | —                                                                                                                                                     | Needs bookings (F07) and notifications (F14).                                                                                                                                                                 |
| Release unpaid holds, no-shows                                                                                    | ⏭️     | —                                                                                                                                                     | F07 / F10.                                                                                                                                                                                                    |
| Staff daily digest                                                                                                | ⏭️     | —                                                                                                                                                     | F14.                                                                                                                                                                                                          |
| Payment reconciliation / retry                                                                                    | ⏭️     | —                                                                                                                                                     | F11 / F12.                                                                                                                                                                                                    |
| Monthly revenue report                                                                                            | ⏭️     | —                                                                                                                                                     | F18.                                                                                                                                                                                                          |
| Failed jobs visible + retry for platform admins                                                                   | ⏭️     | —                                                                                                                                                     | F19 (state and failure reason of maintenance jobs are already visible).                                                                                                                                       |

### Decisions that differ from the spec

- **BullMQ job schedulers instead of `@nestjs/schedule` + `@nestjs/locks`.** `queue.upsertJobScheduler(id, { pattern, tz: 'Asia/Kolkata' }, template)` keeps the schedule in Redis; every instance registers it at startup (an upsert, no duplicates) and Redis creates exactly one job per tick, so no lock is needed and nothing new is installed. The job then gets the queue's retries, backoff and retention like any other. A per-tenant fan-out (holds, no-shows) can still be a scheduled job whose processor enqueues one job per tenant with the deterministic ids in the table above.
- **A shared `maintenance` queue** for housekeeping; feature jobs (reminders, holds) will get queues in their own modules.

### New scripts, env vars and dependencies

- Env: `UNVERIFIED_ACCOUNT_RETENTION_DAYS` (default `7`, max 365). In `.env.example` and `docs/architecture.md`.
- No migration, no new dependency.

### Tests

- Unit: `unverified-accounts-cleanup.service.spec.ts` (cutoff, batching, counting only deleted rows, truncation), `maintenance.processor.spec.ts` (dispatch, request context, unknown job → no retry).
- E2E: `test/maintenance.e2e-spec.ts`: only the abandoned account of six kinds is deleted (and its expired link with it), a second run deletes nothing; the schedule is listed with its next run at 21:30Z (03:00 IST); a manual run goes through the real queue and worker and is polled to `completed` with its result; admin-only and job-name validation.
- Final counts: **unit 160 passed** (28 files), **e2e 119 passed** (12 files), with no social sign-in variables set (as in CI). Lint, format, typecheck and build clean.

### Acceptance criteria

| Criterion                                      | Status           | How verified                                                                                        |
| ---------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Two app instances → each nightly job runs once | ✅ (cleanup job) | By design of BullMQ job schedulers (one job per tick in Redis); not load-tested with two processes. |
| Reminders / digest timing                      | ⏳               | Booking jobs not built yet.                                                                         |

### Follow-ups for later features

- F07+: booking jobs (reminders as delayed jobs; holds / no-shows as scheduled jobs fanning out per tenant).
- F19: list failed jobs across queues, retry from the admin API.
- An index for the purge query (`customer_account` where `email_verified_at IS NULL`) if the table grows large; a sequential scan once a night is fine for now.
