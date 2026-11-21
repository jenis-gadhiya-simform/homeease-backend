# F00 — Platform Foundations

**Phase:** 0 · **Modules:** groundwork for all · **Depends on:** —

## Goal

Finish the production plumbing every feature relies on, so feature work only adds business logic.

## Already in the repo

- Validated env (`src/config/env.ts`), Helmet, Zod validation pipe, Swagger at `/docs`
- Pino logging with redaction, NestJS Observe wiring
- `/health` and `/ready`, global Redis-backed rate limiting (fail-open)
- BullMQ (`SharedQueueModule`), mail via `@nestjs/mail` + Mailpit, `EmailService.enqueue()`
- PostgreSQL + Prisma 7 (`DatabaseModule`, `PrismaService`, `isPrismaError`)

## To add

| Item                     | Detail                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rename dev DB            | `homeease-dev` / `homeease-test` → `slotwise-dev` / `slotwise-test` (compose, `.env.example`, e2e setup).                                                                                                                                                                                                                                                                      |
| DB in readiness          | Add `DatabaseHealthIndicator` to `GET /ready`.                                                                                                                                                                                                                                                                                                                                 |
| Error envelope           | One global exception filter: `{ "error": { "code": "SLOT_TAKEN", "message": "...", "requestId": "..." } }`. Domain errors carry a stable `code`. Map Prisma `P2002` → 409, `P2025` → 404, exclusion violation `23P01` → 409.                                                                                                                                                   |
| Request context          | `AsyncLocalStorage`-based `RequestContext` holding `requestId`, `actor` (user id, role, tenantId) and `ip`. Used by audit, logs and RLS.                                                                                                                                                                                                                                       |
| Extra Prisma error codes | Add `ExclusionViolation` (raw `23P01`) and `SerializationFailure` (`40001`) helpers to `prisma-errors.ts`.                                                                                                                                                                                                                                                                     |
| Time & money utils       | `src/shared/time/`: UTC helpers (parse/validate ISO with `Z`, range overlap) and `DISPLAY_TIMEZONE = 'Asia/Kolkata'` + `formatForEmail(instant)` used **only** for emails, reports and job schedules. `src/shared/money/`: integer paise, `formatInr(paise)` for server-rendered output. Postgres pool sets `TimeZone=UTC`. No timezone or currency in env, DB columns or API. |
| Seed script              | `prisma/seed.ts` (`npm run db:seed`) seeds **exactly one user: the platform admin**. No tenants, staff, services or customers — those are created through the API (see onboarding flow in the [overview](../product/overview.md#onboarding-flow)). Details below.                                                                                                              |
| CI                       | GitHub Actions: format check, lint, typecheck, unit tests, e2e with Postgres + Redis services, `prisma migrate deploy` check.                                                                                                                                                                                                                                                  |
| MinIO in compose         | S3-compatible storage for F18 (can be added later in Phase 4).                                                                                                                                                                                                                                                                                                                 |

## Seed: one platform admin

- Reads `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` and `PLATFORM_ADMIN_NAME` from `env` (added to `envSchema` as optional, to `.env.example` and to the Configuration table in `docs/architecture.md`). Fails with a clear message if email or password is missing when the seed runs.
- **Upserts** a `User` by lowercased email with `isPlatformAdmin = true` and an argon2id password hash. Re-running it is safe: it doesn't duplicate the user, and it only resets the password when `--reset-password` is passed.
- Password must meet the F02 password policy; the plain password is never logged.
- Wired as Prisma's seed command (`prisma.config.ts` → `migrations.seed`), so `npm run db:migrate:reset` re-creates the admin.
- **Production:** the same script runs once as a deploy step (`npm run db:seed`), with the credentials coming from the secret manager. There is no API to create or promote platform admins.

**Test and perf data are not seed data.** E2E tests build what they need through factories (`test/factories/`) or the real API and clean up after themselves. Large datasets for `EXPLAIN` / load tests (F06, F08, F16) come from a separate script, `scripts/perf-dataset.ts`, that is never run by `db:seed`.

## Acceptance criteria

- `GET /ready` returns 503 when Postgres is stopped.
- Any thrown domain error returns the envelope with a `requestId` that also appears in the log line.
- On an empty database, `npm run db:seed` creates exactly one row in `user` (platform admin) and nothing in any other table; running it twice still leaves one row.
- The seeded admin can sign in with `POST /auth/staff/login` (F02).
- CI is green on a clean clone.
