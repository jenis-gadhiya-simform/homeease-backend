# F02 — Authentication

**Phase:** 1 · **Modules:** security groundwork for 1.10 · **Depends on:** F00

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
