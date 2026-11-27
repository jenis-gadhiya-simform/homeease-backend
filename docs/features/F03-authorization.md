# F03 — Authorization (RBAC and ABAC)

**Phase:** 1 · **Modules:** 1.10 Authorization · **Depends on:** F01, F02, F04

**Status:** 🚧 In progress — **v1** (2026-11-25): framework, RBAC on every existing route, member/staff/ownership policies · [Implementation summary](#implementation-summary-v1)

## Goal

Decide **who can do what**, centrally, with `@nestjs/authorization`, never with scattered `if (role === ...)` checks. SlotWise uses **two authorization styles, and each endpoint uses exactly one of them**:

| Style                      | Use it when                                                                                                               | Decided from                                         | Declared with                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| **RBAC** (role-based)      | The answer depends **only on who you are**: the role alone decides, whatever record is involved.                          | Subject's role                                       | `@Roles(...)`                      |
| **ABAC** (attribute-based) | The answer depends **on the record and the situation**: who owns it, its status, the time, the amount, the target's role. | Attributes of subject, resource, action, environment | `@Policy(BookingPolicy, 'cancel')` |

Rule of thumb: if two people with the **same role** could get **different answers** for the same endpoint, it's ABAC. Otherwise it's RBAC.

Tenant isolation (F01: `tenant_id` + RLS) and authentication apply to every endpoint regardless of style; they aren't part of this choice.

## Subject

Built by a guard after authentication and stored in `RequestContext`:

```ts
type Subject =
  | {
      kind: 'staff';
      userId: string;
      tenantId: string;
      role: MemberRole;
      staffId?: string;
    }
  | { kind: 'customer'; accountId: string }
  | {
      kind: 'platform';
      userId: string;
      breakGlass?: { tenantId: string; expiresAt: Date };
    };
```

How a customer signed in (magic link, password, Google, Microsoft — [F02 v2](./F02-authentication.md#v2--social-sign-in-for-customers-google-microsoft)) does not change the subject: it is always the `CustomerAccount` id, and no policy may depend on the sign-in method.

Role and membership come from the database on each request (cached ≤ 60 s), never from the token, so removing a member works immediately.

## Endpoint classification

### RBAC endpoints — role alone decides

| Endpoint(s)                                             | Allowed roles                                    | Why RBAC is enough                               |
| ------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `POST/GET /admin/tenants`, `/admin/tenants/:id/*`       | Platform admin                                   | Only platform admins, for any tenant.            |
| `/admin/jobs/*`, `/admin/webhooks/*`, `/admin/system`   | Platform admin                                   | Same answer for every record.                    |
| `PATCH /tenants/current`                                | Owner, Manager                                   | Only one tenant (their own, via tenant context). |
| `PUT /tenants/current/deposit-policy`, billing settings | Owner                                            | Owner-only setting.                              |
| `/services` (create, update, delete)                    | Owner, Manager                                   | Any service in the tenant, same rule.            |
| `PUT /staff/:id/services`                               | Owner, Manager                                   |                                                  |
| `/holidays` (create, update, delete)                    | Owner, Manager                                   | Business-wide.                                   |
| `GET /customers`, `GET /customers?q=` (search)          | Owner, Manager, Receptionist                     | Every customer of the tenant.                    |
| `GET /audit`                                            | Owner, Manager                                   | Whole tenant log.                                |
| `/webhook-endpoints/*`, `/webhook-deliveries/*`         | Owner, Manager                                   | Tenant-wide config.                              |
| `POST /reports/revenue`, `GET /reports/:id/download`    | Owner, Manager                                   | Tenant-wide reports.                             |
| `GET /members`, `GET /staff`, `GET /tenants/current`    | any member (Owner, Manager, Receptionist, Staff) | Read-only, same for every member.                |

```ts
@Roles('OWNER', 'MANAGER')
@Post('/services')
create(@Body({ schema: createServiceSchema }) body: CreateServiceDto) { ... }
```

`RolesGuard` reads the subject's role and compares it with the list: **no database read for the resource, no policy class.** Wrong role → `403 FORBIDDEN`.

#### RBAC role map (summary)

| Capability                                  | Owner | Manager | Receptionist | Staff | Platform admin |
| ------------------------------------------- | :---: | :-----: | :----------: | :---: | :------------: |
| Create businesses + Owner, operate platform |   —   |    —    |      —       |   —   |       ✅       |
| Tenant profile                              |  ✅   |   ✅    |      —       |   —   |       —        |
| Billing / deposit policy                    |  ✅   |    —    |      —       |   —   |       —        |
| Services, staff services, holidays          |  ✅   |   ✅    |      —       |   —   |       —        |
| Customer list / search                      |  ✅   |   ✅    |      ✅      |   —   |       —        |
| Audit log, webhooks, revenue reports        |  ✅   |   ✅    |      —       |   —   |       —        |
| Read team & business profile                |  ✅   |   ✅    |      ✅      |  ✅   |       —        |

### ABAC endpoints — the record and situation decide

| Endpoint(s)                                                   | Policy                                     | Attributes that change the answer                                     |
| ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `GET /bookings`, `GET /bookings/:id`, `GET /bookings/history` | `BookingPolicy.read` / `.scope`            | role, `booking.staffId` vs `subject.staffId`                          |
| `POST /bookings` (staff side)                                 | `BookingPolicy.create`                     | role, target `staffId` (Staff only for own calendar)                  |
| `POST /bookings/:id/reschedule`, `/cancel`, `/complete`       | `BookingPolicy.reschedule/cancel/complete` | role, ownership, `status`, `startAt`/`endAt` vs `now`, tenant windows |
| `GET/POST /me/bookings/*` (customer)                          | `BookingPolicy` (customer branch)          | `booking.customerAccountId`, `status`, cancellation window            |
| `POST /me/bookings/:id/deposit`                               | `PaymentPolicy.pay`                        | ownership, `status = HELD`, hold not expired                          |
| `POST /bookings/:id/refund`                                   | `PaymentPolicy.refund`                     | role, `amountMinor − refundedMinor`, payment status                   |
| `POST /bookings/:id/waive-deposit`                            | `BookingPolicy.waiveDeposit`               | role, `status = HELD`                                                 |
| `GET/PUT /staff/:id/working-hours`, `/staff/:id/time-off`     | `SchedulePolicy.manage`                    | role, `staffId` vs `subject.staffId`                                  |
| `PATCH /staff/:id`                                            | `StaffPolicy.update`                       | role, own record (Staff may edit own display name only)               |
| `POST /members`, `PATCH/DELETE /members/:id`, `resend-setup`  | `MemberPolicy`                             | actor role rank vs target role                                        |
| `POST /tenants/current/transfer-ownership`                    | `TenantPolicy.transferOwnership`           | role = Owner, target is an active Manager, password re-entered        |
| `GET /customers/:id` (contact fields)                         | `CustomerPolicy.viewContact` (field-level) | role, relationship to customer's bookings                             |
| `GET /bookings/:id/files/:fileId`, uploads                    | `FilePolicy`                               | role, ownership, `file.kind`                                          |
| `GET /bookings/:id/history` (timeline)                        | `BookingPolicy.read`                       | same as booking read                                                  |
| `/admin/*` responses with customer data                       | `PlatformPiiPolicy` (field-level)          | active break-glass grant, its `tenantId` and `expiresAt`              |

```ts
@Policy(BookingPolicy, 'cancel')                 // loads the booking, evaluates the policy
@Post('/bookings/:id/cancel')
cancel(@Param('id') id: string, @Body({ schema: cancelSchema }) body: CancelDto) { ... }
```

`PolicyGuard` (or the service, for complex loads) fetches the record tenant-scoped and calls a pure function `(subject, resource, env) → Allow | Deny(code) | NotVisible`. Role is just **one attribute** among others here; there is no separate `@Roles` on these routes.

## ABAC attributes and rules

| Source          | Attributes                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subject**     | `kind`, `role`, role rank (`OWNER 4 > MANAGER 3 > RECEPTIONIST 2 > STAFF 1`), `staffId`, `accountId`, break-glass grant                     |
| **Resource**    | `tenantId`, `staffId`, `customerAccountId`, `status`, `startAt`, `endAt`, `amountMinor`, `refundedMinor`, file `kind`, target member `role` |
| **Environment** | `now` (UTC), tenant settings `cancellationWindowHours` (24), `staffEditPastHours` (24), tenant `status`                                     |

| #   | Rule                                                                                                                               | Policy                    | Fails with                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| A1  | **Own calendar:** Staff only on bookings/schedules where `staffId === subject.staffId`; Owner/Manager/Receptionist on any          | Booking, Schedule         | 404                                |
| A2  | **Own booking:** customer only where `customerAccountId === subject.accountId`                                                     | Booking, Payment, File    | 404                                |
| A3  | **Status:** only `HELD`/`CONFIRMED` can be rescheduled or cancelled; others are read-only                                          | Booking                   | 409 `BOOKING_NOT_MODIFIABLE`       |
| A4  | **Customer window:** cancel/reschedule only if `startAt − now ≥ cancellationWindowHours`                                           | Booking (customer)        | 403 `CANCELLATION_WINDOW_PASSED`   |
| A5  | **Past lock:** Staff/Receptionist can't change a booking that ended more than `staffEditPastHours` ago; Owner/Manager can          | Booking                   | 403 `PAST_BOOKING_LOCKED`          |
| A6  | **Pay only a live hold:** `status = HELD` and `holdExpiresAt > now`                                                                | Payment                   | 409 `HOLD_EXPIRED`                 |
| A7  | **Refund:** Owner/Manager only, amount ≤ `amountMinor − refundedMinor`, payment `SUCCEEDED`                                        | Payment                   | 403 / 422 `REFUND_EXCEEDS_PAYMENT` |
| A8  | **Role rank:** add/change/remove a member only if `rank(actor) > rank(target)`; never `OWNER`                                      | Member                    | 403 `ROLE_RANK_TOO_LOW`            |
| A9  | **Contact fields:** phone/email shown to Owner/Manager/Receptionist, to Staff only on their own bookings, to the customer themself | Customer (field-level)    | fields omitted                     |
| A10 | **ID documents:** `kind = ID_DOCUMENT` only for Owner/Manager/Receptionist and the uploading customer                              | File                      | 404                                |
| A11 | **Platform PII:** masked unless break-glass grant matches `tenantId` and `now < expiresAt`                                         | PlatformPii (field-level) | values masked                      |
| A12 | **Suspended tenant:** no writes when `tenant.status = SUSPENDED`                                                                   | all write policies        | 403 `TENANT_SUSPENDED`             |

404 vs 403: if the subject shouldn't know the record exists (A1, A2, A10) → 404. If they can see it but the action isn't allowed now → 403/409/422 with a stable `code` the frontend can explain.

### ABAC on lists

Lists never filter after loading (breaks pagination, leaks counts). The policy turns its rules into a Prisma `where`:

```ts
BookingPolicy.scope(subject):
  OWNER | MANAGER | RECEPTIONIST → { tenantId }
  STAFF                          → { tenantId, staffId: subject.staffId }
  customer                       → { customerAccountId: subject.accountId }
```

### ABAC on fields

Serializers (`CustomerView`, `BookingView`) apply A9 and A11 after the handler, so the same endpoint shows contact details to a Receptionist, omits them for Staff on another member's booking, and masks them for platform admins.

## Implementation layout

```
src/modules/authorization/
├── roles.decorator.ts        # @Roles(...)
├── roles.guard.ts            # RBAC: compare subject.role, no resource load
├── policy.decorator.ts       # @Policy(PolicyClass, action)
├── policy.guard.ts           # ABAC: load resource, evaluate, map Deny/NotVisible to HTTP
├── subject.ts                # Subject type + builder guard
└── policies/
    ├── booking.policy.ts     # read, scope, create, reschedule, cancel, complete, waiveDeposit
    ├── payment.policy.ts
    ├── schedule.policy.ts
    ├── member.policy.ts
    ├── customer.policy.ts    # field-level contact visibility
    ├── file.policy.ts
    └── platform-pii.policy.ts
```

- **Deny by default:** at startup, every route must have exactly one of `@Public()`, `@Roles()` or `@Policy()`. A route with none, or with both `@Roles` and `@Policy`, fails the check.
- Policies are pure functions, so they're unit-tested without HTTP or a database.

## Acceptance criteria / tests

**RBAC**

- Table-driven e2e: for every RBAC endpoint, each role gets 2xx or 403 as listed.
- RBAC endpoints never load the target record before deciding (asserted by spying on the repository in a unit test).

**ABAC**

- Unit tests per policy: every rule A1–A12 has allow and deny cases with a fixed `now`.
- Two Staff members, same role: Staff A reads/edits own booking → 200; Staff B on the same booking → 404. (Same role, different answer: the defining ABAC case.)
- Customer cancels 25 h before start → 200; 23 h before → 403 `CANCELLATION_WINDOW_PASSED`; a Receptionist can still cancel it.
- Manager removes a Receptionist → 200; removes another Manager → 403 `ROLE_RANK_TOO_LOW`.
- Staff downloads an intake form on own booking → 200; an ID document on own booking → 404.
- Platform admin sees masked PII; with an active break-glass grant → unmasked; after expiry → masked.

**Both**

- Startup check fails for a route with no authorization decorator or with both.
- Removing a membership takes effect on the next request.

## Implementation summary (v1)

v1 builds the authorization framework and applies it to **every route that exists today** (F01, F02, F04, F15). The booking, payment, schedule, customer, file and platform-PII policies need endpoints that don't exist yet; each lands with its feature (F05, F07, F08, F10, F18, F19), on this framework.

### What was built

| Item                                                                                                                                                      | Status       | Where                                                                                          | Notes                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/authorization` (global guard, deny by default)                                                                                                   | ✅           | `authorization/authorization.module.ts` (`AuthzModule`), `app.module.ts`                       | After `AuthModule` and `RateLimitModule`. `getUser` = `SubjectResolver`. Denials logged with policy/ability/subject role.                                        |
| `Subject` type + builder                                                                                                                                  | ✅           | `shared/context/subject.ts`, `authorization/subject.resolver.ts`, `tenancy/tenant-resolver.ts` | Staff subject carries `staffId`. Stored in `RequestContext.subject()`; read from the DB per request.                                                             |
| `@Roles(...)` (RBAC)                                                                                                                                      | ✅           | `authorization/authorization.decorators.ts`, `roles.policy.ts`                                 | `RolesPolicy.hasRole` reads the role only. `ANY_MEMBER`, `PLATFORM_ADMIN_ROLE`.                                                                                  |
| `@Policy(PolicyClass, action)` (ABAC)                                                                                                                     | ✅           | `@UsePolicy(...)` in `authorization.decorators.ts`                                             | Typed like `@Can()`: a misspelt or record-only ability doesn't compile.                                                                                          |
| `PolicyGuard` loads the record                                                                                                                            | ✅ (changed) | services + `authorization/decision.ts`                                                         | The guard runs the policy's route ability on the subject; the service loads the record and calls `enforce(policy.rule(...))` (see decisions).                    |
| Startup check: exactly one of `@Public` / `@Roles` / `@Policy`                                                                                            | ✅           | `authorization/authorization-coverage.ts`                                                      | Also accepts `@Can.Anyone()`; checks tenant roles have `@TenantScoped()` and every tenant route declares a check. Fails startup listing each route.              |
| RBAC on existing endpoints                                                                                                                                | ✅           | `admin-tenants`, `maintenance`, `tenants`, `members`, `staff` controllers                      | `PlatformAdminGuard` / `@PlatformAdminOnly()` and `@TenantScoped(...roles)` removed.                                                                             |
| `GET /members` open to every member                                                                                                                       | ✅           | `members.controller.ts`                                                                        | As this spec's RBAC table says (F04 had Owner/Manager).                                                                                                          |
| `MemberPolicy` (A8 role rank)                                                                                                                             | ✅           | `authorization/policies/member.policy.ts`                                                      | Replaces `team/team-roles.ts`. New code `ROLE_RANK_TOO_LOW`.                                                                                                     |
| `StaffPolicy.update` (own calendar)                                                                                                                       | ✅           | `policies/staff.policy.ts`                                                                     | Uses `subject.staffId`.                                                                                                                                          |
| `TenantPolicy.transferOwnership` + `POST /tenants/current/transfer-ownership`                                                                             | ✅           | `policies/tenant.policy.ts`, `team/ownership.{controller,service}.ts`                          | Owner only, password re-entered, target an active Manager who finished setup; one transaction, conditional role changes, audited `tenant.ownership_transferred`. |
| A12 suspended tenant                                                                                                                                      | ✅           | `tenancy/tenant-resolver.ts`                                                                   | 403 `TENANT_SUSPENDED` on every tenant route (reads too, as F01 already did).                                                                                    |
| A1–A7, A9–A11; `BookingPolicy`, `PaymentPolicy`, `SchedulePolicy`, `CustomerPolicy`, `FilePolicy`, `PlatformPiiPolicy`; list `scope()`; field-level views | ⏭️           | —                                                                                              | Their endpoints arrive with F05/F07/F08/F10/F18/F19. `Decision`/`notVisible()` and the subject (`staffId`, `accountId`, `breakGlass`) are ready for them.        |
| Membership cache (≤ 60 s)                                                                                                                                 | ⏭️           | —                                                                                              | Not added: the membership read is one indexed query, and no cache means removal takes effect on the very next request.                                           |

### Decisions that differ from the spec

- **Route check in the guard, record check in the service.** `@nestjs/authorization`'s guard runs before pipes and can only answer a plain 403. Loading the record there would load it twice and answer 403 before a 404. So each ABAC policy has a **route ability** (`(subject) → boolean`, e.g. "may manage members at all") for the guard, and **record rules** returning a `Decision` with a stable code, enforced in the service after a tenant-scoped load. Rules stay pure functions, as the spec asks.
- **`@UsePolicy()` instead of `@Policy()`** on routes: `@Policy()` is already the `@nestjs/authorization` decorator that marks policy classes.
- **`@Can.Anyone()` is a fourth declaration** for routes any signed-in account may call (`/me/*`); the startup check accepts it instead of forcing a fake role list.
- **A fourth subject kind, `user`**: a staff-side user on a route outside any business (e.g. an Owner calling `/admin/*`), so that request gets a 403 instead of a 401.
- **The Subject type lives in `shared/context/subject.ts`** (with `RequestContext`, which stores it) rather than `authorization/subject.ts`. `roles.guard.ts` / `policy.guard.ts` aren't needed: the package's guard runs both.
- **Member management stays Owner/Manager.** Rank alone (A8) would let a Receptionist (2) manage Staff (1); F04 says only Owners and Managers run the team, so `MemberPolicy.manage` needs rank ≥ Manager and the rank rule applies on top.
- **Wrong password on transfer → 403 `REAUTHENTICATION_REQUIRED`** (as for changing a password), not 401, which clients read as "token expired". Bad targets → 422 `TRANSFER_TARGET_INVALID`.
- **`TenantGuard` became `TenantResolver`** (`tenancy/tenant-resolver.ts`): the same rules, called by the subject resolver, because a route guard runs after the global authorization guard.

### New scripts, env vars and dependencies

- Dependency: `@nestjs/authorization` 0.1.4.
- No new env vars or scripts. Error codes: `ROLE_RANK_TOO_LOW`, `TRANSFER_TARGET_INVALID`.
- New endpoint: `POST /tenants/current/transfer-ownership` `{ memberId, password }` → `200 { owner, previousOwner }`.

### Tests

- Unit: `authorization/authorization.spec.ts` (guard wiring: RBAC table, RBAC loads no record, platform role, ABAC route ability, deny by default; startup check cases), `subject.resolver.spec.ts`, `policies/member.policy.spec.ts`, `policies/staff.policy.spec.ts`, `policies/tenant.policy.spec.ts`; `tenancy/tenant-resolver.spec.ts` replaces the guard spec; `team/team-roles.spec.ts` removed.
- E2E: `test/authorization.e2e-spec.ts` (RBAC matrix for 6 endpoints × 6 callers, A8 over HTTP, removal applies next request, ownership transfer allow/deny, startup check sees every route). `test/team.e2e-spec.ts` updated: Manager adding a Manager → `ROLE_RANK_TOO_LOW`; Receptionist/Staff can read `GET /members`.
- Final: unit **32 files, 198 tests passed**; e2e **13 files, 130 tests passed**; lint, format, typecheck and build clean. Manually checked: removing `@Can.Anyone()` from `MeController` stops startup naming all 5 routes.

### Acceptance criteria

| Criterion                                                                       | Status                  | How                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Table-driven e2e: each role gets 2xx or 403 on every RBAC endpoint              | ✅ (existing endpoints) | `authorization.e2e-spec.ts`; later RBAC endpoints add rows.                                                      |
| RBAC never loads the target record before deciding                              | ✅                      | `authorization.spec.ts` spies on a repository; `RolesPolicy` has no dependencies.                                |
| Unit tests per policy, allow + deny for A1–A12 with a fixed `now`               | ⏳                      | A8 and A12 done (+ staff/ownership rules); others wait for their policies.                                       |
| Two Staff, same role: own booking 200, other's 404                              | ⏳                      | Needs bookings (F07). Same-role-different-answer is covered for calendars (`StaffPolicy`, unit + team e2e, 403). |
| Customer cancel window 25 h / 23 h                                              | ⏳                      | F07.                                                                                                             |
| Manager removes a Receptionist → 200; another Manager → 403 `ROLE_RANK_TOO_LOW` | ✅                      | Unit + e2e (204 No Content).                                                                                     |
| Staff intake form vs ID document                                                | ⏳                      | F18.                                                                                                             |
| Platform PII masked / break-glass                                               | ⏳                      | F19.                                                                                                             |
| Startup check fails for no decorator or both                                    | ✅                      | Unit cases + manual run.                                                                                         |
| Removing a membership takes effect on the next request                          | ✅                      | e2e (`NOT_A_MEMBER` on the next call).                                                                           |

### Follow-ups for later features

- **F05:** `SchedulePolicy.manage` (A1 own calendar, 404) for `/staff/:id/working-hours` and `/time-off`; `@Roles(OWNER, MANAGER)` on `/services`, `/holidays`, `PUT /staff/:id/services`.
- **F07:** `BookingPolicy` (read/scope/create/reschedule/cancel/complete/waiveDeposit; A1–A5) with `scope()` → Prisma `where` for lists; tenant `cancellationWindowHours` / `staffEditPastHours` as environment attributes; the two-Staff and cancel-window e2e.
- **F08:** `CustomerPolicy.viewContact` field-level (A9) in `CustomerView` / `BookingView`.
- **F10:** `PaymentPolicy.pay` / `.refund` (A6, A7); `PUT /tenants/current/deposit-policy` `@Roles(OWNER)`.
- **F18:** `FilePolicy` (A10).
- **F19:** break-glass grants and `PlatformPiiPolicy` (A11).
- Ownership transfer sends no email yet (F14 notifications).
