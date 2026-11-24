# Architecture

This document describes how the backend is put together and how an HTTP request travels through it. It reflects the code as it is today; update it when you add modules, global guards, interceptors or a database.

## Tech stack

| Concern       | Choice                                                             |
| ------------- | ------------------------------------------------------------------ |
| Runtime       | Node.js, **ESM only** (`"type": "module"`)                         |
| Framework     | NestJS 12 (`@nestjs/core`, `@nestjs/common`)                       |
| HTTP adapter  | Express (`@nestjs/platform-express`)                               |
| Language      | TypeScript (strict, `module: nodenext`, target ES2023)             |
| Observability | NestJS Observe (`@nestjs/observe`) — traces, errors, logs, metrics |
| Logging       | pino via `nestjs-pino` (+ `pino-http`, `pino-pretty` in dev)       |
| API docs      | OpenAPI via `@nestjs/swagger` — Swagger UI at `/docs`              |
| Tests         | Vitest + `@nestjs/testing`, Supertest for e2e                      |
| Lint / format | oxlint (type-aware) / Prettier                                     |

## Project layout

```
backend/
├── src/
│   ├── main.ts                  # Entry point: creates the Nest app and listens on PORT
│   ├── config/                  # App-wide setup, not modules
│   │   ├── env.ts               # Zod schema for every env var → typed `env`, validated at startup
│   │   ├── app.setup.ts         # configureApp(): helmet, validation pipe, trust proxy (used by main.ts + e2e)
│   │   ├── observe.ts           # createObserveModule() → ObserveModule + ObserveInstrument
│   │   ├── swagger.ts           # OpenAPI document + Swagger UI at /docs
│   │   └── swagger.spec.ts
│   ├── generated/prisma/        # Prisma client, generated (gitignored)
│   ├── shared/                  # Third-party integrations, shared across modules
│   │   ├── context/
│   │   │   ├── request-context.ts            # RequestContext (AsyncLocalStorage): requestId, actor, ip
│   │   │   └── request-context.middleware.ts # opens it per request, sets X-Request-Id
│   │   ├── database/
│   │   │   ├── database.module.ts  # DatabaseModule (@Global)
│   │   │   ├── prisma.service.ts   # PrismaService (role slotwise_app) + AdminPrismaService (slotwise_admin, BYPASSRLS): pg pools, TimeZone=UTC
│   │   │   ├── tenant-prisma.service.ts # TenantPrismaService: transactions with app.tenant_id / app.user_id set (RLS)
│   │   │   ├── database.health.ts  # SELECT 1 check for /ready
│   │   │   └── prisma-errors.ts    # isPrismaError(), isExclusionViolation(), isSerializationFailure()
│   │   ├── errors/
│   │   │   ├── domain-error.ts         # DomainError(status, code, message) + ErrorCode
│   │   │   └── api-exception.filter.ts # global filter: the error envelope
│   │   ├── money/money.ts       # Paise, paiseSchema, formatInr()
│   │   ├── security/password-policy.ts # passwordSchema (F02 policy)
│   │   ├── security/one-time-token.ts  # generateOneTimeToken(): 32 random bytes + the SHA-256 stored in its place
│   │   ├── time/time.ts         # utcInstantSchema, parseUtc(), rangesOverlap(), DISPLAY_TIMEZONE, formatForEmail()
│   │   ├── mail/
│   │   │   ├── mail.module.ts   # SharedMailModule: @nestjs/mail transport, templates, default from
│   │   │   ├── mail-transport.ts # MAIL_TRANSPORT: smtp (default) | log | file
│   │   │   └── templates/       # layout.html + <mail>.html / <mail>.txt (copied to dist on build)
│   │   ├── queue/
│   │   │   └── queue.module.ts  # SharedQueueModule: BullMQ connection + default job options
│   │   └── redis/
│   │       ├── redis.module.ts  # SharedRedisModule (@Global): one Redis client for the app
│   │       └── redis.health.ts  # RedisHealthIndicator (PING) for /ready
│   └── modules/                 # App modules
│       ├── app/
│       │   ├── app.module.ts    # Root module: wires Observe, logging + feature modules
│       │   ├── app.controller.ts      # Sample controller (GET /)
│       │   ├── app.service.ts         # Sample service
│       │   └── app.controller.spec.ts
│       ├── auth/                # AuthModule (F02): global JWT guard, sign-in, account setup, magic link, reset, /me; social/ = Google/Microsoft (v2)
│       │   └── repositories/    # users, customer accounts, setup/magic-link tokens, PrismaRefreshTokenStore
│       ├── audit/               # AuditModule (global): AuditService.record(tx, …) — F09 table only
│       ├── email/               # EmailModule: mails/, EmailService, EmailProcessor, dev routes
│       ├── health/              # GET /health, GET /ready (@nestjs/terminus)
│       ├── logger/
│       │   └── logger.module.ts # LoggingModule (nestjs-pino)
│       ├── rate-limit/          # RateLimitModule: global ThrottlerGuard, Redis storage
│       ├── tenancy/             # TenancyModule (F01): /admin/tenants, /tenants/current, /public/:slug, TenantGuard
│       │   └── repositories/    # tenants, memberships, staff (exported for tenant features)
│       ├── team/                # TeamModule (F04): /members (add, list, change role/bookable, remove, resend setup), /staff
│       ├── maintenance/         # MaintenanceModule (F15): "maintenance" queue, nightly schedules (BullMQ job schedulers), worker, /admin/maintenance
│       └── <feature>/
│           ├── <feature>.module.ts
│           ├── <feature>.controller.ts
│           ├── <feature>.service.ts
│           └── <feature>.*.spec.ts
├── test/
│   ├── setup/                   # e2e global setup: test database + Redis db 1
│   └── *.e2e-spec.ts            # End-to-end tests against the full AppModule
├── .github/workflows/ci.yml     # CI: format, lint, typecheck, unit, migrations, seed, e2e, build
├── docs/                        # Project documentation (this file)
├── prisma/
│   ├── schema.prisma            # Data model
│   ├── migrations/              # SQL migrations (committed)
│   ├── seed.ts                  # npm run db:seed: the platform admin, nothing else
│   └── seed/platform-admin.ts   # seed logic (tested in test/seed.e2e-spec.ts)
├── prisma.config.ts             # Prisma CLI config (schema, migrations, seed, DATABASE_URL)
├── docker-compose.yml           # Local PostgreSQL (5433) + Redis + Mailpit: docker compose up -d
├── .claude/                     # Claude Code commands, hooks and skills
├── dist/                        # Build output (nest build) — not committed
├── nest-cli.json                # Nest CLI config (sourceRoot: src)
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts / vitest.config.e2e.ts
└── .env / .env.example          # Runtime configuration
```

