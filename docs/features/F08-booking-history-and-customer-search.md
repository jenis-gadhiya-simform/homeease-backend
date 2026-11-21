# F08 — Booking History & Customer Search

**Phase:** 2 · **Modules:** 1.11 Querying · **Depends on:** F07

## Goal

Fast, stable lists over large tables: cursor-paginated booking history and customer search by name or phone.

## Customer (tenant-scoped profile)

```prisma
model Customer {
  id                 String   @id @default(uuid(7)) @db.Uuid
  tenantId           String   @map("tenant_id") @db.Uuid
  customerAccountId  String?  @map("customer_account_id") @db.Uuid  // null = walk-in created by reception
  name               String
  email              String?
  phoneE164          String?  @map("phone_e164")                    // normalised: +919876543210
  marketingOptIn     Boolean  @default(false) @map("marketing_opt_in")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([tenantId, customerAccountId])
  @@index([tenantId, phoneE164])
  @@map("customer")
}
```

The same person booking at two businesses has **one** `CustomerAccount` and **two** `Customer` rows — each business sees only its own row (PII isolation).

## Cursor pagination

`GET /bookings/history?status=…&staffId=…&from=…&to=…&limit=25&cursor=…`

- **Keyset**, not `OFFSET`: order by `(start_at DESC, id DESC)`; next page `WHERE (start_at, id) < ($cursorStart, $cursorId)`.
- Cursor is opaque: base64url of `{ s: startAt, i: id, d: 'desc' }`, optionally HMAC-signed so clients can't forge filters.
- Response: `{ items, nextCursor | null }`. No total count by default (expensive); `?includeTotal=true` for small tenants only.
- Index `(tenant_id, start_at DESC, id DESC)` (plus `staff_id` variant for Staff role) — prove with `EXPLAIN` that page 1000 costs the same as page 1.
- Same pattern for `/me/bookings` (customer) and `/customers/:id/bookings`.

## Customer search

`GET /customers?q=…&limit=20&cursor=…` (Owner, Manager, Receptionist)

- **Name:** `pg_trgm` + `unaccent` → `CREATE INDEX customer_name_trgm ON customer USING gin (tenant_id, lower(unaccent_immutable(name)) gin_trgm_ops)` (needs `btree_gin` for `tenant_id`). Query with `%` / `similarity()` ordered by similarity, ties by id.
- **Phone:** if `q` looks like a phone, normalise to E.164 with `libphonenumber-js` (default region `IN`) and prefix-match `phone_e164` (btree `text_pattern_ops`). "98765 43210", "09876543210" and "+91 98765 43210" find the same person.
- **Email:** exact lowercased match.
- Min 2 characters; throttled.

## Acceptance criteria

- Inserting new bookings while paging doesn't duplicate or skip items (keyset property).
- Tampered cursor → 400.
- "jose" finds "José"; "smth" finds "Smith" (trigram); phone in any common format matches.
- Staff role history returns only own bookings and the query plan uses the staff index.
- `docs/perf/querying.md` shows OFFSET vs keyset timings at 1M bookings.
