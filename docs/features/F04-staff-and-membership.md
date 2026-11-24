# F04 — Team Members & Staff

**Phase:** 1 · **Modules:** 1.10 · **Depends on:** F01, F02

**Status:** ✅ Completed — **v1** (2026-11-24) · [Implementation summary](#implementation-summary-v1)

## Goal

Once the Owner has signed in (created by the platform admin in F01), they build their team: **add Managers, Receptionists and Staff**, each of whom gets an email to set their own password and then signs in. Bookable staff are modelled separately from logins.

## Who can add whom

| Actor                | Can add                              | Can change role / remove     |
| -------------------- | ------------------------------------ | ---------------------------- |
| Platform admin       | Owner only (at tenant creation, F01) | Pending Owner only (F01)     |
| Owner                | Manager, Receptionist, Staff         | Manager, Receptionist, Staff |
| Manager              | Receptionist, Staff                  | Receptionist, Staff          |
| Receptionist / Staff | —                                    | —                            |

Nobody can add a second Owner; ownership moves only through transfer (F03). The Manager column follows the role definition ("runs staff"); drop it if only the Owner should manage the team.

## Data model

```prisma
enum MemberRole { OWNER MANAGER RECEPTIONIST STAFF }

model Membership {
  id        String     @id @default(uuid(7)) @db.Uuid
  tenantId  String     @map("tenant_id") @db.Uuid
  userId    String     @map("user_id") @db.Uuid
  role      MemberRole
  staffId   String?    @unique @map("staff_id") @db.Uuid  // set when this member is also bookable
  status    String     @default("ACTIVE")                  // ACTIVE | REMOVED
  createdBy String?    @map("created_by") @db.Uuid
  createdAt DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([tenantId, userId])
  @@map("membership")
}

model Staff {                 // a bookable calendar
  id          String   @id @default(uuid(7)) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  displayName String   @map("display_name")
  active      Boolean  @default(true)
  @@index([tenantId, active])
  @@map("staff")
}
```

- Exactly one `OWNER` per tenant: `CREATE UNIQUE INDEX ON membership (tenant_id) WHERE role = 'OWNER' AND status = 'ACTIVE'` (custom SQL in the migration).
- A member with role `STAFF` always has a `Staff` row. Owners, Managers and Receptionists can optionally be bookable too (`bookable: true` creates/links a `Staff` row).
- Password setup uses `User` (`PENDING_SETUP`) + `AccountSetupToken` from F02 — no separate invitation table.

## Add a member

`POST /members`

```json
{
  "email": "maya@glow.example",
  "name": "Maya Rao",
  "role": "STAFF",
  "bookable": true
}
```

One transaction:

1. Check the actor may add this role (table above) → else 403.
2. Find `User` by lowercased email:
   - **New email** → create `User` (`PENDING_SETUP`, no password) + `AccountSetupToken` (`SETUP`, 72 h).
   - **Existing staff-side user** (works at another business) → reuse it, no token.
   - **Platform admin email** → 422.
3. Already a member of this tenant → 409 `ALREADY_MEMBER`.
4. Create `Membership` (+ `Staff` row when `role = STAFF` or `bookable`).
5. Audit `membership.created`.
6. After commit, enqueue email: `member-welcome` with the set-password link for new users, `member-added` ("you've been added to Glow Salon") for existing ones. `jobId = member-welcome-${membershipId}`.

Response `201 { member: { id, userId, email, name, role, staffId, status: "PENDING_SETUP" | "ACTIVE" } }`.

The new member opens the link → `POST /auth/account-setup` (F02) → signs in and lands in this business with their role.

## API

| Method | Path                        | Who                                                   | Notes                                                                                                                                  |
| ------ | --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/members`                  | Owner, Manager (per table)                            | Add member (above).                                                                                                                    |
| GET    | `/members?role=&status=`    | Owner, Manager                                        | Includes setup status (pending / active).                                                                                              |
| PATCH  | `/members/:id`              | Owner, Manager (per table)                            | Change role (not to/from OWNER), toggle `bookable`.                                                                                    |
| DELETE | `/members/:id`              | Owner, Manager (per table)                            | Sets `status = REMOVED`; the user's access to this tenant ends on the next request. Their `Staff` calendar is deactivated (see below). |
| POST   | `/members/:id/resend-setup` | Owner, Manager (per table)                            | New setup link for a `PENDING_SETUP` user; old link invalidated. 409 if already active.                                                |
| GET    | `/staff`                    | Any member                                            | Bookable calendars.                                                                                                                    |
| PATCH  | `/staff/:id`                | Owner, Manager; the staff member for own display name |                                                                                                                                        |

## Rules

- The Owner can't remove or demote themself; use ownership transfer (F03).
- Removing a member or deactivating a calendar with future `CONFIRMED` bookings → 409 `STAFF_HAS_FUTURE_BOOKINGS` listing them; reassign or cancel first.
- There is no per-staff timezone; working hours are stored in UTC (F05) and the frontend shows them in local time.
- Removing a member doesn't delete the `User`; it may still belong to other businesses.
- Role changes and removals are audited with before/after role.
- `@Throttle` on `POST /members` and `resend-setup` (e.g. 20/hour per tenant) to stop the endpoint being used to spam emails.

## Acceptance criteria

- E2E full chain: seeded platform admin creates "Glow Salon" + Owner → Owner sets password → Owner adds a Manager, a Receptionist and a Staff member → each receives a setup email, sets a password and signs in → `GET /me` shows the right role for Glow Salon.
- Manager adding a Manager → 403; Receptionist adding anyone → 403; anyone adding an `OWNER` via `/members` → 422.
- Adding an email that's already a member → 409; adding a user who works at another business → no setup email, membership created, `member-added` email sent.
- Removed member's next request to this tenant → 403; their other businesses still work.
- Deactivated staff disappear from public availability immediately (cache invalidated, F16).

## Implementation summary (v1)

### What was built

| Item                                                                                        | Status | Where                                                        | Notes                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Staff` model + `Membership.staffId`                                                        | ✅     | `prisma/schema.prisma`, migration `20261124100000_add_staff` | `staff` has RLS (`tenant_isolation`), `createdAt`/`updatedAt`; `staff_id` unique FK. `MembershipStatus` is an enum (F01).                                     |
| One active Owner per tenant (partial unique index)                                          | ✅     | F01 migration `add_tenancy`                                  | Already created with onboarding.                                                                                                                              |
| STAFF always has a calendar; other roles via `bookable`                                     | ✅     | `team/members.service.ts`                                    | `bookable: false` with STAFF → 422 `STAFF_MUST_BE_BOOKABLE`.                                                                                                  |
| Role table (who adds/changes/removes whom)                                                  | ✅     | `team/team-roles.ts`                                         | Pure function, unit-tested; F03 turns it into a policy.                                                                                                       |
| `POST /members` (one tx: user, membership, calendar, setup link, audit; email after commit) | ✅     | `members.controller.ts`, `members.service.ts`                | New email → `member-welcome`; existing staff user → `member-added`, no token; platform admin → 422; already a member → 409 `ALREADY_MEMBER`.                  |
| `GET /members?role=&status=`                                                                | ✅     |                                                              | `status`: `ACTIVE` / `PENDING_SETUP` (user setup status) or `REMOVED`; default = not removed. Response `{ items }`.                                           |
| `PATCH /members/:id`                                                                        | ✅     |                                                              | Role (never to/from OWNER → 422) and `bookable`; audited `membership.updated` with before/after role and bookable.                                            |
| `DELETE /members/:id`                                                                       | ✅     |                                                              | 204; membership `REMOVED`, calendar deactivated, audited `membership.removed`; next request → 403 `NOT_A_MEMBER` (TenantGuard reads memberships per request). |
| `POST /members/:id/resend-setup`                                                            | ✅     |                                                              | 202; old link invalidated; 409 `MEMBER_ALREADY_ACTIVE`.                                                                                                       |
| `GET /staff` (any member)                                                                   | ✅     | `staff.controller.ts`, `staff.service.ts`                    | `?active=false` lists paused calendars.                                                                                                                       |
| `PATCH /staff/:id`                                                                          | ✅     |                                                              | Owner/Manager: `displayName`, `active`; the member: own `displayName` only. Audited `staff.updated`.                                                          |
| Owner can't remove/demote themself                                                          | ✅     |                                                              | 422 `OWNERSHIP_TRANSFER_REQUIRED`.                                                                                                                            |
| Future `CONFIRMED` bookings block removal/deactivation (409 `STAFF_HAS_FUTURE_BOOKINGS`)    | ⏭️     | marked in `members.service.ts`, `staff.service.ts`           | No bookings until F07.                                                                                                                                        |
| Removing a member keeps the `User`                                                          | ✅     |                                                              | Other businesses keep working (e2e).                                                                                                                          |
| Throttle `POST /members` + resend-setup per tenant                                          | ✅     | `team/member-invite-limiter.ts`                              | Redis counter per tenant, `MEMBER_INVITE_LIMIT`/hour (default 20), fails open.                                                                                |
| `GET /me` shows role per business                                                           | ✅     | `auth/me.controller.ts`, `UsersRepository.findMemberships()` | `memberships: [{ tenantId, tenantName, tenantSlug, tenantStatus, role, staffId }]`.                                                                           |
| Public profile lists active calendars                                                       | ✅     | `tenancy/tenants.service.ts`                                 | `staff: [{ id, displayName }]` on `GET /public/:slug`.                                                                                                        |
| Availability cache invalidation on deactivate (F16)                                         | ⏭️     |                                                              | No cache yet; the public list reads the DB, so deactivation is immediate.                                                                                     |

### Decisions that differ from the spec

- **`@Throttle` replaced by a per-tenant Redis limiter.** The global `ThrottlerGuard` runs before `TenantGuard`, so it can't key on the tenant. `MemberInviteLimiter` counts add + resend per business per hour, shared by both endpoints (they both send invitation emails).
- **Adding OWNER → 422 `OWNERSHIP_TRANSFER_REQUIRED`** (one code for adding an Owner, changing a role to/from OWNER and removing the Owner). It is checked before the role table, so a Manager asking for OWNER also gets 422, as the acceptance criteria say.
- **Re-adding a removed member reactivates their membership** (same id, same calendar) instead of 409, because `(tenant_id, user_id)` is unique. Audited `membership.created` with reason "Removed member added again".
- **Email job ids** are `member-welcome-{membershipId}-{linkExpiryMs}` / `member-added-{membershipId}-{ms}` rather than `member-welcome-{membershipId}`: a re-added member and a resend reuse the membership id and must still get their email.
- **Removing a pending member doesn't revoke their setup link** (F01's replace-owner does): inside a tenant transaction RLS hides their other memberships, so we can't tell whether the link belongs to another business's invitation too. Completing setup afterwards gives an account with no access to this business.
- **Disabled users can't be added** (422 `MEMBER_DISABLED`), matching F01's `OWNER_DISABLED`.
- **The calendar is named as the adding business typed it** (`dto.name`); an existing user's global `name` isn't changed.
- **`bookable` is "has an active calendar"**: `PATCH /members bookable:false` and `PATCH /staff active:false` both deactivate the same `Staff` row; a STAFF member's calendar can be paused through `/staff` but not via `bookable:false`.
- **`GET /members` is Owner/Manager** (as this spec says; F03's table lists any member — revisit in F03).
- **Roles still checked by `TenantGuard` + `team-roles.ts`** until F03 brings `@nestjs/authorization`.

### New scripts, env vars and dependencies

- Env: `MEMBER_INVITE_LIMIT` (default `20`), in `.env.example` and `docs/architecture.md`.
- Migration `20261124100000_add_staff`.
- Mails: `member-welcome`, `member-added` (templates in `src/shared/mail/templates/`).
- Error codes: `ALREADY_MEMBER`, `OWNERSHIP_TRANSFER_REQUIRED`, `MEMBER_IS_PLATFORM_ADMIN`, `MEMBER_DISABLED`, `MEMBER_ALREADY_ACTIVE`, `STAFF_MUST_BE_BOOKABLE`.
- No new dependencies.

### Tests

- Unit: `team/team-roles.spec.ts` (role table), `team/member-invite-limiter.spec.ts` (limit, per tenant, fails open).
- E2E: `test/team.e2e-spec.ts` (17 cases); `test/tenancy.e2e-spec.ts` public profile now includes `staff`.
- Final counts: **unit 143 passed** (24 files), **e2e 96 passed** (10 files). Format, lint, typecheck, build clean; `migrate diff` shows no drift.

### Acceptance criteria

| Criterion                                                                                                                                                                                    | Status  | How verified                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Full chain: admin creates Glow Salon + Owner → Owner sets password → adds Manager, Receptionist, Staff → each gets a setup email, sets a password, signs in → `GET /me` shows the right role | ✅      | e2e "full chain…"                                                                                                                             |
| Manager adding a Manager → 403; Receptionist adding anyone → 403; anyone adding OWNER → 422                                                                                                  | ✅      | e2e "who can add whom" (Staff → 403 too)                                                                                                      |
| Already-member email → 409; user from another business → no setup email, membership created, `member-added` sent                                                                             | ✅      | e2e "adding existing people"                                                                                                                  |
| Removed member's next request → 403; other businesses still work                                                                                                                             | ✅      | e2e "ends the member's access…"                                                                                                               |
| Deactivated staff disappear from public availability immediately (cache invalidated, F16)                                                                                                    | ✅ / ⏳ | e2e: gone from `GET /public/:slug` right after deactivation and after removal. Cache invalidation waits for F16; availability search for F06. |

### Follow-ups for later features

- **F03:** move `team-roles.ts` and the `/staff/:id` own-calendar rule into `@nestjs/authorization` policies; ownership transfer; decide whether `GET /members` is open to every member; put `staffId` on the subject.
- **F05/F06:** use `staff.active` for working hours and availability.
- **F07:** 409 `STAFF_HAS_FUTURE_BOOKINGS` on removal / `bookable:false` / `active:false` (spots marked in the services).
- **F13:** send member emails through the outbox instead of after-commit enqueue.
- **F16:** invalidate availability cache when a calendar is deactivated or renamed.
