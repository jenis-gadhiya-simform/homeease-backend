---
description: Audit the whole app for security problems (dependencies, secrets, config, auth, tenancy, input handling) and report findings by severity
argument-hint: '[area to focus on, e.g. "auth" or "tenancy"] (optional)'
allowed-tools: Bash(npm audit *), Bash(npm ls *), Bash(git ls-files *), Bash(git log *), Bash(git grep *), Read, Grep, Glob
---

Run a security audit of the **whole SlotWise backend** (not only the current diff; for a diff use `/security-review`). Focus: $ARGUMENTS (if empty, check everything).

**Rules for this audit**

- Read-only. Do not edit any file, install or upgrade packages, or run the app. At the end, offer fixes; apply them only if the user asks.
- Never read `.env` or other secret env files (they are blocked). Use `.env.example` and `src/config/env.ts` for what variables exist.
- Never print a secret value in the report. If you find one, give its file:line and the type of secret, and mask the value.
- Every finding needs evidence: a `file:line`, a command output, or a migration name. No guesses: if you can't confirm something, list it under "Could not verify".
- Use the project conventions in `AGENTS.md` and `docs/architecture.md` as the expected behaviour.

## 1. Dependencies

- `npm audit --omit=dev --json`: list every high/critical advisory (package, severity, advisory title, fixed version, whether a direct or transitive dependency, `npm ls <pkg>` to see who pulls it in).
- `npm audit --json`: mention dev-only advisories briefly (lower risk: not shipped).

## 2. Secrets and repository hygiene

- `git ls-files '*env*'`: only `.env.example` and source files may be tracked; any real env file tracked is **Critical**.
- `.env.example` must contain placeholders only (no real keys, client secrets, passwords).
- Search tracked files (`git grep -nE`) for likely secrets: private keys (`BEGIN .*PRIVATE KEY`), `GOCSPX-`, `sk_live`, `AKIA[0-9A-Z]{16}`, `xox[bap]-`, long base64/hex strings assigned to `secret|password|token|key`. Ignore `src/generated/`, `node_modules/`, test fixtures with obvious fake values (say which you ignored).
- `git log --all --oneline --name-only -- ':(glob)**/*env*'` (history) to spot real env files that were committed once, even if deleted since. Write patterns without a literal dot-env: the env-file guard hook blocks any command that names those files.

## 3. Configuration (`src/config/`, `src/main.ts`, `src/modules/app/app.module.ts`)

- `env.ts`: production requires `DATABASE_URL` and a 32+ byte `JWT_SECRET`; the dev JWT fallback can't be used in production; social sign-in id/secret come in pairs.
- `app.setup.ts`: `helmet()` on; CORS allows only the `APP_URL` origin (never `*` with credentials); `trust proxy` only from `TRUST_PROXY`; validation pipe global.
- Swagger off in production by default (`SWAGGER_ENABLED`).
- Logger redaction covers authorization headers, cookies, passwords, tokens, and `code` / `state` / `intent` in URLs (`redactUrl`).
- Error filter: no stack traces or internal messages in 5xx responses.
- Rate limiting: global throttler plus stricter limits on sign-in, magic link, password reset, social login/callback.

## 4. Authentication and sessions (`src/modules/auth/`)

- Every controller/route is protected by the global guard unless `@Public()`. List **every** `@Public()` (Grep `@Public\(\)` in `src/**/*.ts`) and justify each one; an unexpected public route is High.
- Customer vs staff separation: staff-only routes use `@StaffOnly()` / tenant routes `@TenantScoped(...)`; customer routes `@CustomerOnly()`.
- Tokens: no roles in JWT claims; `JwtAuth.validate()` reloads the user each request; refresh cookie `httpOnly`, `SameSite=Strict`, path `/auth`, `Secure` in production; refresh reuse revokes the family.
- Emailed tokens and link intents: random 32 bytes, only SHA-256 stored, single use, expiry enforced.
- Passwords: hashed with `PasswordHasher`, policy enforced on set, same error and timing for unknown/wrong/disabled users.
- Social sign-in (`social/`): identities matched by `(provider, subject)` only; email links an account only when both sides verified it; no token ever in a redirect URL; `redirectTo` restricted to relative paths (open redirect); tx cookie cleared on callback; staff can't use it.

## 5. Authorization and tenancy

- Every business-owned table has `tenant_id`, RLS enabled and the `tenant_isolation` policy: compare `prisma/schema.prisma` models with `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` in `prisma/migrations/*/migration.sql`. A tenant table without RLS is High.
- Tenant repositories take `tenantId` first and filter by it; services use `TenantPrismaService.run()` / `runInCurrent()`.
- `AdminPrismaService` (BYPASSRLS) is used only under `/admin/*` and jobs: Grep its injections and list each use.
- Platform-admin routes are guarded (`PlatformAdminGuard`).
- Look for IDOR: handlers that load a record by `:id` without checking it belongs to the caller's tenant/account.

## 6. Input, output and injection

- Every `@Body`, `@Query`, `@Param` has a zod `schema` (Grep for decorators without `{ schema`).
- Raw SQL: Grep `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw` in `src/` (excluding `src/generated/`); string-interpolated SQL with request data is Critical.
- Outbound requests (`fetch`, HTTP clients) with URLs from user input (SSRF).
- Redirects built from user input (open redirect).
- Repositories `select` explicit fields (no password hashes or token hashes leaking into responses).
- Emails/templates: user data escaped.
- Files and paths built from user input (path traversal).

## 7. Report

Finish with:

1. **Summary**: one line per severity with counts, and the overall verdict (e.g. "No critical issues; 2 high to fix before production").
2. **Findings table**, most severe first:

   | #   | Severity | Area | Where (file:line) | Problem | Why it matters | Suggested fix |
   | --- | -------- | ---- | ----------------- | ------- | -------------- | ------------- |

   Severity: **Critical** (exploitable now / secret exposed), **High** (likely exploitable or missing core control), **Medium** (defence-in-depth gap), **Low** (hardening), **Info**.

3. **Checked and OK**: a short list of the controls verified as correct (so the user knows what was covered).
4. **Could not verify**: anything that needs the running app, production config, or secrets.
5. Ask which findings to fix.