### Conventions

- **ESM imports:** relative imports end in `.js` (e.g. `import { AppService } from './app.service.js'`), even though the source is `.ts`. There is no `__dirname`; use `import.meta.dirname`.
- **Every module lives in `src/modules/`**, including the root `AppModule` (`src/modules/app/`). Each feature gets its own folder `src/modules/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and is imported into `AppModule` (`import { OrdersModule } from '../orders/orders.module.js'`).
- **Third-party integrations live in `src/shared/<integration>/`.** A shared module owns the client (connection, config, shutdown), exports it, and provides a health indicator for `/ready`. Feature modules inject it and never create their own clients. Redis is the first one.
- **App-wide setup lives in `src/config/`** (Helmet, Observe, Swagger, and later things like env validation). Only `main.ts` sits at the root of `src/`.
- **Scaffolding:** use the `/new-module` Claude command. With the Nest CLI, run `nest g resource modules/<feature> --skip-import` and add the module to `AppModule`'s `imports` yourself. The CLI only looks for a root module in parent folders, so it can't find `src/modules/app/app.module.ts` on its own.
- **Tests beside code:** unit tests are `*.spec.ts` next to the file they test; e2e tests are `test/*.e2e-spec.ts`.

## Module structure

```mermaid
graph TD
    main["main.ts<br/>NestFactory.create(AppModule, { instrument: ObserveInstrument })"]
    AppModule["AppModule (root)"]
    Observe["ObserveModule.forRoot()<br/>serviceId: backend"]
    Ctrl["AppController<br/>GET /"]
    Svc["AppService"]

    main --> AppModule
    AppModule -->|imports| Observe
    AppModule -->|controllers| Ctrl
    AppModule -->|providers| Svc
    Ctrl -->|injects| Svc
```

- **`AppModule`** is the root of the dependency-injection graph. Every feature module must be reachable from its `imports`.
- **`ObserveModule`** is created in `src/config/observe.ts` with `createObserveModule()`, which also returns `ObserveInstrument`. The instrument is passed to `NestFactory.create` so Observe can trace the app from bootstrap onward.
- **`AppController` / `AppService`** are samples generated by the Nest CLI. They show the controller → service pattern and can be removed once real features exist.

## Application startup

1. `main.ts` calls `NestFactory.create(AppModule, { instrument: ObserveInstrument, bufferLogs: true })`. Startup logs are held until the logger is ready.
2. Nest scans `AppModule`, resolves its imports, and instantiates providers and controllers through dependency injection (`AppService` is injected into `AppController`'s constructor).
3. `ObserveModule.forRoot()` initialises telemetry. It is **enabled only when `NODE_ENV === 'production'`** and reads `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` from the environment.
4. `LoggingModule` builds the pino logger, and `app.useLogger(app.get(Logger))` makes it Nest's logger and replays the buffered startup logs through it.
5. If Swagger is enabled (`isSwaggerEnabled()`), `setupSwagger(app)` builds the OpenAPI document from the controllers and serves it.
6. Routes are registered on the Express adapter and the app listens on `process.env.PORT` (default `3000`).
7. `main.ts` uses top-level `await bootstrap()`, which ESM allows.

## Request flow

Every HTTP request passes through Nest's request pipeline. The stages below are the standard Nest order; the right column shows what this project currently has in each one.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant E as Express (HTTP adapter)
    participant O as Observe instrumentation
    participant N as Nest pipeline
    participant H as AppController.getHello()
    participant S as AppService.getHello()

    C->>E: GET /
    E->>O: start trace span
    O->>N: middleware → guards → interceptors (before) → pipes
    N->>H: invoke route handler
    H->>S: this.appService.getHello()
    S-->>H: "Hello World!"
    H-->>N: return value
    N-->>N: interceptors (after) → serialize response
    N-->>O: end span (status, duration, errors)
    O-->>E: response
    E-->>C: 200 OK, "Hello World!"
```

| #   | Stage                  | Purpose                                                           | In this project today                                                                                                                                                                     |
| --- | ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | HTTP adapter (Express) | Parses the raw request                                            | Default Express adapter                                                                                                                                                                   |
| 2   | Middleware             | Cross-cutting request work (CORS, request IDs, logging)           | `requestContextMiddleware` (request id + `RequestContext`, first); `helmet`; pino-http request logging                                                                                    |
| 3   | Guards                 | Authentication / authorization / rate limiting                    | `AuthenticationGuard` (global, 401 without a valid bearer token unless `@Public()`), then `ThrottlerGuard` (global, 429); `AccountKindGuard` on `@StaffOnly()` / `@CustomerOnly()` routes |
| 4   | Interceptors (before)  | Wrap the handler: timing, caching, transforming                   | Observe instrumentation traces the request                                                                                                                                                |
| 5   | Pipes                  | Validate and transform `@Body`, `@Param`, `@Query`                | `StandardSchemaValidationPipe` (global, Zod)                                                                                                                                              |
| 6   | Route handler          | Controller method selected by `@Controller` + `@Get`/`@Post` path | `AppController.getHello()` on `GET /`                                                                                                                                                     |
| 7   | Service / providers    | Business logic, injected via DI                                   | `AppService.getHello()`                                                                                                                                                                   |
| 8   | Interceptors (after)   | Map or wrap the handler's result                                  | None registered                                                                                                                                                                           |
| 9   | Exception filters      | Turn thrown errors into HTTP responses                            | `ApiExceptionFilter` (global, `APP_FILTER`); `HealthCheckFilter` on the probes                                                                                                            |

### Error handling

Every error response has one shape, written by `ApiExceptionFilter` (`src/shared/errors/`, registered as `APP_FILTER` in `AppModule`):

```json
{
  "error": {
    "code": "SLOT_TAKEN",
    "message": "That slot was just booked",
    "requestId": "0193…"
  }
}
```

| Thrown                                                     | Status | `code`                                                                          |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `new DomainError(status, ErrorCode.X, message)`            | given  | `ErrorCode.X` (stable, part of the API contract)                                |
| Validation pipe (`@Body({ schema })`)                      | 400    | `VALIDATION_FAILED`, plus `details: ["to: Invalid email address"]`              |
| Any other `HttpException` (guards, throttler, `NotFound…`) | its    | from the status: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, … |
| Prisma `P2002` (unique) not handled by the service         | 409    | `ALREADY_EXISTS`                                                                |
| Prisma `P2025` (record not found)                          | 404    | `NOT_FOUND`                                                                     |
| Postgres `23P01` (exclusion constraint)                    | 409    | `CONFLICT`                                                                      |
| Anything else                                              | 500    | `INTERNAL_ERROR`, message `Internal server error`; logged with the request id   |

- Services should map constraint errors to a domain code themselves (`isExclusionViolation(error)` → `SLOT_TAKEN`); the filter's mapping is the fallback.
- A 5xx never returns the thrown message. Headers set by the thrower (`Retry-After`, `WWW-Authenticate`) are kept.
- `/ready` keeps Terminus' own 503 body (which dependency is down) through the controller-scoped `HealthCheckFilter`.
- In production, Observe records the error with its trace and logs so it can be investigated in the Observe dashboard.

### Request context

`requestContextMiddleware` (`src/shared/context/`, first middleware in `configureApp()`) gives each request an id (a well-formed incoming `X-Request-Id`, otherwise a UUID), returns it in `X-Request-Id`, and opens a `RequestContext` (`AsyncLocalStorage`) for the rest of the request:

| Value       | Set by                                            | Read by                           |
| ----------- | ------------------------------------------------- | --------------------------------- |
| `requestId` | the middleware (same id as pino's `req.id`)       | error envelope, logs, audit (F09) |
| `ip`        | the middleware (`req.ip`, honours `TRUST_PROXY`)  | audit (F09)                       |
| `actor`     | the auth guard, `RequestContext.setActor()` (F02) | audit, RLS `tenant_id` (F01)      |

Read it anywhere with `RequestContext.requestId()` / `RequestContext.actor()`: no request-scoped providers. Queue processors and scripts open their own with `RequestContext.run({ requestId, ip, actor }, fn)`.

### Time and money

| Rule                                                                                                         | Helper (`src/shared/`)                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Instants are UTC in the API, code and database. API strings are ISO 8601 ending in `Z`; offsets are rejected | `utcInstantSchema` (Zod → `Date`), `parseUtc()`, `toUtcIso()`             |
| Ranges are half-open `[start, end)` (touching ranges don't overlap), like `tstzrange '[)'`                   | `rangesOverlap()`                                                         |
| Postgres sessions run with `TimeZone=UTC`                                                                    | `PrismaService` pool option                                               |
| `Asia/Kolkata` is used **only** for emails, reports and job schedules                                        | `DISPLAY_TIMEZONE`, `formatForEmail()` → `Tue, 24 Nov 2026, 3:30 pm IST`  |
| Money is integer paise (`49900` = ₹499.00), currency INR implied                                             | `paiseSchema`, `formatInr()` → `₹1,00,000.00` (server-rendered text only) |

No timezone or currency appears in env, database columns or the API.

### Logging

`LoggingModule` (`src/modules/logger/logger.module.ts`) wraps **nestjs-pino** and replaces Nest's logger at startup (`bufferLogs: true` + `app.useLogger(app.get(Logger))` in `main.ts`), so both Nest's own logs and `new Logger(MyService.name)` calls go through pino.

- **Production:** one JSON line per log on stdout, shaped for NestJS Observe: `message`, a string `level`, `context`, and the Observe `traceId` of the request that wrote it. Lines are written through `process.stdout` so Observe's log forwarder sees them.
- **Development:** readable single-line output through `pino-pretty`.
- **Request logs:** pino-http logs one `request completed` line per request (`req.id`, method, url, status, `responseTime`). Status 4xx logs at `warn` and 5xx at `error`. `x-request-id` is reused as the request ID when sent. `/health` and `/ready` are not logged.
- **Redaction:** `authorization`, `cookie`, `set-cookie`, and any `password` / `token` field in logged objects are replaced with `[REDACTED]`. Redaction works on objects only, so never interpolate a secret into the message string.

In services, use Nest's `Logger` with structured params: `private readonly logger = new Logger(OrdersService.name)` then `this.logger.log({ orderId }, 'Order created')`. Put the object **first**: `this.logger.log('Order created', { orderId })` drops the object (it is treated as context).

### API documentation (Swagger)

`src/config/swagger.ts` builds the OpenAPI document from the controllers and their `@nestjs/swagger` decorators:

- **Swagger UI:** `http://localhost:3000/docs`
- **OpenAPI JSON:** `http://localhost:3000/docs-json` (for Postman, client generators, etc.)

It is served everywhere except production. Set `SWAGGER_ENABLED=true` or `false` to override. Bearer auth is pre-declared, so endpoints marked `@ApiBearerAuth()` get an "Authorize" button. Request bodies and params validated with Zod 4.2+ (`@Body({ schema })`) appear in the document automatically. Document each response status with `@ApiOkResponse()`, `@ApiCreatedResponse()` or `@ApiResponse({ status, description })`.

### Health checks

| Route         | Purpose                                                 | Answers                                 |
| ------------- | ------------------------------------------------------- | --------------------------------------- |
| `GET /health` | Liveness: the process is up. Never checks dependencies. | `200 {"status":"ok"}`                   |
| `GET /ready`  | Readiness: Redis answers `PING` within 1s.              | `200` when up, `503` when Redis is down |

Both are excluded from rate limiting, request logs and Observe traces. On `SIGTERM`, `/ready` answers `503 {"status":"shutting_down"}` for `SHUTDOWN_GRACE_MS` so the load balancer stops sending traffic, then Nest closes Redis and exits. Add a check for each new hard dependency (e.g. the database) to `HealthController.ready()`, with its indicator in that dependency's shared module.

### Authentication (F02)

`AuthModule` configures `@nestjs/authentication` with HS256 access tokens (`JWT_SECRET`, `ACCESS_TOKEN_TTL`, issuer `slotwise`, audience `slotwise-api`) and rotating refresh tokens stored in PostgreSQL (`PrismaRefreshTokenStore`, checked by the package's own store contract suite).

- **Every route requires a bearer token** (global guard). `@Public()` opens a route or controller; health, the sample route, dev email routes and `/auth/*` are public.
- **Two identities:** staff-side `User` (platform admin, Owner, Manager, Receptionist, Staff; never self-registers) and `CustomerAccount`. The token's `kind` claim says which table `sub` is in; `JwtAuth.validate()` loads the row **on every request** (a disabled user is locked out at once) and sets `RequestContext.actor`. Roles are never in the token.
- **Tokens:** sign-in answers `{ accessToken, tokenType, expiresIn }`; the refresh token travels only in the `sw_refresh` cookie (httpOnly, `SameSite=Strict`, path `/auth`, `Secure` in production). `POST /auth/refresh` rotates it; a reused one revokes its whole family (401).
- **Emailed links** (account setup 72 h, staff reset 30 min, magic link 15 min, customer reset 30 min) are 32 random bytes; only the SHA-256 is stored, spending one is a single conditional `UPDATE … WHERE used_at IS NULL`, and a dead link is `410 LINK_EXPIRED`. Links point at `APP_URL`.
- **No enumeration:** wrong email, wrong password, pending and disabled users get the same `401 INVALID_CREDENTIALS` after the same hash work (`PasswordHasher.verify()` against a dummy hash); magic-link and forgot-password always answer `202`.
- **Social sign-in (F02 v2):** customers only, Google and Microsoft (personal accounts), in `src/modules/auth/social/`. The package's `OidcService` does the protocol (PKCE, `state` bound to the browser by the `__Host-oidc_tx` cookie, nonce, ID-token checks); our `OidcProfileCapture` resolver hands the verified profile back before the package would create a server-side session, and `SocialSignInService` applies the account rules and issues our usual tokens (`sw_refresh`), never a token in a URL. Identities live in `customer_identity`, matched by `(provider, subject)`; logins in progress, their context and link intents live in Redis. SlotWise has no sessions: `NoSessionStore` satisfies the package's production storage check and fails loudly if anything tries to create one. A provider is on only when all its settings are set (Google: id + secret; Microsoft: id + secret + tenant). Request logs redact `code`, `state` and `intent` (`redactUrl()`). See [F02 v2](./features/F02-authentication.md#v2--social-sign-in-for-customers-google-microsoft).
- Read the user with `@CurrentUser()` in controllers, or `RequestContext.actor()` anywhere. Tests: override `PasswordHasher` with `new PasswordHasher({ logN: 10 })` (see `test/support/auth-app.ts`).

### Rate limiting

`RateLimitModule` registers `ThrottlerGuard` globally: by default **100 requests per minute per client IP, per route**. Counts are stored in Redis through `@nestjs-redis/throttler-storage`, so every instance shares one budget. Over the limit, the response is `429` with `Retry-After` (seconds).

- `@SkipThrottle()` opts a controller or route out. `@Throttle({ default: { limit: 5, ttl: 60_000 } })` tightens one route.
- **Fails open:** if Redis errors, the request is allowed and the error logged (`FailOpenThrottlerStorage`), so a Redis outage doesn't take the API down. `/ready` reports Redis down at the same time.
- Behind a load balancer, set `TRUST_PROXY` (hop count) or every client shares the proxy's IP.
- `AuthModule` is imported **before** `RateLimitModule`, so authentication runs first. Sign-in, magic-link and password-reset routes are also limited to `AUTH_THROTTLE_LIMIT` (5) per minute per IP (`@Throttle`) **and** per email (`AuthRateLimiter`, Redis, fails open).

### CORS

The web app (`APP_URL`) runs on another origin than the API (another port in dev, another subdomain in production). `configureApp()` enables CORS for **that origin only**, with credentials, so the browser sends the httpOnly `sw_refresh` cookie on `fetch(…, { credentials: 'include' })` to `/auth/refresh` and `/auth/logout`. Other origins get no CORS headers, so browsers keep their pages from reading responses. Allowed request headers: `Authorization`, `Content-Type`, `X-Tenant-Id`, `X-Request-Id`; exposed: `X-Request-Id`, `Retry-After`; preflights cached 10 min. The cookie's `SameSite=Strict` still requires the web app and the API to be **same-site** (e.g. `app.slotwise.in` + `api.slotwise.in`, or `localhost` on two ports).

### Security headers

`configureApp()` (`src/config/app.setup.ts`) applies `helmet()`: Content-Security-Policy, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, and removes `X-Powered-By`. Swagger UI works under the default CSP because it loads only same-origin scripts.

### Redis

`SharedRedisModule` (`src/shared/redis/`) opens one Redis client at startup (`REDIS_URL`) and closes it on shutdown. It is global: inject the client with `@InjectRedis()` from `@nestjs-redis/client`.

- **Startup:** if Redis can't be reached after 5 attempts, the app exits with `Redis unreachable at …` instead of hanging.
- **Runtime:** after the first connection it reconnects forever with backoff (up to 5s). Commands fail immediately while disconnected (`disableOfflineQueue`) rather than queueing and stalling requests.

### Background jobs (BullMQ)

`SharedQueueModule` (`src/shared/queue/`) configures `@nestjs/bullmq` once for the whole app: the Redis connection (`REDIS_URL`, through ioredis), a key prefix (`QUEUE_PREFIX`), and default job options:

| Option             | Default                       | Why                                                   |
| ------------------ | ----------------------------- | ----------------------------------------------------- |
| `attempts`         | 3                             | BullMQ's default is 1 (no retry)                      |
| `backoff`          | exponential, 1s → 2s → 4s     | Give a failing dependency time to recover             |
| `removeOnComplete` | keep 1 day, at most 1000 jobs | Without it, every finished job stays in Redis forever |
| `removeOnFail`     | keep 7 days                   | Long enough to debug failures                         |

It is imported in `AppModule` after `ObserveModule`, so jobs still running at shutdown are reported. On `SIGTERM`, workers finish their active job before the app exits.

**Adding a queue to a feature module:**

```ts
// src/modules/emails/emails.module.ts
@Module({
  imports: [BullModule.registerQueue({ name: 'emails' })],
  providers: [EmailsService, EmailsProcessor],
})
export class EmailsModule {}

// emails.service.ts: producer
constructor(@InjectQueue('emails') private readonly emails: Queue) {}
await this.emails.add('welcome', { userId }, { jobId: `welcome-${userId}` });

// emails.processor.ts: consumer
@Processor('emails')
export class EmailsProcessor extends WorkerHost {
  async process(job: Job<{ userId: string }>) { /* send it */ }
}
```

- A job can run more than once (retries, a crash mid-job), so make `process()` idempotent.
- Pass a `jobId` derived from the work (`welcome-${userId}`) so the same job isn't queued twice. BullMQ rejects ids containing `:`.
- Override defaults per queue (`registerQueue({ name, defaultJobOptions })`) or per job (`add(name, data, opts)`).
- Workers run inside the API process for now. To scale them separately later, start a second entry point that imports only the feature modules with processors.

**Scheduled jobs (F15):** use a BullMQ **job scheduler**, not an in-process cron. `MaintenanceScheduler` calls `queue.upsertJobScheduler(id, { pattern, tz: DISPLAY_TIMEZONE }, { name, data })` at startup. The schedule lives in Redis: re-registering on every start updates it in place, and Redis creates exactly one job per tick however many instances run, so no lock is needed. The job then goes through the queue like any other (retries, backoff, retention), and its return value is stored on the job.

| Job                          | Queue         | Schedule (IST)       | What it does                                                                                                                                                                                                                    |
| ---------------------------- | ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purge-unverified-customers` | `maintenance` | daily 03:00 (21:30Z) | `UnverifiedAccountsCleanupService.purge()`: deletes customer accounts never verified, without password or linked provider, no magic link requested for `UNVERIFIED_ACCOUNT_RETENTION_DAYS`; batches of 500, at most 100 per run |

