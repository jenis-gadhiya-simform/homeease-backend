# F02 — Authentication

**Phase:** 1 · **Modules:** security groundwork for 1.10 · **Depends on:** F00

**Status:** ✅ Completed — **v1** (2026-11-22) · see [Implementation summary](#implementation-summary-v1)

## Goal

Two kinds of identity, one auth system (`@nestjs/authentication`):

- **Staff-side users** (Platform admin, Owner, Manager, Receptionist, Staff): email + password. **They never self-register.** The platform admin is seeded (F00); an Owner is created by the platform admin (F01); Managers, Receptionists and Staff are added by the Owner (F04). Each new user sets their own password through a single-use **account-setup link**.
- **Customers**: self-service; magic link **or** email + password, their choice; can set a password later.

## Data model

```prisma
model User {                 // staff-side identity, global (one person can work at two businesses)
  id              String   @id @default(uuid(7)) @db.Uuid
  email           String   @unique              // stored lowercased
  passwordHash    String?  @map("password_hash")  // null until the user completes account setup
  name            String
  isPlatformAdmin Boolean  @default(false) @map("is_platform_admin") // only the seed sets this
  status          UserStatus @default(PENDING_SETUP)                  // PENDING_SETUP | ACTIVE | DISABLED
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(3)
  @@map("user")
}

model AccountSetupToken {    // set-password link for new staff-side users, also used for password reset
  id          String    @id @default(uuid(7)) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  purpose     String                                // SETUP | RESET
  tokenHash   String    @unique @map("token_hash")  // sha256; raw token only in the email
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz(3) // SETUP 72 h, RESET 30 min
  usedAt      DateTime? @map("used_at") @db.Timestamptz(3)
  @@index([userId, purpose])
  @@map("account_setup_token")
}

model CustomerAccount {      // customer identity, global; per-business profile lives in Customer (F08)
  id              String    @id @default(uuid(7)) @db.Uuid
  email           String    @unique
  passwordHash    String?   @map("password_hash") // null = magic-link only
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(3)
  @@map("customer_account")
}

model MagicLinkToken {
  id          String   @id @default(uuid(7)) @db.Uuid
  accountId   String   @map("account_id") @db.Uuid
  tokenHash   String   @unique @map("token_hash")  // sha256 of the token; raw token only in the email
  expiresAt   DateTime @map("expires_at") @db.Timestamptz(3)
  usedAt      DateTime? @map("used_at") @db.Timestamptz(3)
  @@map("magic_link_token")
}
```

Sessions / refresh tokens follow whatever `@nestjs/authentication` provides; store refresh tokens hashed with a `familyId` for reuse detection.

## Flows

**Staff sign-in:** `POST /auth/staff/login {email, password}` → access token (short, ~15 min) + refresh token (httpOnly cookie, rotating). Timing-safe compare; same error for unknown email, wrong password, `PENDING_SETUP` and `DISABLED` users.

**Staff account setup** (new Owner from F01, new member from F04):

1. The creating flow inserts the `User` (`PENDING_SETUP`, no password) and an `AccountSetupToken` (`SETUP`, 32 random bytes, 72 h), and enqueues the welcome email with the link after commit.
2. `GET /auth/account-setup/:token` → `200 { email, name, businessName }` so the page can greet the user (410 if used/expired).
3. `POST /auth/account-setup {token, password}` → sets the hash, `status = ACTIVE`, `emailVerifiedAt = now()`, marks the token used, revokes other open setup tokens for that user, signs them in.
4. Creating a new token for the same user (resend) invalidates the previous one.

**Platform admin:** same login endpoint; the token carries `pa: true`. Admin-only routes live under `/admin/*` (F01 onboarding, F19 operations).

**Customer magic link:**

1. `POST /auth/customer/magic-link {email, tenantSlug}` → always `202` (no account enumeration). Creates the account if new.
2. Email via `EmailService.enqueue('magic-link', ...)` with a 32-byte random token, valid 15 min, single use.
3. `POST /auth/customer/magic-link/verify {token}` → marks `usedAt`, sets `emailVerifiedAt`, issues tokens.

**Customer password:** `POST /auth/customer/login`; `POST /me/password` (signed in; requires current password if one is set, otherwise allowed after a fresh magic-link session).

**Common:** `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/password/forgot` + `/reset` (staff: `AccountSetupToken` with purpose `RESET`, 30 min; customers: same pattern on `CustomerAccount`), `GET /me` (staff: user + memberships with role per business; customer: account).

There is **no** staff registration endpoint.

## Token claims

```json
{ "sub": "user-uuid", "kind": "staff" | "customer", "pa": false }
```

Do **not** put tenant role in the token; roles are looked up per request from `Membership` (F04) so revoking access works immediately (cache 60 s in Redis if needed).

## Security rules

- Passwords: argon2id (or what the package uses), min 10 chars, check against a small breached-password list.
- `@Throttle` on login, magic link and reset: 5/min per IP and per email.
- Global auth guard; `@Public()` for public booking pages and webhooks.
- Redact tokens and passwords in logs (already configured for `password`/`token` fields).

## Acceptance criteria / tests

- Seeded platform admin can log in; its token has `pa: true`.
- A `PENDING_SETUP` user cannot log in; after `POST /auth/account-setup` they can.
- Setup and magic-link tokens cannot be used twice or after expiry (410).
- Unknown and known emails produce identical responses and similar timing on login and magic-link request.
- Refresh-token reuse revokes the whole family.
- A customer token is rejected on staff endpoints and vice versa.

## Implementation summary (v1)

**Completed:** 2026-11-22 · **Branch:** `main` (not yet committed at time of writing)

### What was built

| Item                                                                       | Status | Where                                                                                  | Notes                                                                                                                                                        |
| -------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User` (staff identity)                                                    | ✅     | `prisma/schema.prisma`                                                                 | From F00; gained the `accountSetupTokens` relation.                                                                                                          |
| `AccountSetupToken` (SETUP 72 h / RESET 30 min)                            | ✅     | schema, `repositories/account-setup-tokens.repository.ts`                              | `purpose` is an enum. SHA-256 only; spend = one conditional `UPDATE … WHERE used_at IS NULL`.                                                                |
| `CustomerAccount`                                                          | ✅     | schema, `repositories/customer-accounts.repository.ts`                                 | Email lowercased; `findOrCreate` safe under races.                                                                                                           |
| `MagicLinkToken`                                                           | ✅     | schema, `repositories/magic-link-tokens.repository.ts`                                 | Extra `purpose` column (LOGIN / RESET), see decisions.                                                                                                       |
| Refresh tokens hashed, with `familyId`, reuse detection                    | ✅     | `refresh_token` + `refresh_token_family`, `repositories/prisma-refresh-token.store.ts` | Store for `TokenService`; passes `authenticationStoreContract()` incl. concurrency cases.                                                                    |
| Staff sign-in `POST /auth/staff/login`                                     | ✅     | `auth.controller.ts`, `sign-in.service.ts`                                             | Same 401 `INVALID_CREDENTIALS` for unknown / wrong / pending / disabled, after the same hash work.                                                           |
| Access token (~15 min) + rotating refresh token in httpOnly cookie         | ✅     | `auth-tokens.service.ts`                                                               | Cookie `sw_refresh`: httpOnly, `SameSite=Strict`, path `/auth`, `Secure` in production.                                                                      |
| Account setup `GET /auth/account-setup/:token`, `POST /auth/account-setup` | ✅     | `account-setup.service.ts`                                                             | Activates, verifies email, spends the link, revokes other open setup links, signs in. `businessName` is `null` until F01.                                    |
| Resend invalidates the previous link                                       | ✅     | `AccountSetupService.createSetupLink()`                                                | Used by F01 / F04 inside their transaction.                                                                                                                  |
| Platform admin token `pa: true`                                            | ✅     | `AuthTokensService.signIn()`                                                           | Informational; authorization reads `User.isPlatformAdmin`.                                                                                                   |
| Customer magic link `POST /auth/customer/magic-link` (+ `/verify`)         | ✅     | `customer-auth.service.ts`                                                             | Always 202; creates the account if new; 15 min, single use; marks email verified.                                                                            |
| Customer password login `POST /auth/customer/login`                        | ✅     | `sign-in.service.ts`                                                                   |                                                                                                                                                              |
| `POST /me/password` (customer)                                             | ✅     | `me.controller.ts`                                                                     | Current password if one is set; otherwise a magic-link session ≤ 15 min old (`amr: ['email']` + `auth_time`). Signs out other devices, returns fresh tokens. |
| `POST /auth/refresh`, `POST /auth/logout`                                  | ✅     | `auth.controller.ts`                                                                   | Reuse → 401 and the family is revoked.                                                                                                                       |
| `POST /auth/password/forgot` + `/reset` (staff and customer)               | ✅     | `password-reset.service.ts`                                                            | Body has `accountType: 'staff' \| 'customer'`. Always 202; reset revokes every refresh family.                                                               |
| `GET /me`                                                                  | ✅     | `me.controller.ts`                                                                     | Staff user or customer account. ⏭️ Memberships per business come with F04.                                                                                   |
| Token claims `{ sub, kind, pa }`, no roles                                 | ✅     | `auth.types.ts`                                                                        | Plus `amr`, `auth_time`, `iss`, `aud`.                                                                                                                       |
| Passwords: hashing, min 10, breached list                                  | ✅     | `PasswordHasher` (scrypt, the package's), `passwordSchema` (F00)                       | scrypt rather than argon2id: the spec allows "what the package uses".                                                                                        |
| Throttle login, magic link, reset: 5/min per IP and per email              | ✅     | `@Throttle` per IP, `auth-rate-limiter.ts` per email (Redis)                           | `AUTH_THROTTLE_LIMIT`; email hashed in the Redis key; fails open.                                                                                            |
| Global auth guard, `@Public()`                                             | ✅     | `AuthenticationModule.forRoot()` in `auth.module.ts`                                   | Health, sample `GET /`, dev email routes and `/auth/*` are public.                                                                                           |
| Customer token rejected on staff endpoints and vice versa                  | ✅     | `account-kind.guard.ts` (`@StaffOnly()`, `@CustomerOnly()`)                            | 403 `WRONG_ACCOUNT_TYPE`.                                                                                                                                    |
| Redact tokens / passwords in logs                                          | ✅     | `logger.module.ts`                                                                     | Added `accessToken`, `refreshToken`, `currentPassword`, `newPassword`.                                                                                       |
| Emails                                                                     | ✅     | `mails/magic-link.mail.ts`, `mails/password-reset.mail.ts`, templates                  | Setup emails (`owner-welcome`, `member-welcome`) belong to F01 / F04.                                                                                        |

### Decisions that differ from the spec

- **Customer password reset uses `MagicLinkToken` with `purpose = RESET`** instead of a separate table ("same pattern on `CustomerAccount`"): same columns, same rules. Sign-in links can't be used as reset links and vice versa.
- **Forgot / reset take `accountType`**: staff and customer identities are separate tables and an email can exist in both.
- **Unknown, used and expired links all answer `410 LINK_EXPIRED`** (the spec names used/expired): an unknown token is indistinguishable from a spent one.
- **Refresh-token tables use text ids** (`refresh_token.id` is the package's SHA-256, `family_id`/`user_id` are opaque strings) and `user_id` has no foreign key: it points at either `user` or `customer_account`.
- **`tenantSlug` on magic-link request is optional** and only carried into the link (`&tenant=`); F01 validates it and adds the business name to the email.
- **`RequestContext.Actor` gained `kind`** and `role` is nullable: `PLATFORM_ADMIN` for the admin, `null` until F01 resolves a tenant role.
- **E2E files run sequentially** (`fileParallelism: false`): they share one database, and one file's cleanup could otherwise delete another's rows.

### New scripts, env vars and dependencies

- Env: `JWT_SECRET` (32+ bytes, required in production; a public dev value otherwise), `ACCESS_TOKEN_TTL` (`15m`), `REFRESH_TOKEN_TTL` (`30d`), `AUTH_THROTTLE_LIMIT` (`5`), `APP_URL` (`http://localhost:5173`). In `.env.example` and `docs/architecture.md`.
- Migration `20261122080013_add_authentication`.
- Error codes: `INVALID_CREDENTIALS`, `LINK_EXPIRED`, `REAUTHENTICATION_REQUIRED`, `WRONG_ACCOUNT_TYPE`.
- No new dependencies (`@nestjs/authentication` was already installed).

### Tests

- Unit: `one-time-token.spec.ts`, `auth-tokens.service.spec.ts` (duration, cookie parsing), `customer-auth.service.spec.ts` (fresh magic-link rule), `account-kind.guard.spec.ts`, `sign-in.service.spec.ts` (dummy-hash check, status rules, rehash), `auth-rate-limiter.spec.ts`, `env.spec.ts` (JWT/TTL/APP_URL).
- E2E: `test/auth.e2e-spec.ts` (22 cases: every flow below), `test/auth-store.e2e-spec.ts` (the package's refresh-store contract, with concurrency), `test/auth-rate-limit.e2e-spec.ts`. Shared helpers in `test/support/auth-app.ts`.
- Final counts: **unit 106 passed**, **e2e 55 passed** (8 files). Format, lint, typecheck and build clean.

### Acceptance criteria

| Criterion                                                             | Status | How verified                                                                                                                                                 |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seeded platform admin can log in; token has `pa: true`                | ✅     | e2e "signs the platform admin in…"; also run against the dev server with the seeded admin.                                                                   |
| A `PENDING_SETUP` user cannot log in; after account setup they can    | ✅     | e2e "lets a pending user set a password once, then sign in".                                                                                                 |
| Setup and magic-link tokens can't be used twice or after expiry (410) | ✅     | e2e account-setup and magic-link cases (reuse, expiry, resend, two concurrent submissions → one 200, one 410).                                               |
| Unknown and known emails: identical responses and similar timing      | ✅     | e2e identical 401 bodies / identical 202s; unit test proves a hash is checked for unknown emails and users without a password.                               |
| Refresh-token reuse revokes the whole family                          | ✅     | e2e "revokes the whole family…"; store contract suite.                                                                                                       |
| Customer token rejected on staff endpoints and vice versa             | ✅     | e2e (staff token on `/me/password` → 403); guard unit test covers both directions. No staff-only route exists yet: F01's `/admin/*` will use `@StaffOnly()`. |

### Follow-ups for later features

- **F01:** `GET /auth/account-setup/:token` should return the business name; owner-welcome email using `AccountSetupService.createSetupLink(userId, tx)`; validate `tenantSlug` on magic-link requests and name the business in the email.
- **F04:** `GET /me` lists memberships with the role per business; member-welcome email.
- **F03:** `@nestjs/authorization` is not installed yet; `@StaffOnly()` / `@CustomerOnly()` cover the identity split until then.
- Throttler tracking by user (`getTracker`) once authenticated routes need per-user limits.
- Expired refresh families are pruned on each save; used/expired setup and magic-link rows are kept (a cleanup job fits F15).
