# F02 — Authentication

**Phase:** 1 · **Modules:** security groundwork for 1.10 · **Depends on:** F00

**Status:** ✅ Completed — **v2** (2026-11-24) · see [Implementation summary (v2)](#implementation-summary-v2) — v2 = [social sign-in for customers (Google, Microsoft)](#v2--social-sign-in-for-customers-google-microsoft) · v1 (2026-11-22): [Implementation summary (v1)](#implementation-summary-v1)

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

## v2 — Social sign-in for customers (Google, Microsoft)

> v1 (above) is unchanged; this section is the scope of **v2**, done before F03. See [Implementation summary (v2)](#implementation-summary-v2).

### Goal

Customers can sign in (and sign up) with **Google** or **Microsoft** in addition to magic link and password. A customer can link a provider to an existing account and unlink it later. Social sign-in is a third way into the **same** `CustomerAccount`, not a new kind of identity: tokens, `kind: 'customer'`, `GET /me` and everything downstream (F03 `Subject`, F07 bookings, F08 customer profile) stay exactly as they are.

**Staff-side users never use social sign-in.** They don't self-register, and their access is controlled by the Owner (F04) and the platform admin (F01); a second way in would bypass `PENDING_SETUP` / `DISABLED` handling and the account-setup link. Staff sign-in stays email + password. (Staff SSO, e.g. a business's own Entra tenant, is a possible later feature with its own spec.)

### Providers

| Provider  | Accounts accepted                                       | Package preset                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | Any Google account (gmail and Workspace)                | `google({ clientId, clientSecret })`            | Issuer `https://accounts.google.com`. Google asserts `email_verified`.                                                                                                                                                                                                                                                                                                                                |
| Microsoft | **Personal Microsoft accounts** (outlook.com, hotmail…) | `microsoft({ tenant, clientId, clientSecret })` | The package's preset is **single-tenant only**: `common` / `organizations` / `consumers` publish a templated issuer it does not validate. Personal accounts are one fixed tenant, the consumers tenant `9188040d-6c67-4c5b-b112-36a304b66dad`; set it in `MICROSOFT_TENANT_ID` (no default, see v2 decisions). Work/school (Entra) accounts from arbitrary organisations are **out of scope** for v2. |

A provider is **enabled only when all of its settings are set** (Google: client id + secret; Microsoft: client id + secret + tenant id); a disabled provider answers `404` on its routes and is left out of `GET /auth/customer/oidc/providers`. Both are optional, so local dev and CI run without them.

### Library

Use the OIDC support already in `@nestjs/authentication` (no new dependency): `AuthenticationModule.forRoot({ oidc: { callbackUrl, providers, redirectAfterLogin, transactionTtl } })`, an `OidcAccountResolver` registered with `registry.registerHandler('oidc', this)`, and `OidcService.start()` / `finish()` behind our own routes. It does the authorization-code flow with **PKCE (S256), `state` and `nonce`**, binds the login to the browser with an `HttpOnly` `__Host-oidc_tx` cookie, and checks the ID token (JWKS signature, `iss`, `aud`, `azp`, `exp`, `iat`, `nonce`, RFC 9207 `iss` response parameter).

**Integration (settled by the spike):** `OidcService.finish()` would sign the user in through the package's `SignInService`, i.e. a **server-side session cookie**, while SlotWise uses **bearer access tokens + the `sw_refresh` cookie** and has no sessions. Its built-in _link_ flow needs a session too. So:

- Our `OidcAccountResolver` (`OidcProfileCapture`) never returns a user: it throws the verified profile back out (`VerifiedOidcProfile`), which `SocialSignInService.finish()` catches. The package's protocol checks have all run by then, and its session step is never reached.
- `SocialSignInService` applies the account rules below; the controller calls `AuthTokensService.signIn(principal, SignInMethod.OIDC, res)` like every other sign-in.
- The package still requires a `sessions` store in production for its OIDC feature: `NoSessionStore` holds nothing and fails loudly if anything tries to create a session.
- **Linking** uses our own one-time link intent (below), not the package's session-based link flow.

### Data model

```prisma
enum IdentityProvider {
  GOOGLE
  MICROSOFT
}

model CustomerIdentity {     // an external sign-in linked to a customer account; global, like CustomerAccount
  id         String           @id @default(uuid(7)) @db.Uuid
  accountId  String           @map("account_id") @db.Uuid      // FK customer_account, ON DELETE CASCADE
  provider   IdentityProvider
  subject    String                                           // the provider's stable `sub`; never link by email alone
  email      String?                                          // as the provider reported it at link time (lowercased), informational
  createdAt  DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  lastUsedAt DateTime?        @map("last_used_at") @db.Timestamptz(3)
  @@unique([provider, subject])
  @@unique([accountId, provider])                             // one Google and one Microsoft per account
  @@map("customer_identity")
}
```

- `CustomerAccount` gains the `identities CustomerIdentity[]` relation; nothing else changes. A social-only account has `passwordHash = null`, like a magic-link-only one.
- Not tenant-owned (no `tenant_id`, no RLS), same as `customer_account`.
- **Provider tokens are not stored**: we only need the identity, never call Google or Microsoft APIs afterwards.
- OIDC login state (`OidcStateStore`) and link intents live in **Redis** with a TTL (`SharedRedisModule`), not in PostgreSQL. `consumeOidcState()` must be an atomic `GETDEL`.

### Flows

**Sign in / sign up**

1. The web app sends the browser (top-level navigation, not `fetch`) to `GET /auth/customer/oidc/:provider/login?redirectTo=/book/glow-salon&tenantSlug=glow-salon` (public). `redirectTo` must be a relative path (the package drops anything else); `tenantSlug` is validated as in the magic-link flow and carried in `redirectTo`. → `302` to the provider.
2. The provider redirects to `GET /auth/customer/oidc/:provider/callback` (public), the URL registered with the provider: `${API_URL}/auth/customer/oidc/:provider/callback`.
3. The package verifies state, PKCE and the ID token, then calls our resolver with the profile `{ provider, subject, email, emailVerified }`. **Resolver rules, in order:**

   | Case                                                                                                                     | Result                                                                                                                                                                    |
   | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `(provider, subject)` is linked                                                                                          | Sign in that account; update `lastUsedAt`.                                                                                                                                |
   | Not linked, **provider verified the email**, an account with that email exists **and** has `emailVerifiedAt`             | Link to it, sign in. (Both sides proved the address, so this is safe.)                                                                                                    |
   | Not linked, provider verified the email, the account has **another identity of the same provider** linked                | Refuse: `PROVIDER_ALREADY_LINKED` (one Google and one Microsoft per account).                                                                                             |
   | Not linked, provider verified the email, the account exists, is **not verified**, has **no password and nothing linked** | Claim it: mark the email verified and link, in one transaction. Such a row is an unclaimed shell (a magic link was requested but never opened): nobody can sign in to it. |
   | Not linked, provider verified the email, the account exists but is **not verified** and has a password or a link         | Refuse: `ACCOUNT_LINK_REQUIRED`. The customer signs in with a magic link (which verifies the email) and links from their account. Prevents account pre-hijacking.         |
   | Not linked, provider verified the email, **no account** with that email                                                  | Create `CustomerAccount` (`emailVerifiedAt = now()`) + `CustomerIdentity` in one transaction, sign in.                                                                    |
   | Not linked, provider **did not verify** the email (or sent none)                                                         | Never link or create by that email. Refuse with `EMAIL_NOT_VERIFIED`: the customer uses a magic link and links the provider from their account.                           |

   Creation must be race-safe: rely on the unique constraints (`customer_account.email`, `(provider, subject)`) and map `P2002` to a retry of the lookup, not check-then-insert.

4. On success the handler issues our tokens (`AuthTokensService.signIn`, `amr: ['oidc']`), which sets the `sw_refresh` cookie, and redirects to `${APP_URL}/auth/social/callback?redirectTo=…`. The web app then calls `POST /auth/refresh` to get its access token. **No token ever appears in a URL.** On failure it redirects to `${APP_URL}/auth/social/callback?error=<CODE>` (never a JSON error page in the browser).

**Link a provider (signed-in customer)**

1. `POST /me/identities/:provider/link` (bearer, `@CustomerOnly()`) → `200 { url }`, where `url` is `/auth/customer/oidc/:provider/login?intent=<token>`. The intent is 32 random bytes, stored hashed in Redis with the account id, **single use, 5 min**.
2. The browser navigates to that URL; the login route spends the intent and stores the account id with the login's context in Redis, keyed by the login's `state` (which the package binds to this browser with its `__Host-oidc_tx` cookie).
3. On callback, in link mode: if `(provider, subject)` already belongs to **another** account → `IDENTITY_IN_USE`; if it is this account's → no-op; otherwise insert the identity. No sign-in happens and the existing tokens stay valid. Redirect to `${APP_URL}/account/sign-in-methods?linked=<provider>` (or `?error=…`).

The email the provider reports does **not** have to match the account's email when linking: the customer proved both sides (signed in + provider login).

**List and unlink**

- `GET /me/identities` (customer) → `[{ provider, email, createdAt, lastUsedAt }]`.
- `DELETE /me/identities/:provider` (customer) → `204` (`404` if that provider isn't linked). Always allowed: every customer can still sign in with a magic link to their account email, so unlinking can never lock them out.

**Discovery for the UI:** `GET /auth/customer/oidc/providers` (public) → `{ providers: ['google', 'microsoft'] }` (only the enabled ones).

**Interaction with v1 rules**

- `POST /me/password` "fresh session" rule: a social sign-in ≤ 15 min old counts like a fresh magic-link sign-in (the provider re-authenticated the person).
- Password reset, refresh, logout, reuse detection: unchanged.
- `GET /me` for a customer adds `identities: ['google']` (provider names only).

### Token claims

Unchanged shape. `amr` gains one value: `SignInMethod.OIDC = 'oidc'` (`auth.types.ts`). Which provider was used is not put in the token; it isn't needed for authorization.

### Errors

New `ErrorCode`s (redirect `error=` values on browser routes, envelope codes on API routes): `ACCOUNT_LINK_REQUIRED`, `EMAIL_NOT_VERIFIED`, `IDENTITY_IN_USE`, `PROVIDER_ALREADY_LINKED`, `SOCIAL_SIGN_IN_FAILED` (state mismatch, expired login, provider error, bad ID token, user cancelled). The browser never sees provider error details; they're logged with the request id.

### Configuration

| Variable                  | Purpose                                                                                       | Default                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `API_URL`                 | Public base URL of this API; builds the callback URL registered with providers                | `http://localhost:3000`                                                               |
| `GOOGLE_CLIENT_ID`        | Google OAuth client (Google Cloud console → Credentials → OAuth client ID, "Web application") | unset (Google disabled)                                                               |
| `GOOGLE_CLIENT_SECRET`    | Its secret                                                                                    | unset                                                                                 |
| `MICROSOFT_CLIENT_ID`     | Entra app registration (supported account types: personal Microsoft accounts)                 | unset (Microsoft disabled)                                                            |
| `MICROSOFT_CLIENT_SECRET` | Its client secret                                                                             | unset                                                                                 |
| `MICROSOFT_TENANT_ID`     | Tenant GUID for the preset                                                                    | unset (Microsoft disabled); personal accounts: `9188040d-6c67-4c5b-b112-36a304b66dad` |

A provider's settings must be set together (Google: id + secret; Microsoft: id + secret + tenant); env validation lists the missing ones otherwise. Add them to `envSchema`, `.env.example` and the table in `docs/architecture.md`. Redirect URIs to register: `${API_URL}/auth/customer/oidc/google/callback` and `…/microsoft/callback` (dev: `http://localhost:3000/…`).

### Security rules

- Identities are matched by `(provider, subject)` only; email is used to **link** only when both the provider and our record verified it (see table above).
- Customer-only: the resolver can only return a `CustomerAccount`; a staff email that also exists as `User` is unaffected (separate tables, as in v1).
- `@Throttle` on `/login`, `/callback` and the link endpoint (`AUTH_THROTTLE_LIMIT` per IP).
- Requested scopes: `openid email profile`. Prompt: `select_account`, so a shared computer doesn't silently reuse the last account.
- Redact `code`, `state`, `id_token`, `intent` in logs (add to the pino redaction list).
- Callback and login responses are `Cache-Control: no-store` (the package sets it).
- `sw_refresh` is set on a response the browser reaches via a cross-site redirect chain; that's fine (`SameSite` restricts _sending_, not setting) and the follow-up `POST /auth/refresh` from the web app is same-site, like today.

### Acceptance criteria / tests

- A new customer signs in with Google → one `CustomerAccount` (email verified) + one `CustomerIdentity`; signing in again reuses them.
- A verified existing customer (magic link) signing in with Google on the same email is linked, not duplicated.
- An existing **unverified** account with that email is **not** linked → `ACCOUNT_LINK_REQUIRED`.
- A provider profile with an unverified email never creates or links an account → `EMAIL_NOT_VERIFIED`.
- Linking an identity owned by another account → `IDENTITY_IN_USE`; link intents can't be reused or used after 5 min.
- Unlink removes the identity; the customer can still sign in by magic link.
- Tampered `state`, a callback from another browser (no tx cookie), a replayed callback, a wrong `nonce` / `aud` / `iss` → `SOCIAL_SIGN_IN_FAILED`, no account created.
- A disabled provider → 404 and absent from `/providers`.
- Staff cannot use these routes to get a staff token; a social-sign-in token is rejected on `@StaffOnly()` routes.
- No access or refresh token in any redirect URL.
- **Test setup:** e2e runs against a fake OIDC provider (discovery, JWKS, token endpoint) injected through the package's `fetch` option, with keys generated in the test; no real Google/Microsoft calls in CI.

### Follow-ups / open questions

- **Answered:** the package sets `emailVerified` only from an `email_verified: true` claim, and Microsoft ID tokens don't carry one. So Microsoft can **link** from a signed-in account and then sign in, but a first Microsoft sign-in without a link answers `EMAIL_NOT_VERIFIED` (no sign-up, no auto-link by email). The UI should offer "Continue with Microsoft" as "sign in with an email link first, then connect Microsoft". Revisit if we decide to trust Microsoft's `email` for personal accounts (or its `xms_edov` claim).
- Work/school Microsoft accounts (multi-tenant) need per-token issuer validation against `tid`: revisit if the package adds it.
- F09 audit is per tenant; customer identity changes are global, so they're logged (and could go to a future account-security log), not audited.
- Apple sign-in (iOS) is not in scope.

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

## Implementation summary (v2)

**Completed:** 2026-11-24 · **Branch:** `main` (not yet committed at time of writing)

### What was built

| Item                                                                    | Status | Where                                                                        | Notes                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in / sign-up (customers)                                    | ✅     | `social/social-providers.ts`, `social/social-sign-in.service.ts`             | Package `google()` preset, `prompt=select_account`.                                                                                                                             |
| Microsoft sign-in (personal accounts)                                   | ✅     | same                                                                         | `microsoft({ tenant })` with `MICROSOFT_TENANT_ID` (required with id + secret, no default). Link-then-sign-in only: Microsoft doesn't assert `email_verified` (see follow-ups). |
| Provider on only with id + secret; 404 otherwise                        | ✅     | `social-providers.ts`, `env.ts`                                              | Env refuses one without the other.                                                                                                                                              |
| `CustomerIdentity` table                                                | ✅     | `prisma/schema.prisma`, migration `20261124101747_add_customer_identity`     | Unique `(provider, subject)` and `(account_id, provider)`; cascade on account delete. No provider tokens stored.                                                                |
| `GET /auth/customer/oidc/:provider/login` / `/callback`                 | ✅     | `social/social-auth.controller.ts`                                           | Redirects only; `Cache-Control: no-store`; per-IP throttle. Callback clears `__Host-oidc_tx`.                                                                                   |
| `GET /auth/customer/oidc/providers`                                     | ✅     | same                                                                         |                                                                                                                                                                                 |
| Resolver rules (linked / join verified / claim shell / create / refuse) | ✅     | `SocialSignInService.signIn()`                                               | Race-safe: one retry on `P2002`.                                                                                                                                                |
| Tokens via `AuthTokensService.signIn`, `amr: ['oidc']`, none in URLs    | ✅     | `social-auth.controller.ts`, `auth-tokens.service.ts`, `auth.types.ts`       | Web app gets the access token from `POST /auth/refresh`.                                                                                                                        |
| Link: `POST /me/identities/:provider/link` + one-time intent            | ✅     | `me.controller.ts`, `SocialSignInService.createLinkIntent()` / `startLink()` | 32-byte intent, SHA-256 in Redis, 5 min, single use, bound to account + provider.                                                                                               |
| `GET /me/identities`, `DELETE /me/identities/:provider`                 | ✅     | `me.controller.ts`                                                           | `@CustomerOnly()`.                                                                                                                                                              |
| `GET /me` lists `identities` for customers                              | ✅     | `me.controller.ts`                                                           |                                                                                                                                                                                 |
| Fresh social sign-in may set the first password                         | ✅     | `isFreshPasswordlessSignIn()` in `customer-auth.service.ts`                  | Renamed from `isFreshEmailSignIn`.                                                                                                                                              |
| OIDC login state in Redis (atomic GETDEL)                               | ✅     | `social/redis-oidc-state.store.ts`                                           | Registered as the package's `oidcStates` store.                                                                                                                                 |
| Login context and link intents in Redis                                 | ✅     | `SocialSignInService`                                                        | Context keyed by `state`, read destructively only after the package verified `state` against this browser's cookie.                                                             |
| Error codes                                                             | ✅     | `domain-error.ts`                                                            | `SOCIAL_SIGN_IN_FAILED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_LINK_REQUIRED`, `IDENTITY_IN_USE`, `PROVIDER_ALREADY_LINKED`.                                                           |
| Redact `code`, `state`, `intent` in logs                                | ✅     | `redactUrl()` in `logger.module.ts`                                          | Applied to the request-line URL. `id_token` never appears in a URL with the code flow; redacted anyway.                                                                         |

### Decisions that differ from the spec

- **No package session at all** (instead of "discard the package session afterwards"): the resolver throws the verified profile out of `OidcService.finish()`, so the package never creates a session; `NoSessionStore` satisfies its production storage check. Simpler and nothing to clean up.
- **Link mode is carried in Redis, keyed by the login's `state`**, instead of a separate cookie: `state` is already bound to the browser by the package's `__Host-oidc_tx` cookie.
- **Unclaimed shell accounts can be claimed**: an unverified account with no password and nothing linked (someone typed the email into the magic-link form) is joined, not refused, since nobody can sign in to it. Unverified accounts with a password or a link still answer `ACCOUNT_LINK_REQUIRED`.
- **`PROVIDER_ALREADY_LINKED`** added: an account can hold one identity per provider.
- **Unlink of a provider that isn't linked is `404`.**
- **`MICROSOFT_TENANT_ID` has no default** (changed after v2 was first built): Microsoft is enabled only when the client id, secret and tenant id are all set, so a deployment always states which Microsoft accounts it accepts (personal accounts `9188040d-…`, or one organisation's tenant). A partly set group fails env validation.
- Provider names in routes and responses are lowercase (`google`, `microsoft`); the database enum is `IdentityProvider` (`GOOGLE`, `MICROSOFT`).

### New scripts, env vars and dependencies

- Env: `API_URL` (`http://localhost:3000`), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` (optional; Google as a pair, Microsoft as a group of three; the tenant is a GUID with no default). In `.env.example` and `docs/architecture.md`.
- Migration `20261124101747_add_customer_identity`.
- No new dependencies (OIDC is part of `@nestjs/authentication`).
- Provider setup: register `${API_URL}/auth/customer/oidc/google/callback` (Google Cloud console, OAuth client "Web application") and `…/microsoft/callback` (Entra app registration, "Personal Microsoft accounts only", Web platform).

### Tests

- Unit: `social/social-providers.spec.ts` (enabled providers, presets, callback URL), `env.spec.ts` (+3: defaults, id/secret pairing, tenant GUID), `customer-auth.service.spec.ts` (+1: fresh OIDC sign-in), `logger.module.spec.ts` (`redactUrl`).
- E2E: `test/social-auth.e2e-spec.ts` (16 cases) against `test/support/fake-oidc-provider.ts`, a fake Google (discovery, JWKS, token endpoint through a stubbed `fetch`, RS256 ID tokens signed with a test key).
- Also checked by hand: a production build (`NODE_ENV=production`) with Google enabled starts, registers `NoSessionStore` / `PrismaRefreshTokenStore` / `RedisOidcStateStore`, and its login route redirects to the real Google authorization endpoint with the `__Host-oidc_tx` cookie.
- Final counts: **unit 152 passed** (26 files), **e2e 112 passed** (11 files). Lint, format, typecheck and build clean.

### Acceptance criteria

| Criterion                                                                        | Status | How verified                                                                                                     |
| -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| New customer via Google → one verified account + one identity; reused next time  | ✅     | e2e "creates a verified account on first sign-in, then reuses it".                                               |
| Verified existing customer with same email is linked, not duplicated             | ✅     | e2e "joins an existing verified account…".                                                                       |
| Existing unverified account (with password) not linked → `ACCOUNT_LINK_REQUIRED` | ✅     | e2e; unused shell accounts are claimed instead (e2e "claims an unverified, unused account").                     |
| Unverified provider email never creates or links → `EMAIL_NOT_VERIFIED`          | ✅     | e2e.                                                                                                             |
| Identity of another account → `IDENTITY_IN_USE`; intents single use, 5 min       | ✅     | e2e "refuses an identity that belongs to another account", "spends a link intent once". Expiry is the Redis TTL. |
| Unlink removes it; magic link still works                                        | ✅     | e2e link/list/unlink case; magic link is unaffected (v1 e2e).                                                    |
| Tampered state, other browser, replay, wrong nonce → `SOCIAL_SIGN_IN_FAILED`     | ✅     | e2e "protocol checks" (4 cases). `aud` / `iss` checks are the package's (`OidcClient.verifyIdToken`).            |
| Disabled provider → 404 and absent from `/providers`                             | ✅     | e2e.                                                                                                             |
| Staff can't use it; social token rejected on staff routes                        | ✅     | e2e "is customer-only"; tokens carry `kind: 'customer'`, which `@StaffOnly()` rejects (v1 guard tests).          |
| No access or refresh token in any redirect URL                                   | ✅     | e2e asserts the landing URL.                                                                                     |
| Real Google / Microsoft sign-in                                                  | ⏳     | Needs client credentials; the redirect to Google was checked with dummy credentials (production build).          |

### Follow-ups for later features

- **Microsoft sign-up:** decide whether to trust Microsoft's `email` for personal accounts (or require the `xms_edov` optional claim); until then Microsoft is link-then-sign-in.
- Work/school Microsoft accounts (multi-tenant `tid` issuer validation) if the package adds it.
- Account-security log for identity link/unlink (not tenant-scoped, so not F09's audit log).
- **F03:** the customer subject is unchanged; no policy may depend on the sign-in method.