- **To add a scheduled job:** add its name to `MaintenanceJob` and its cron pattern to `MAINTENANCE_SCHEDULES` (`maintenance.constants.ts`), then a `case` in `MaintenanceProcessor.process()` calling a service in the module that owns the data. A job that belongs to one feature (booking reminders, holds) gets its own queue in that feature's module instead.
- **Platform admin:** `GET /admin/maintenance/schedules` (pattern, timezone, next run), `POST /admin/maintenance/jobs/:job/run` (run now, `202 { jobId }`), `GET /admin/maintenance/jobs/:jobId` (state, attempts, result, failure reason).
- Processors open a `RequestContext` (`requestId: job-<id>`) so logs and errors carry an id.

### Email

Emails use `@nestjs/mail` and are always sent through the BullMQ `emails` queue, so a slow or failing mail server never blocks a request and failures are retried.

```mermaid
sequenceDiagram
    participant S as Any service
    participant ES as EmailService
    participant Q as BullMQ "emails" (Redis)
    participant P as EmailProcessor
    participant M as Mailer (@nestjs/mail)
    participant T as SMTP (Mailpit locally)
    S->>ES: enqueue('welcome', to, data, { jobId })
    ES->>Q: add job { to, data }
    Q->>P: process(job)
    P->>M: send(WelcomeMail, { to, data, retry: false })
    M->>T: render template + deliver
```

