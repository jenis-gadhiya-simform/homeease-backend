# F12 — Payment Resilience

**Phase:** 3 · **Modules:** 2.4 Resilience · **Depends on:** F10, F11

## Goal

When FakePay is slow or down, SlotWise degrades gracefully: **keep the slot held, don't hammer the provider, retry later, tell the customer honestly.**

## Policies (`@nestjs/resilience`) on `PaymentProvider` calls

| Policy              | Setting (start values, tune with tests)                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout             | 3 s per call                                                                                                                                                                       |
| Retry               | 2 retries, exponential backoff + jitter (200 ms, 800 ms), **only** on network errors/5xx/timeouts, **never** on 4xx. Safe because every call carries the provider idempotency key. |
| Circuit breaker     | Opens after 50% failures over ≥ 10 calls in 30 s; half-open after 30 s with 3 trial calls. One breaker per provider, state in Redis so all instances agree.                        |
| Bulkhead (optional) | Max 20 concurrent provider calls per instance.                                                                                                                                     |

## Behaviour when the provider is unavailable

1. Breaker open (or retries exhausted) on `POST /deposit`:
   - Payment stays `PENDING` with `failureCode = PROVIDER_UNAVAILABLE`.
   - Booking hold is **extended** (e.g. to 30 min, max once) so the customer doesn't lose the slot.
   - Enqueue `payment-retry` job (`jobId = payment-retry-${paymentId}`) with backoff 1, 2, 5, 10 min.
   - Respond `202 { status: "PENDING_PROVIDER", retryAfterSec }` — not a 500.
2. Retry job succeeds → normal flow (webhook confirms).
3. Retries exhausted before hold expiry → hold expires, customer gets "we couldn't process your payment, your slot was released" email; audited.

## Observability

- Metrics: breaker state changes, provider latency, retry counts (Observe).
- `/ready` does **not** fail when the provider is down (it's not our dependency to restart for).
- Platform admin sees breaker state on the admin dashboard (F19).

## Acceptance criteria (use FakePay knobs)

- `FAKEPAY_DOWN=true`: deposit returns 202 `PENDING_PROVIDER`, hold extended, after 10 failures the breaker opens and further calls fail fast (< 10 ms) without hitting FakePay.
- Provider back up: half-open trial succeeds, breaker closes, queued retries complete and bookings confirm.
- A 4xx (card declined) is not retried.
- No duplicate charge across retries (provider idempotency key).
