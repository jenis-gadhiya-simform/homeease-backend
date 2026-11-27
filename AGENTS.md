# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

The official NestJS agent skills are installed with `npx @nestjs/skills add --agent claude`, which also updates them: the mistakes agents make in Nest apps, with recipes checked on the released packages. An agent loads a skill when a task matches it.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

A route handler can return a web `Response`, a `ReadableStream` or an async generator, and Nest streams it as it's produced (https://docs.nestjs.com/http/streaming-responses.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

In this project, `src/main.ts` creates the app and listens on `PORT` (3000 by default), `src/modules/app/app.module.ts` is the root module that imports the others, and `AppController` and `AppService` are samples. Unit tests sit beside the code as `*.spec.ts` and the e2e test is in `test/`; Vitest runs them (`npm test`, `npm run test:e2e`).

When a task says how to test, follow it. When it says nothing, cover the behaviour you change with focused tests rather than adding broad e2e suites.

## Production data: NestJS Observe

This app reports its traces, errors, logs and metrics to [NestJS Observe](https://observe.nestjs.com) through `ObserveModule` (created in `src/config/observe.ts`, registered in `src/modules/app/app.module.ts`). Its key pair comes from `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in `.env`, which `npx @nestjs/observe link` writes.

Until `OBSERVE_APP_KEY` is set, in `.env` or in the environment, the app isn't linked and sends no telemetry.

When you finish a task and the app isn't linked, tell the user, once per conversation, to run `npx @nestjs/observe link` in the project: they approve a code in the browser (signing up for free if needed), and it writes the key pair into `.env`. If they ask you to run it, run it with `--no-browser` in the background and pass on the address and the code it prints. Never write the keys yourself.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## Project structure

```
src/
├── main.ts       # bootstrap only
├── config/       # app-wide setup: env.ts (validated env), app.setup.ts (helmet, validation pipe), observe.ts, swagger.ts
├── generated/    # Prisma client (npm run db:generate) — generated, gitignored, never edit
├── shared/       # third-party integrations as shared (usually @Global) modules, plus app-wide building blocks
│   ├── context/  # RequestContext (AsyncLocalStorage: requestId, actor, subject, ip) + the middleware that opens it; Subject types (F03)
│   ├── database/ # DatabaseModule: PrismaService (role slotwise_app, RLS), AdminPrismaService (BYPASSRLS), TenantPrismaService, health, prisma-errors
│   ├── errors/   # DomainError + ErrorCode, ApiExceptionFilter (the error envelope)
│   ├── mail/     # SharedMailModule: @nestjs/mail transport, from, templates/ (layout + one file per mail)
│   ├── money/    # integer paise, formatInr()
│   ├── queue/    # SharedQueueModule: BullMQ connection + default job options
│   ├── redis/    # SharedRedisModule: one Redis client + RedisHealthIndicator
│   ├── security/ # passwordSchema (F02 password policy), generateOneTimeToken()
│   └── time/     # UTC parsing/validation, rangesOverlap(), DISPLAY_TIMEZONE + formatForEmail()
└── modules/      # app modules, one folder each
    ├── app/      # root AppModule + sample AppController/AppService
    ├── audit/    # AuditModule (global): AuditService.record(tx, …), same transaction as the change
    ├── auth/     # AuthModule (F02): global bearer guard, staff/customer sign-in, account setup, magic link, reset, /me
    ├── email/    # EmailModule: mail classes, EmailService.enqueue(), "emails" queue processor, dev routes
    ├── health/   # GET /health (liveness), GET /ready (readiness) via @nestjs/terminus
    ├── logger/   # LoggingModule (nestjs-pino)
    ├── rate-limit/ # global ThrottlerGuard, counts stored in Redis
    ├── authorization/ # AuthzModule (F03): @nestjs/authorization + SubjectResolver, @Roles/@UsePolicy, startup coverage check, policies/
    ├── tenancy/  # TenancyModule (F01): admin onboarding, /tenants/current, /public/:slug, TenantResolver; tenants/memberships/staff repositories
    ├── team/     # TeamModule (F04): /members (add, role, bookable, remove, resend setup), /staff calendars, ownership transfer (F03)
    ├── maintenance/ # MaintenanceModule (F15): "maintenance" queue, nightly job schedulers, worker, /admin/maintenance
    └── <feature>/
```

- Every app module, the root `AppModule` included, lives in `src/modules/<name>/` with its controller, service and `*.spec.ts` side by side. Never put modules directly in `src/`.
- **Third-party integrations** (Redis, and later things like mail, S3, queues or external APIs) go in `src/shared/<integration>/` as a shared module that owns the connection/client and exports it, plus any health indicator for it. Feature modules inject what it exports instead of creating their own clients.
- App-wide setup that isn't a module goes in `src/config/`.
- Background jobs use BullMQ through `SharedQueueModule`: a feature module calls `BullModule.registerQueue({ name })`, injects it with `@InjectQueue(name)`, and processes it with a `@Processor(name)` class extending `WorkerHost` in the same module. Jobs retry 3 times by default, so processors must be idempotent; pass a `jobId` derived from the work to avoid duplicates. Recurring jobs use a BullMQ job scheduler (`queue.upsertJobScheduler(id, { pattern, tz: DISPLAY_TIMEZONE }, …)` at startup), not `@nestjs/schedule`: Redis creates one job per tick across all instances, so no lock is needed. Housekeeping jobs go in `MaintenanceModule` (`MaintenanceJob` + `MAINTENANCE_SCHEDULES`); the work lives in a service of the module that owns the data.
- Emails are sent through the queue: inject `EmailService` (import `EmailModule`) and call `enqueue('welcome', to, data, { jobId })`. Never call `Mailer.send()` from a request handler. A new email = a template in `src/shared/mail/templates/`, a `Mailable` class in `src/modules/email/mails/`, and an entry in `MAILS` (`email.constants.ts`).
- Request validation uses Zod with `@Body({ schema })` / `@Query('x', { schema })`; the global `StandardSchemaValidationPipe` is registered in `configureApp()`. Put a feature's schemas in `<feature>.schemas.ts` and derive types with `z.infer`.
- Configuration: read `env` (or `isProduction`) from `src/config/env.ts`, never `process.env`. A new variable goes into `envSchema` (with a default or `.optional()`), `.env.example`, and the Configuration table in `docs/architecture.md`. Invalid values stop the app at startup with a list of every problem.
- **Database (PostgreSQL + Prisma 7):** schema in `prisma/schema.prisma`, migrations in `prisma/migrations/` (committed). After a schema change run `npm run db:migrate -- --name <change>`; never edit an applied migration. Models are PascalCase singular mapped to snake_case tables/columns (`@@map`/`@map`), ids are `@default(uuid(7)) @db.Uuid`, timestamps `@db.Timestamptz(3)`.
- **Feature layering:** controller (HTTP only) → service (rules, throws Nest HTTP exceptions) → repository (the only class that uses `PrismaService`). Repositories `select` the fields the API returns and never return whole Prisma rows; their methods take an optional `tx: Prisma.TransactionClient` so services can compose them in `prisma.$transaction(async (tx) => …)`. Map Prisma errors with `isPrismaError(error, PrismaErrorCode.UniqueViolation)` (→ 409) rather than check-then-insert.
- **Errors:** every error response is `{ "error": { "code", "message", "requestId" } }` (`ApiExceptionFilter`, global). For an expected business error throw `new DomainError(HttpStatus.CONFLICT, ErrorCode.SlotTaken, '…')` and add new codes to `ErrorCode` (never rename one). Plain Nest exceptions still work and get a code from their status. Unmapped `P2002` → 409, `P2025` → 404, `23P01` → 409; use `isExclusionViolation()` / `isSerializationFailure()` from `prisma-errors.ts` to map them to domain codes yourself.
- **Authentication (F02):** every route needs a bearer token (global guard from `@nestjs/authentication`); open a route with `@Public()`, restrict by identity with `@StaffOnly()` / `@CustomerOnly()`, read the user with `@CurrentUser()` (a `Principal`: `kind: 'staff' | 'customer'`). Never put roles in tokens. Staff users never self-register: a flow that creates one inserts the `User` as `PENDING_SETUP` and calls `AccountSetupService.createSetupLink(userId, tx)` in its transaction, then emails the URL after commit. Emailed tokens store only their SHA-256 and answer `410 LINK_EXPIRED` when dead. Social sign-in (Google/Microsoft, F02 v2) is **customers only** and lives in `src/modules/auth/social/`: match identities by `(provider, subject)` and join an account by email only when both the provider and our record verified it; every sign-in, social included, issues tokens through `AuthTokensService.signIn()` (never the package's session sign-in). E2E tests fake Google with `test/support/fake-oidc-provider.ts`. E2E tests override `PasswordHasher` with `new PasswordHasher({ logN: 10 })` (use `test/support/auth-app.ts`).
- **Tenancy (F01):** every business-owned table has `tenant_id` (FK to `tenant`), indexes start with it, and its migration enables RLS with the `tenant_isolation` policy (`tenant_id = app_current_tenant_id()`). The app connects as `slotwise_app`, so tenant rows are only visible inside `TenantPrismaService.run(tenantId, tx => …)` / `runInCurrent()`. Tenant repository methods take `tenantId` as their first argument and filter by it (review checklist); a foreign id is a 404. Staff tenant routes use `@TenantScoped()` (`TenantResolver`: `X-Tenant-Id`, suspended → 403) plus `@Roles(...)` or `@UsePolicy(...)` (F03). `AdminPrismaService` (BYPASSRLS) is only for `/admin/*` and cross-tenant jobs. E2E cleanup goes through `resetDatabase(admin)`.
- **Authorization (F03):** `@nestjs/authorization` is global and denies by default; `AuthorizationCoverageCheck` refuses to start unless every route declares **exactly one** of `@Public()`, `@Can.Anyone()` (any signed-in account; the service decides), `@Roles(...)` (RBAC: role alone, no record loaded) or `@UsePolicy(Policy, 'ability')` (ABAC). Never write `if (role === …)` in services. Tenant roles need `@TenantScoped()`; platform routes use `@Roles(PLATFORM_ADMIN_ROLE)`; `ANY_MEMBER` is every tenant role. The policy's guard ability (`(subject: Subject | null) => boolean`) is the coarse gate; the service loads the record tenant-scoped and calls `enforce(policy.<rule>(requireStaffSubject(), record, …))`, which returns a `Decision` with a stable code (`ROLE_RANK_TOO_LOW`, `OWNERSHIP_TRANSFER_REQUIRED`, …; `notVisible()` → 404 when the subject must not learn the record exists). Policies live in `src/modules/authorization/policies/`, are pure (unit-tested with a fixed `now`), and are registered as providers of the feature module that uses them. Lists filter with a policy `scope()` → Prisma `where`, never after loading. The subject (`Subject` in `shared/context/subject.ts`) comes from the database each request, never the token.
- **No magic strings for domain values:** compare and assign through enums/constants, never raw literals (`user.kind === AccountKind.STAFF`, `role === MemberRole.OWNER`, `where: { status: UserStatus.ACTIVE }`). Prisma enums come as runtime objects from `src/generated/prisma/client.js`; zod schemas use `z.enum(MemberRole)`. Non-Prisma values have a `const` object + derived type: `AccountKind`, `SubjectKind` (`shared/context/subject.ts`), `PLATFORM_ADMIN_ROLE` (`shared/context/request-context.ts`), `SignInMethod` (`auth.types.ts`), `InviteEmailKind` (`account-setup.service.ts`), `AuditActorType`, `NodeEnv` (`config/env.ts`), `MemberListStatus`. Swagger examples, route paths and tests asserting the JSON contract keep literals.
- **Audit:** record changes with `AuditService.record(tx, { tenantId, action, entityType, entityId, before, after })` inside the same transaction; only changed fields, never secrets.
- **Request context:** read `RequestContext.requestId()` / `RequestContext.actor()` anywhere in a request (no request-scoped providers). The auth guard calls `RequestContext.setActor()`; workers open one with `RequestContext.run()`.
- **Time and money:** instants are UTC everywhere (API strings end in `Z`: validate with `utcInstantSchema`); `DISPLAY_TIMEZONE` / `formatForEmail()` only for emails, reports and job schedules. Money is integer paise (`paiseSchema`), currency INR implied, `formatInr()` only for server-rendered text. No timezone or currency in env, DB columns or the API.
- **Seed:** `npm run db:seed` creates exactly one user, the platform admin, from `PLATFORM_ADMIN_*` env. Never add tenants, staff, services or test data to it; e2e tests build their own data and perf datasets live in `scripts/`.
- BullMQ job ids must not contain `:` (use `welcome-${id}`).
- Local dependencies run with `docker compose up -d`: PostgreSQL on **port 5433** (database `slotwise-dev`), Redis, and Mailpit (every email the app sends shows up at http://localhost:8025).
- CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, unit tests, `migrate deploy` + a drift check, the seed, e2e and the build. Run the same locally with `/check` before pushing. `/security-check [area]` audits the whole app for security problems (dependencies, secrets, config, auth, tenancy, input handling) and reports findings by severity without changing code; `/security-review` covers only the pending diff.
- E2E tests (`npm run test:e2e`) never touch dev data: they use Postgres database `slotwise-test` (created and migrated automatically) and Redis logical database 1. Both are emptied after every run, pass or fail (`test/setup/*.global-setup.ts`). Tests should still clean up what they create between tests (e.g. `deleteMany()` in `beforeEach`). E2E files run one at a time (`fileParallelism: false`) because they share the database.
- New modules are imported into `src/modules/app/app.module.ts`. The Nest CLI can't find that root module by itself, so generate with `--skip-import` and register the module by hand.

## Finishing a feature

Feature specs live in `docs/features/Fxx-*.md`. When a feature (or a new version of it) is done:

1. Under the spec's header line, add `**Status:** ✅ Completed — **vN** (YYYY-MM-DD)`, linking to the summary. Partial work is `🚧 In progress`. Bump the version (v1 → v2 …) for each later round of changes to the same feature, and keep earlier summaries.
2. Append an `## Implementation summary (vN)` section to the end of the spec with:
   - **What was built:** a table of every item in the spec's "To add" / scope, with ✅ / ⏭️ deferred / ❌, where it lives (files) and short notes.
   - **Decisions that differ from the spec**, and why.
   - **New scripts, env vars and dependencies.**
   - **Tests** added and the final pass counts.
   - **Acceptance criteria**, each with ✅ / ⏳ and how it was verified (or what blocks it).
   - **Follow-ups for later features.**
3. Update the Status column for the feature in `docs/README.md`.
4. Keep `docs/architecture.md` and this file in sync with anything new (folders, conventions, env vars, commands).

See `docs/architecture.md`.