- **SharedMailModule** (`src/shared/mail/`) configures the transport, default `from` (`MAIL_FROM`) and the `FileTemplateEngine` (`templates/`, wrapped in `layout.html`). Templates use a Handlebars subset: `{{ x }}` is escaped, `{{#if}}`, `{{#each}}`, partials. A `<mail>.txt` file gives the plain-text part; otherwise it is derived from the HTML.
- **EmailModule** (`src/modules/email/`) holds the mail classes (`mails/`), `EmailService.enqueue()`, and `EmailProcessor`. Transient failures (SMTP 4xx, timeouts, connection refused) are retried with the queue's backoff. Permanent ones (SMTP 5xx, a broken template) fail the job at once.
- **Locally**, `docker compose up -d` starts **Mailpit**: the app sends to `smtp://localhost:1025` and every email appears in the inbox at **http://localhost:8025**. Nothing leaves your machine.
- **Dev routes** (not registered in production): `POST /dev/emails/welcome` `{ "to": "you@example.com", "name": "Ada" }` queues a test email; `GET /dev/emails/preview/welcome?name=Ada` renders the template in the browser without sending.
- **Tests** override `MailTransport` with `InMemoryMailTransport` and use `assertSent({ to, subject })` (see `test/email.e2e-spec.ts`).

