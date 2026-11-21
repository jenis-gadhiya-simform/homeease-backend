# F14 — Notifications (Email, Preferences, In-App)

**Phase:** 4 · **Modules:** 2.13 Notifications · **Depends on:** F07, F13 (outbox events), existing `EmailModule`

## Goal

Tell the right person the right thing through the right channel, respect opt-outs, and never send the same email twice.

## Catalogue

| Trigger                                                            |      Customer email      |           Staff in-app           | Staff email | Transactional?            |
| ------------------------------------------------------------------ | :----------------------: | :------------------------------: | :---------: | ------------------------- |
| Booking confirmed                                                  | ✅ (+ `.ics` attachment) | ✅ assigned staff, receptionists |  optional   | yes                       |
| Booking rescheduled                                                |    ✅ old → new time     |                ✅                |  optional   | yes                       |
| Booking cancelled                                                  |    ✅ (+ refund info)    |                ✅                |  optional   | yes                       |
| Payment failed / slot released                                     |            ✅            |                —                 |      —      | yes                       |
| Reminder 24 h / 1 h (F15)                                          |            ✅            |                —                 |      —      | reminder (can opt out)    |
| Daily agenda (F15)                                                 |            —             |                —                 |     ✅      | digest (can opt out)      |
| New online booking                                                 |            —             |          ✅ live (F17)           |      —      | —                         |
| Account setup (Owner / member welcome), magic link, password reset |            ✅            |                —                 |      —      | security (cannot opt out) |
| Webhook endpoint disabled, report ready                            |            —             |                ✅                |  ✅ Owner   | yes                       |

## Implementation

- Outbox events (`booking.confirmed`, …) → `NotificationService` decides recipients and channels → `EmailService.enqueue(mail, to, data, { jobId: \`${mail}-${bookingId}-${version}\` })`. The `jobId` makes duplicates impossible even if the event is processed twice.
- Each email = template in `src/shared/mail/templates/` + `Mailable` in `src/modules/email/mails/` + entry in `MAILS` (existing convention).
- **Times in emails:** emails are rendered on the server, where there's no frontend to convert, so they show times in `DISPLAY_TIMEZONE` (IST) with `en-IN` formatting: "Tue, 1 Dec 2026, 9:00 am IST". Money via `formatInr()` → `₹500.00`. The `.ics` attachment uses UTC, so calendar apps convert it themselves.
- Translations later via `@nestjs/i18n` (keep strings in templates, not code).

## Preferences & unsubscribe

```prisma
model NotificationPreference {
  id          String  @id @default(uuid(7)) @db.Uuid
  subjectType String  @map("subject_type")   // CUSTOMER | USER
  subjectId   String  @map("subject_id") @db.Uuid
  tenantId    String? @map("tenant_id") @db.Uuid
  category    String                         // REMINDERS | DIGEST | MARKETING
  channel     String                         // EMAIL | IN_APP
  enabled     Boolean
  @@unique([subjectType, subjectId, tenantId, category, channel])
  @@map("notification_preference")
}
```

- Every non-security email carries a **one-click unsubscribe** link + `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Link contains a signed, non-expiring token (HMAC of subject + category), so no login is needed: `GET/POST /unsubscribe/:token`.
- Transactional (confirmation/cancellation) and security emails ignore opt-outs.
- `GET/PUT /me/notification-preferences` for customers and staff.
- Hard bounces (if the transport reports them) mark the email as undeliverable.

## In-app notifications (staff)

```prisma
model Notification {
  id        String    @id @default(uuid(7)) @db.Uuid
  tenantId  String    @map("tenant_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  type      String
  title     String
  body      String
  link      String?
  readAt    DateTime? @map("read_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([userId, readAt, createdAt])
  @@map("notification")
}
```

`GET /notifications?unread=true&cursor=`, `POST /notifications/:id/read`, `POST /notifications/read-all`; new ones are pushed live over F17.

## Acceptance criteria

- Processing `booking.confirmed` twice sends one email (check Mailpit).
- Unsubscribe from reminders → no reminder, still gets cancellation email.
- A booking at `2026-11-30T19:00:00Z` shows as "Tue, 1 Dec 2026, 12:30 am IST" in the email, and the `.ics` holds the UTC time.
