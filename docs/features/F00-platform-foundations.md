# F00 — Platform Foundations

**Phase:** 0 · **Modules:** groundwork for all · **Depends on:** —

**Status:** ✅ Completed — **v1** (2026-11-22) · see [Implementation summary](#implementation-summary-v1)

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

## Implementation summary (v1)

**Completed:** 2026-11-22 · **Branch:** `main` (not yet committed at time of writing)

### What was built

| Item                     | Done | Where                                                                                                | Notes                                                                                                                                                          |
| ------------------------ | ---- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename dev DB            | ✅   | `docker-compose.yml`, `.env.example`, `src/config/env.ts`, `vitest.config.e2e.ts`, docs              | Now `slotwise-dev` / `slotwise-test`. Local `.env` updated too.                                                                                                |
| DB in readiness          | ✅   | `src/modules/health/`                                                                                | Was already there. Added `HealthCheckFilter` so a failed `/ready` keeps Terminus' body (which dependency is down) instead of the generic error envelope.       |
| Error envelope           | ✅   | `src/shared/errors/` (`DomainError`, `ErrorCode`, `ApiExceptionFilter`)                              | Registered as `APP_FILTER` in `AppModule`. Validation errors add `details[]`. `P2002`→409, `P2025`→404, `23P01`→409. 5xx never leaks the message.              |
| Request context          | ✅   | `src/shared/context/` (`RequestContext`, `requestContextMiddleware`)                                 | First middleware in `configureApp()`. Same id in `X-Request-Id`, error body, pino `req.id`. `setActor()` is ready for the F02 guard.                           |
| Extra Prisma error codes | ✅   | `src/shared/database/prisma-errors.ts`                                                               | `isExclusionViolation()`, `isSerializationFailure()`, `postgresErrorCode()`. Prisma 7 puts the SQLSTATE in `meta.driverAdapterError.cause.originalCode`.       |
| Time & money utils       | ✅   | `src/shared/time/time.ts`, `src/shared/money/money.ts`                                               | `utcInstantSchema`, `parseUtc`, `rangesOverlap` (half-open), `formatForEmail` (built from parts, ICU-stable). `paiseSchema`, `formatInr`. Pool `TimeZone=UTC`. |
| Seed script              | ✅   | `prisma/seed.ts` (CLI), `prisma/seed/platform-admin.ts` (logic), `User` model + migration `add_user` | `npm run db:seed` (`-- --reset-password`). Wired into `prisma.config.ts` → `migrations.seed`. Password policy in `src/shared/security/password-policy.ts`.     |
| CI                       | ✅   | `.github/workflows/ci.yml`                                                                           | Format check, lint, typecheck, unit, `migrate deploy`, drift check (`migrate diff --exit-code`), seed ×2 → 1 user, e2e, build.                                 |
| MinIO in compose         | ⏭️   | —                                                                                                    | Deferred to Phase 4 (F18), as the spec allows.                                                                                                                 |

### Decisions that differ from the spec

- **Password hash is scrypt, not argon2id.** The seed uses `PasswordHasher` from `@nestjs/authentication` so F02's login verifies the same hash. F02 allows "argon2id (or what the package uses)".
- **`tsx` is a runtime dependency**, because the seed runs as a production deploy step where dev deps may be missing.
- **`User` has `createdAt` / `updatedAt`** in addition to the F02 fields.
- **Seed only resets status to `ACTIVE` when it sets a password**, so a deliberately disabled admin isn't re-enabled by a routine deploy.

### New scripts, env and dependencies

- Scripts: `db:seed`, `format:check`, `typecheck`; `lint` / `format` now include `prisma/`.
- Env: `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_NAME` (seed only).
- Dependencies: `@nestjs/authentication`, `tsx`.

### Tests

- Unit: `request-context.spec.ts`, `api-exception.filter.spec.ts`, `prisma-errors.spec.ts`, `time.spec.ts`, `money.spec.ts`, `password-policy.spec.ts`.
- E2E: `test/foundations.e2e-spec.ts` (envelope, request id, UTC session, real `23P01`), `test/seed.e2e-spec.ts` (create, idempotent, reset, policy).
- Result at completion: 78 unit + 26 e2e passing; format, lint, typecheck and build clean.

### Acceptance criteria

| Criterion                                                    | Status                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `GET /ready` returns 503 when Postgres is stopped            | ✅ via existing Terminus check (not re-verified by stopping the container)  |
| Domain error returns the envelope with a `requestId` in logs | ✅ verified in e2e and on the running app                                   |
| Seed creates exactly one `user`; twice still one             | ✅ e2e + CI step                                                            |
| Seeded admin can sign in with `POST /auth/staff/login`       | ⏳ blocked on F02 (hash is compatible by design)                            |
| CI green on a clean clone                                    | ⏳ workflow written and every step passes locally; first GitHub run pending |

### Follow-ups for later features

- F02: call `RequestContext.setActor()` in the auth guard; reuse `passwordSchema` and `PasswordHasher`.
- F01: read `RequestContext.actor().tenantId` for RLS.
- F07: map `isExclusionViolation()` to `ErrorCode.SlotTaken` in the booking service.
- F18: add MinIO to `docker-compose.yml`.
