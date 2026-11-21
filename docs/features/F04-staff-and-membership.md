# F04 — Team Members & Staff

**Phase:** 1 · **Modules:** 1.10 · **Depends on:** F01, F02

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