**Adding an email:** create `templates/<name>.html` (and optionally `.txt`) in `src/shared/mail/`, a `Mailable` class in `src/modules/email/mails/` whose `render()` returns `{ subject, template: '<name>', context }`, add it to `MAILS` in `email.constants.ts`, then call `emailService.enqueue('<name>', to, data, { jobId })`.

**Production:** set `SMTP_URL` to your provider (e.g. `smtp://user:pass@smtp.example.com:587`, STARTTLS required) and `MAIL_FROM` to a domain with SPF, DKIM and DMARC set up. `@nestjs/mail` also ships HTTP transports (Resend, Postmark, SendGrid, SES) if you'd rather not use SMTP.

### Database (PostgreSQL + Prisma)

Prisma 7 with the `pg` driver adapter: queries run through node-postgres (one pool per process, size `DATABASE_POOL_MAX`), so NestJS Observe traces them like any `pg` query. The client is generated into `src/generated/prisma` (`npm run db:generate`, also run on `npm install` and before `npm run build`).

- **`DatabaseModule`** (`src/shared/database/`, global) provides `PrismaService` (app role, RLS applies), `TenantPrismaService` (tenant-scoped transactions) and `AdminPrismaService` (BYPASSRLS, admin/job code only); see Multi-tenancy below. Startup fails fast with `Database unreachable at host/db: ECONNREFUSED` if Postgres is down. The pool closes on shutdown. `/ready` checks `SELECT 1`.
- **Schema conventions** (`prisma/schema.prisma`): PascalCase singular models mapped to snake_case tables/columns, UUIDv7 primary keys (time-ordered: good index locality and keyset pagination), `timestamptz(3)` timestamps.
- **Layering** for a feature module that uses the database (`src/modules/<feature>/`):

