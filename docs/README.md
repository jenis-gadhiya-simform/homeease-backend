# SlotWise Docs

| Document                                  | What's in it                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Product overview](./product/overview.md) | What SlotWise is, roles, glossary, booking lifecycle, cross-cutting rules, learning-module coverage |
| [Roadmap](./roadmap.md)                   | Phases, order, milestones, definition of done                                                       |
| [Architecture](./architecture.md)         | How the backend is built today                                                                      |

## Feature specs

| ID                                                             | Feature                                | Phase | Modules   | Status      |
| -------------------------------------------------------------- | -------------------------------------- | ----- | --------- | ----------- |
| [F00](./features/F00-platform-foundations.md)                  | Platform foundations                   | 0     | —         | ✅ v1       |
| [F01](./features/F01-tenancy.md)                               | Tenancy & business onboarding          | 1     | 1.10      | ✅ v1       |
| [F02](./features/F02-authentication.md)                        | Authentication (password + magic link) | 1     | —         | ✅ v1       |
| [F03](./features/F03-authorization.md)                         | Authorization (RBAC and ABAC)          | 1     | 1.10      | Not started |
| [F04](./features/F04-staff-and-membership.md)                  | Team members & staff                   | 1     | 1.10      | ✅ v1       |
| [F05](./features/F05-catalog-and-schedules.md)                 | Services, hours, time off, holidays    | 1     | 1.12      | Not started |
| [F06](./features/F06-availability-search.md)                   | Availability (free-slot search)        | 1     | 1.6, 1.12 | Not started |
| [F07](./features/F07-bookings-and-concurrency.md)              | Bookings & concurrency                 | 1     | 1.8       | Not started |
| [F08](./features/F08-booking-history-and-customer-search.md)   | Booking history & customer search      | 2     | 1.11      | Not started |
| [F09](./features/F09-audit-log.md)                             | Audit log                              | 1–2   | 1.13      | 🚧 table    |
| [F10](./features/F10-deposits-and-payments.md)                 | Deposits & payments                    | 3     | 2.5, 1.12 | Not started |
| [F11](./features/F11-payment-provider-and-inbound-webhooks.md) | FakePay & inbound webhooks             | 3     | 2.15      | Not started |
| [F12](./features/F12-payment-resilience.md)                    | Payment resilience                     | 3     | 2.4       | Not started |
| [F13](./features/F13-outbound-webhooks.md)                     | Outbound webhooks & outbox             | 3     | 2.15      | Not started |
| [F14](./features/F14-notifications.md)                         | Notifications                          | 4     | 2.13      | Not started |
| [F15](./features/F15-scheduled-jobs.md)                        | Scheduled & background jobs            | 4     | 2.8, 2.9  | Not started |
| [F16](./features/F16-availability-caching.md)                  | Availability caching                   | 4     | 1.16      | Not started |
| [F17](./features/F17-realtime-calendar.md)                     | Real-time calendar                     | 4     | 2.14      | Not started |
| [F18](./features/F18-files-and-reports.md)                     | Files & revenue reports                | 5     | 2.12      | Not started |
| [F19](./features/F19-platform-admin.md)                        | Platform admin                         | 5     | 1.10      | Not started |
