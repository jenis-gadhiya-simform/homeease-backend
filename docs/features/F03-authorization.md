# F03 — Authorization (RBAC and ABAC)

**Phase:** 1 · **Modules:** 1.10 Authorization · **Depends on:** F01, F02, F04

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