| Layer      | File                      | Does                                                              | Never                                |
| ---------- | ------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| Schemas    | `<feature>.schemas.ts`    | Zod input schemas, response types                                 |                                      |
| Controller | `<feature>.controller.ts` | Validates input, calls one service method, Swagger docs           | Business rules, Prisma               |
| Service    | `<feature>.service.ts`    | Rules, Nest HTTP exceptions, side effects (e.g. queue an email)   | HTTP details, raw queries            |
| Repository | `<feature>.repository.ts` | Prisma queries, `select` only exposed fields, optional `tx` param | Return whole rows, throw HTTP errors |

- **Errors:** let the database enforce uniqueness and map the error: `isPrismaError(error, PrismaErrorCode.UniqueViolation)` → 409. Check-then-insert races under concurrent requests.
- **Transactions:** `await prisma.$transaction(async (tx) => { await repoA.create(a, tx); await repoB.update(b, tx); })`. Repository methods accept `tx`.
- **Pagination:** keyset (cursor) on the UUIDv7 id: `?limit=20&cursor=<nextCursor>`. Stable and fast at any depth, unlike `OFFSET`.
- **Side effects after a write** (e.g. queuing an email) run after the insert commits and never fail the request. For a guarantee that they happen exactly when the row commits, use a transactional outbox.

### Multi-tenancy and row-level security (F01)

Many businesses share one database. Every business-owned table has `tenant_id uuid not null` (FK to `tenant`), composite indexes start with `tenant_id`, and isolation has two layers:

1. **Application:** tenant repositories take `tenantId` first and always filter by it; lookups by id are `where: { id, tenantId }`, so a foreign id is a 404, never a 403.
2. **Database:** PostgreSQL row-level security. Policies compare `tenant_id` with `app_current_tenant_id()` (= `app.tenant_id`, unset → matches nothing).

| Database role    | Used by                                                      | RLS                    | How                                                              |
| ---------------- | ------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| login user       | Prisma CLI: migrations, Studio                               | owner                  | `DATABASE_URL` as is                                             |
| `slotwise_app`   | the app (`PrismaService`)                                    | applies                | `-c role=slotwise_app` on every connection (`DATABASE_APP_ROLE`) |
| `slotwise_admin` | `/admin/*` and cross-tenant jobs only (`AdminPrismaService`) | bypassed (`BYPASSRLS`) | `-c role=slotwise_admin` (`DATABASE_ADMIN_ROLE`), pool of 3      |

- `TenantPrismaService.run(tenantId, (tx) => …)` opens a transaction and runs `set_config('app.tenant_id', tenantId, true)` (transaction-local, so pooled connections never leak a tenant). `runInCurrent()` takes the tenant from `RequestContext`; `runAsUser(userId)` sets `app.user_id` to list a user's own memberships (policy `own_memberships`). Outside these, the app role sees **zero** tenant rows.
- **`TenantGuard`** (`@TenantScoped(...roles)`) resolves the business for staff requests: `X-Tenant-Id` picks one of the user's active memberships (or the only one), suspended → 403 `TENANT_SUSPENDED`, not a member → 403 `NOT_A_MEMBER`, several and no header → 400 `TENANT_REQUIRED`; then `RequestContext.setActor({ tenantId, role })`.
- Public pages take the business from the path (`/public/:slug`); a suspended business is a 404 there.
- **Team (F04).** `membership` is a login's role in one business; `staff` is a bookable calendar, linked by `membership.staff_id` (STAFF always have one; other roles when `bookable`). Calendars are never deleted: removing a member or pausing a calendar sets `staff.active = false`. Who may add/change/remove whom lives in `team/team-roles.ts` (Owner → Manager, Receptionist, Staff; Manager → Receptionist, Staff); anything that would add, change or remove an OWNER is 422 `OWNERSHIP_TRANSFER_REQUIRED`. Invitation emails are capped per business by `MemberInviteLimiter` (`MEMBER_INVITE_LIMIT`/hour, Redis).
- The `tenant` table itself has no `tenant_id` and no RLS (it is the public profile); `audit_log` is RLS'd and append-only for the app role (`INSERT`, `SELECT`).
- **A new tenant table** needs, in its migration: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and `CREATE POLICY tenant_isolation ON … USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())`. Grants come from default privileges.
- In production the login user in `DATABASE_URL` must be a member of both roles (the migration grants them to the migrating user); creating `slotwise_admin` with `BYPASSRLS` needs a superuser once.

**Audit log (F09 table).** `AuditService.record(tx, { tenantId, action, entityType, entityId, before, after })` inserts in the caller's transaction; actor, role, request id and IP come from `RequestContext`.

