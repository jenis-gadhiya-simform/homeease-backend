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
│   │   ├── app.setup.ts         # configureApp(): helmet, trust proxy (used by main.ts + e2e)
│   │   ├── observe.ts           # createObserveModule() → ObserveModule + ObserveInstrument
│   │   ├── swagger.ts           # OpenAPI document + Swagger UI at /docs
│   │   └── swagger.spec.ts
│   ├── shared/                  # Third-party integrations, shared across modules
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
│       ├── email/               # EmailModule: mails/, EmailService, EmailProcessor, dev routes
│       ├── health/              # GET /health, GET /ready (@nestjs/terminus)
│       ├── logger/
│       │   └── logger.module.ts # LoggingModule (nestjs-pino)
│       ├── rate-limit/          # RateLimitModule: global ThrottlerGuard, Redis storage
│       └── <feature>/
│           ├── <feature>.module.ts
│           ├── <feature>.controller.ts
│           ├── <feature>.service.ts
│           └── <feature>.*.spec.ts
├── test/
│   └── app.e2e-spec.ts          # End-to-end test against the full AppModule
├── docs/                        # Project documentation (this file)
├── docker-compose.yml           # Local Redis + Mailpit: docker compose up -d
├── .claude/                     # Claude Code commands, hooks and skills
├── dist/                        # Build output (nest build) — not committed
├── nest-cli.json                # Nest CLI config (sourceRoot: src)
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts / vitest.config.e2e.ts
└── .env / .env.example          # Runtime configuration
```

### Conventions

- **ESM imports:** relative imports end in `.js` (e.g. `import { AppService } from './app.service.js'`), even though the source is `.ts`. There is no `__dirname`; use `import.meta.dirname`.
- **Every module lives in `src/modules/`**, including the root `AppModule` (`src/modules/app/`). Each feature gets its own folder `src/modules/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and is imported into `AppModule` (`import { UsersModule } from '../users/users.module.js'`).
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

| #   | Stage                  | Purpose                                                           | In this project today                                |
| --- | ---------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | HTTP adapter (Express) | Parses the raw request                                            | Default Express adapter                              |
| 2   | Middleware             | Cross-cutting request work (CORS, request IDs, logging)           | `helmet` security headers; pino-http request logging |
| 3   | Guards                 | Authentication / authorization / rate limiting                    | `ThrottlerGuard` (global): 429 over the limit        |
| 4   | Interceptors (before)  | Wrap the handler: timing, caching, transforming                   | Observe instrumentation traces the request           |
| 5   | Pipes                  | Validate and transform `@Body`, `@Param`, `@Query`                | None registered                                      |
| 6   | Route handler          | Controller method selected by `@Controller` + `@Get`/`@Post` path | `AppController.getHello()` on `GET /`                |
| 7   | Service / providers    | Business logic, injected via DI                                   | `AppService.getHello()`                              |
| 8   | Interceptors (after)   | Map or wrap the handler's result                                  | None registered                                      |
| 9   | Exception filters      | Turn thrown errors into HTTP responses                            | Nest's built-in global filter                        |

### Error handling

If anything in steps 2–8 throws:

- An `HttpException` (e.g. `NotFoundException`, `BadRequestException`) becomes a JSON response with that status code: `{ "statusCode": 404, "message": "...", "error": "Not Found" }`.
- Any other error becomes `500 Internal Server Error`, and the real error is logged rather than returned to the client.
- In production, Observe records the error with its trace and logs so it can be investigated in the Observe dashboard.

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

### Rate limiting

`RateLimitModule` registers `ThrottlerGuard` globally: by default **100 requests per minute per client IP, per route**. Counts are stored in Redis through `@nestjs-redis/throttler-storage`, so every instance shares one budget. Over the limit, the response is `429` with `Retry-After` (seconds).

- `@SkipThrottle()` opts a controller or route out. `@Throttle({ default: { limit: 5, ttl: 60_000 } })` tightens one route.
- **Fails open:** if Redis errors, the request is allowed and the error logged (`FailOpenThrottlerStorage`), so a Redis outage doesn't take the API down. `/ready` reports Redis down at the same time.
- Behind a load balancer, set `TRUST_PROXY` (hop count) or every client shares the proxy's IP.
- When authentication is added, import `RateLimitModule` **after** it and track by user (see the comment in `rate-limit.module.ts`).

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
await this.emails.add('welcome', { userId }, { jobId: `welcome:${userId}` });

