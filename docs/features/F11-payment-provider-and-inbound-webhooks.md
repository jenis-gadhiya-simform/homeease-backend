# F11 — Fake Payment Provider & Inbound Webhooks

**Phase:** 3 · **Modules:** 2.15 Webhooks · **Depends on:** F10

## Goal

Simulate a real payment provider ("FakePay") and receive its events the production way: **verify signature → dedupe → acknowledge fast → process asynchronously**.

## FakePay (simulator)

A separate Nest module `src/modules/fakepay/` (dev/test only, disabled in production by env flag), behaving like Stripe-lite:

| Endpoint                              | Behaviour                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /fakepay/v1/payment_intents`    | Honours `Idempotency-Key`; returns `{ id: "pi_…", status: "processing" }`.                                                  |
| `POST /fakepay/v1/refunds`            | Same pattern.                                                                                                               |
| `GET /fakepay/v1/payment_intents/:id` | For reconciliation.                                                                                                         |
| Admin knobs                           | `FAKEPAY_FAILURE_RATE`, `FAKEPAY_LATENCY_MS`, `FAKEPAY_DOWN=true`, card numbers that force outcomes (`4000…0002` declined). |

After a delay it **sends webhooks** (via a BullMQ job) to `POST /webhooks/fakepay`, sometimes **twice**, sometimes **out of order** (configurable) — so dedupe and ordering logic are actually exercised.

Our side talks to it through a `PaymentProvider` interface (`src/shared/payments/`) so a real provider could replace it.

## Receiving: `POST /webhooks/fakepay` (`@Public()`, `@SkipThrottle()` or a high limit)

Use `@nestjs/webhooks` for verification:

1. **Raw body required** — signature is over exact bytes; enable raw body for this route.
2. **Signature:** header `FakePay-Signature: t=1732190000,v1=<hex hmac_sha256(secret, t + "." + body)>`. Constant-time compare. Reject if `|now - t| > 300 s` (replay protection). Support two active secrets for rotation.
3. **Dedupe:** insert into `inbound_webhook_event (provider, event_id UNIQUE, type, payload jsonb, received_at, processed_at, status, attempts, last_error)`. Unique violation → already seen → `200` and stop.
4. **Ack fast:** enqueue job `webhook-process` with `jobId = fakepay-${eventId}`, return `200` within ~50 ms. Never do business logic in the request.
5. **Process (worker):**
   - `payment.succeeded` → Payment `SUCCEEDED`, Booking `HELD → CONFIRMED` (or refund if orphaned), audit (`actorType = WEBHOOK`), outbox `booking.confirmed`, enqueue confirmation email, schedule reminders.
   - `payment.failed` → Payment `FAILED`; booking stays `HELD` until expiry so the customer can retry with another card.
   - `refund.succeeded` → update `refundedMinor`, status.
   - **Ordering:** apply transitions only if they move forward (state machine); a late `payment.processing` after `succeeded` is ignored. Use `SELECT … FOR UPDATE` on the payment row.
   - Idempotent: re-running the same event is a no-op.

## Reconciliation job

Every 15 min: payments `PROCESSING` for > 10 min → ask the provider for status and apply it (covers lost webhooks).

## Observability

Platform admins see webhook logs (F19): received, signature failures (count only, no payload), processing errors, retries. Failed processing after 5 attempts → dead-letter + alert.

## Acceptance criteria

- Bad signature → 400 and nothing stored. Old timestamp → 400.
- Same event delivered 3 times → booking confirmed once, one audit entry, one email.
- `succeeded` delivered before `processing` → final state SUCCEEDED.
- Webhook endpoint p95 < 100 ms (only verify + insert + enqueue).
- Turning off webhooks entirely, reconciliation still confirms the booking.