**Seed: one platform admin.** `npm run db:seed` (`prisma/seed.ts`, also run by `npm run db:migrate:reset`) upserts exactly one `User`, the platform admin, from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` / `PLATFORM_ADMIN_NAME`: lowercased email, `isPlatformAdmin = true`, `ACTIVE`, password hashed with `@nestjs/authentication`'s `PasswordHasher` (the one F02's login verifies with). Re-running never duplicates it and keeps the password; `npm run db:seed -- --reset-password` re-hashes it from env. The password must pass the F02 policy and is never logged. In production the same command runs once as a deploy step with credentials from the secret manager (so `tsx` is a runtime dependency). There is no API to create or promote platform admins. Tenants, staff, services, customers and test/perf data are **never** seeded.

**Migrations workflow**

| Step                                                                                 | Command                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------- |
| Change `prisma/schema.prisma`, then create + apply a migration locally               | `npm run db:migrate -- --name add_orders` |
| Create a migration without applying it (to edit the SQL first, e.g. a data backfill) | `npm run db:migrate:create -- --name …`   |
| Apply pending migrations in staging/production (a release step, not at app boot)     | `npm run db:migrate:deploy`               |
| Check for drift / pending migrations                                                 | `npm run db:migrate:status`               |
| Browse data                                                                          | `npm run db:studio`                       |

Migrations are committed and never edited once applied anywhere. For zero-downtime deploys, make changes backward-compatible (add a nullable column, deploy, backfill, then add constraints).

### Where to add things

| Need                           | Put it in                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New endpoints                  | A feature module in `src/modules/<feature>/`, imported into `AppModule`                                                                                  |
| Request validation             | A Standard Schema (e.g. Zod) with `@Body({ schema })` / `@Param('id', { schema })`                                                                       |
| Authentication                 | Already global (`AuthModule`): every route needs a bearer token; `@Public()` opens one, `@StaffOnly()` / `@CustomerOnly()` restrict by account type      |
| Tenant-scoped endpoint         | `@TenantScoped()` (or `@TenantScoped('OWNER', 'MANAGER')`); data through `TenantPrismaService.runInCurrent()`; repository methods take `tenantId` first  |
| New tenant table               | `tenant_id` + FK, indexes starting with it, and `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy in the migration                                 |
| Create a staff user            | Insert `User` (`PENDING_SETUP`, no password), then `AccountSetupService.createSetupLink(userId, tx)` in the same transaction; email the URL after commit |
| Configuration / env validation | `@nestjs/config`                                                                                                                                         |
| Database                       | `@nestjs/typeorm` or `@nestjs/drizzle` in its own module                                                                                                 |
| Rate limiting tweaks           | `@SkipThrottle()` / `@Throttle()` on the route; global limits via `THROTTLE_*` env                                                                       |
| Send an email                  | `EmailService.enqueue()`; new emails: template + `Mailable` + `MAILS` entry (see Email)                                                                  |
| Background job                 | `BullModule.registerQueue()` + a `@Processor` in the feature module (see Background jobs)                                                                |
| Database table                 | Model in `prisma/schema.prisma` → `npm run db:migrate -- --name …` → repository in the feature module                                                    |
| Third-party integration        | A shared module in `src/shared/<integration>/` that owns and exports the client + a health indicator                                                     |
| API docs for an endpoint       | `@ApiTags`, `@ApiOperation`, `@ApiOkResponse`/`@ApiResponse` from `@nestjs/swagger` on the controller                                                    |

## Configuration

All configuration comes from environment variables, validated once at startup by the Zod schema in `src/config/env.ts`. Code reads the typed `env` object (`env.THROTTLE_LIMIT` is a `number`), never `process.env`. Empty values (`LOG_LEVEL=` in `.env`) count as unset. If anything is invalid, the app refuses to start and lists every problem:

```
Error: Invalid environment variables:
✖ Invalid input: expected number, received NaN
  → at PORT
✖ Invalid URL
  → at REDIS_URL
```

To add a variable: add it to `envSchema` (with `.default()` or `.optional()`), to `.env.example`, and to this table.

### Variables