// emails.processor.ts: consumer
@Processor('emails')
export class EmailsProcessor extends WorkerHost {
  async process(job: Job<{ userId: string }>) { /* send it */ }
}
```

- A job can run more than once (retries, a crash mid-job), so make `process()` idempotent.
- Pass a `jobId` derived from the work (`welcome:${userId}`) so the same job isn't queued twice.
- Override defaults per queue (`registerQueue({ name, defaultJobOptions })`) or per job (`add(name, data, opts)`).
- Workers run inside the API process for now. To scale them separately later, start a second entry point that imports only the feature modules with processors.

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

### Where to add things

| Need                           | Put it in                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| New endpoints                  | A feature module in `src/modules/<feature>/`, imported into `AppModule`                               |
| Request validation             | A Standard Schema (e.g. Zod) with `@Body({ schema })` / `@Param('id', { schema })`                    |
| Authentication                 | A global guard via `@nestjs/authentication` (`@Public()` to opt routes out)                           |
| Configuration / env validation | `@nestjs/config`                                                                                      |
| Database                       | `@nestjs/typeorm` or `@nestjs/drizzle` in its own module                                              |
| Rate limiting tweaks           | `@SkipThrottle()` / `@Throttle()` on the route; global limits via `THROTTLE_*` env                    |
| Send an email                  | `EmailService.enqueue()`; new emails: template + `Mailable` + `MAILS` entry (see Email)               |
| Background job                 | `BullModule.registerQueue()` + a `@Processor` in the feature module (see Background jobs)             |
| Third-party integration        | A shared module in `src/shared/<integration>/` that owns and exports the client + a health indicator  |
| API docs for an endpoint       | `@ApiTags`, `@ApiOperation`, `@ApiOkResponse`/`@ApiResponse` from `@nestjs/swagger` on the controller |

## Configuration

| Variable             | Used by                                                     | Default                                  |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `PORT`               | `main.ts`                                                   | `3000`                                   |
| `NODE_ENV`           | `ObserveModule` — telemetry is on only when `production`    | unset (telemetry off)                    |
| `OBSERVE_APP_KEY`    | `ObserveModule`                                             | placeholder                              |
| `OBSERVE_APP_SECRET` | `ObserveModule`                                             | placeholder                              |
| `LOG_LEVEL`          | pino logger (`LoggingModule`)                               | `info` in production, `debug` otherwise  |
| `SWAGGER_ENABLED`    | `main.ts` — serve Swagger UI at `/docs`                     | on unless `NODE_ENV=production`          |
| `REDIS_URL`          | `SharedRedisModule`, `SharedQueueModule`                    | `redis://localhost:6379`                 |
| `QUEUE_PREFIX`       | `SharedQueueModule` — Redis key prefix for BullMQ           | `bull`                                   |
| `MAIL_TRANSPORT`     | `SharedMailModule` — `smtp`, `log` or `file`                | `smtp`                                   |
| `SMTP_URL`           | `SharedMailModule` — SMTP server                            | `smtp://localhost:1025` (Mailpit)        |
| `SMTP_STARTTLS`      | `SharedMailModule` — `required` / `opportunistic` / `never` | `required`, `opportunistic` on localhost |
| `MAIL_FROM`          | `SharedMailModule` — default sender                         | `Backend <no-reply@example.com>`         |
| `THROTTLE_TTL_MS`    | `RateLimitModule` — window length                           | `60000`                                  |
| `THROTTLE_LIMIT`     | `RateLimitModule` — requests per window per IP per route    | `100`                                    |
| `TRUST_PROXY`        | `configureApp()` — proxy hop count for the client IP        | unset (don't trust `X-Forwarded-For`)    |
| `SHUTDOWN_GRACE_MS`  | `HealthModule` — `/ready` answers 503 this long on SIGTERM  | `2000`                                   |

`npm start`, `start:dev` and `start:debug` load `.env` with `--env-file .env`. `npm run start:prod` (`node dist/main`) does **not**, so in production the variables must come from the real environment.

## Build and run

| Command                           | What it does                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `docker compose up -d`            | Start local Redis + Mailpit (Redis is required to run the app and the e2e tests)         |
| `npm run start:dev`               | Watch mode, loads `.env`                                                                 |
| `npm run build`                   | `nest build` → compiles `src/` to `dist/` using `tsconfig.build.json` (specs excluded)   |
| `npm run start:prod`              | Runs the compiled `dist/main.js`                                                         |
| `npm test`                        | Unit tests (`**/*.spec.ts`)                                                              |
| `npm run test:e2e`                | E2E tests (`**/*.e2e-spec.ts`) — boots the full `AppModule` against real Redis over HTTP |
| `npm run lint` / `npm run format` | oxlint / Prettier                                                                        |

## Testing layers

- **Unit tests** build a small testing module with `Test.createTestingModule({ controllers, providers })` and call methods directly. Dependencies are replaced with `vi.fn()` mocks.
- **E2E tests** import the real `AppModule`, call `createNestApplication()` and `init()`, and send real HTTP requests through the full pipeline described above.