| Variable                            | Used by                                                                                             | Default                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PORT`                              | `main.ts`                                                                                           | `3000`                                                                           |
| `NODE_ENV`                          | `ObserveModule` — telemetry is on only when `production`                                            | unset (telemetry off)                                                            |
| `OBSERVE_APP_KEY`                   | `ObserveModule`                                                                                     | placeholder                                                                      |
| `OBSERVE_APP_SECRET`                | `ObserveModule`                                                                                     | placeholder                                                                      |
| `LOG_LEVEL`                         | pino logger (`LoggingModule`)                                                                       | `info` in production, `debug` otherwise                                          |
| `SWAGGER_ENABLED`                   | `main.ts` — serve Swagger UI at `/docs`                                                             | on unless `NODE_ENV=production`                                                  |
| `REDIS_URL`                         | `SharedRedisModule`, `SharedQueueModule`                                                            | `redis://localhost:6379`                                                         |
| `QUEUE_PREFIX`                      | `SharedQueueModule` — Redis key prefix for BullMQ                                                   | `bull`                                                                           |
| `MAIL_TRANSPORT`                    | `SharedMailModule` — `smtp`, `log` or `file`                                                        | `smtp`                                                                           |
| `SMTP_URL`                          | `SharedMailModule` — SMTP server                                                                    | `smtp://localhost:1025` (Mailpit)                                                |
| `SMTP_STARTTLS`                     | `SharedMailModule` — `required` / `opportunistic` / `never`                                         | `required`, `opportunistic` on localhost                                         |
| `MAIL_FROM`                         | `SharedMailModule` — default sender                                                                 | `Backend <no-reply@example.com>`                                                 |
| `DATABASE_URL`                      | `PrismaService`, Prisma CLI — PostgreSQL connection string                                          | docker Postgres `localhost:5433/slotwise-dev`; **required in production**        |
| `DATABASE_POOL_MAX`                 | `PrismaService` — max pool connections per process                                                  | `10`                                                                             |
| `JWT_SECRET`                        | `AuthModule` — HS256 key for access tokens, 32+ bytes                                               | public dev-only value; **required in production**                                |
| `ACCESS_TOKEN_TTL`                  | `AuthModule` — access-token lifetime                                                                | `15m`                                                                            |
| `REFRESH_TOKEN_TTL`                 | `AuthModule` — one refresh token's lifetime (families: 90 d)                                        | `30d`                                                                            |
| `AUTH_THROTTLE_LIMIT`               | `AuthModule` — sign-in / magic-link / reset attempts per minute, per IP and per email               | `5`                                                                              |
| `APP_URL`                           | `AuthModule`, CORS — web app base URL: emailed links, social sign-in landings, the only CORS origin | `http://localhost:5173`                                                          |
| `API_URL`                           | `AuthModule` — public API base URL; social sign-in callback URLs                                    | `http://localhost:3000`                                                          |
| `GOOGLE_CLIENT_ID`                  | `AuthModule` — Google sign-in for customers (with the secret)                                       | unset (Google off)                                                               |
| `GOOGLE_CLIENT_SECRET`              | `AuthModule` — its secret                                                                           | unset                                                                            |
| `MICROSOFT_CLIENT_ID`               | `AuthModule` — Microsoft sign-in for customers (with the secret)                                    | unset (Microsoft off)                                                            |
| `MICROSOFT_CLIENT_SECRET`           | `AuthModule` — its secret                                                                           | unset                                                                            |
| `MICROSOFT_TENANT_ID`               | `AuthModule` — Entra tenant GUID; Microsoft is on only with client id + secret + tenant             | unset (Microsoft off); personal accounts: `9188040d-6c67-4c5b-b112-36a304b66dad` |
| `MEMBER_INVITE_LIMIT`               | `TeamModule` — add-member / resend-setup emails per business per hour (F04)                         | `20`                                                                             |
| `UNVERIFIED_ACCOUNT_RETENTION_DAYS` | Nightly cleanup (F15) — delete never-verified, unused customer accounts after this many days        | `7`                                                                              |
| `DATABASE_APP_ROLE`                 | `PrismaService` — role the app switches to (RLS applies)                                            | `slotwise_app`                                                                   |
| `DATABASE_ADMIN_ROLE`               | `AdminPrismaService` — BYPASSRLS role, admin/job code only                                          | `slotwise_admin`                                                                 |
| `PLATFORM_ADMIN_EMAIL`              | Seed only (`npm run db:seed`) — the platform admin's email                                          | unset (the seed refuses to run)                                                  |
| `PLATFORM_ADMIN_PASSWORD`           | Seed only — 10+ characters, not a breached password                                                 | unset (the seed refuses to run)                                                  |
| `PLATFORM_ADMIN_NAME`               | Seed only — display name                                                                            | `Platform Admin`                                                                 |
| `THROTTLE_TTL_MS`                   | `RateLimitModule` — window length                                                                   | `60000`                                                                          |
| `THROTTLE_LIMIT`                    | `RateLimitModule` — requests per window per IP per route                                            | `100`                                                                            |
| `TRUST_PROXY`                       | `configureApp()` — proxy hop count for the client IP                                                | unset (don't trust `X-Forwarded-For`)                                            |
| `SHUTDOWN_GRACE_MS`                 | `HealthModule` — `/ready` answers 503 this long on SIGTERM                                          | `2000`                                                                           |

`npm start`, `start:dev` and `start:debug` load `.env` with `--env-file .env`. `npm run start:prod` (`node dist/main`) does **not**, so in production the variables must come from the real environment.

## Validation

- **Requests:** Zod schemas on the parameter, `@Body({ schema })`, `@Param('id', { schema })` or `@Query('q', { schema })`, checked by the global `StandardSchemaValidationPipe` (`configureApp()`). Invalid input gets `400` with a message per field, e.g. `["to: Invalid email address"]`. `z.object()` strips unknown keys; use `z.strictObject()` to reject them. Zod schemas also appear in the Swagger document automatically.
- **Environment:** `src/config/env.ts`, above.

## Build and run

| Command                           | What it does                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `docker compose up -d`            | Start local PostgreSQL (port 5433), Redis and Mailpit (required to run the app and e2e tests) |
| `npm run db:migrate`              | Apply migrations to the dev database (first run, and after pulling schema changes)            |
| `npm run db:seed`                 | Create the platform admin from `PLATFORM_ADMIN_*` (`-- --reset-password` to re-hash)          |
| `npm run start:dev`               | Watch mode, loads `.env`                                                                      |
| `npm run build`                   | `nest build` → compiles `src/` to `dist/` using `tsconfig.build.json` (specs excluded)        |
| `npm run start:prod`              | Runs the compiled `dist/main.js`                                                              |
| `npm test`                        | Unit tests (`**/*.spec.ts`)                                                                   |
| `npm run test:e2e`                | E2E tests (`**/*.e2e-spec.ts`) — boots the full `AppModule` against real Redis over HTTP      |
| `npm run lint` / `npm run format` | oxlint / Prettier (`format:check` in CI)                                                      |
| `npm run typecheck`               | `tsc --noEmit` over `src/`, `test/` and `prisma/`                                             |

## Testing layers

- **Unit tests** build a small testing module with `Test.createTestingModule({ controllers, providers })` and call methods directly. Dependencies are replaced with `vi.fn()` mocks.
- **E2E tests** import the real `AppModule`, call `createNestApplication()` and `init()`, and send real HTTP requests through the full pipeline described above.
- **E2E test data** is isolated from dev data and cleaned up automatically (`vitest.config.e2e.ts` + `test/setup/`):

| Store      | E2E uses                                                   | Before the run                            | After the run (pass or fail)                            |
| ---------- | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| PostgreSQL | database `slotwise-test` (`TEST_DATABASE_URL` to override) | created if missing, migrations applied    | every table truncated (schema + migration history kept) |
| Redis      | logical database 1 (`TEST_REDIS_URL` to override)          | emptied (leftovers of an interrupted run) | emptied (`FLUSHDB`, never `FLUSHALL`)                   |

Both setups refuse to run against a Postgres database without "test" in its name, or Redis database 0.
