# F13 — Outbound Webhooks

**Phase:** 3 · **Modules:** 2.15 Webhooks · **Depends on:** F07, F09

## Goal

A business's own systems (CRM, POS, Zapier) get notified reliably when bookings change — without losing events if our process crashes right after commit.

## Transactional outbox (`@nestjs/outbox`)

Domain changes write an `outbox` row **in the same transaction** as the booking change. A relay publishes committed rows to the queue. Same mechanism also feeds emails, cache invalidation and real-time events (F14–F17), so there is one reliable event pipeline.

## Events

`booking.created`, `booking.confirmed`, `booking.rescheduled`, `booking.cancelled`, `booking.completed`, `booking.no_show`, `payment.succeeded`, `payment.refunded`.

Payload (versioned, minimal PII — customer id + name, no phone unless the tenant enables it):

```json
{
  "id": "evt_0193…",
  "type": "booking.rescheduled",
  "apiVersion": "2026-11-01",
  "createdAt": "…Z",
  "tenantId": "…",
  "data": {
    "booking": {
      "id": "…",
      "startAt": "…Z",
      "previousStartAt": "…Z",
      "staffId": "…",
      "status": "CONFIRMED"
    }
  }
}
```

## Data model

```prisma
model WebhookEndpoint {
  id         String   @id @default(uuid(7)) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  url        String                                 // https only in production
  secret     String                                 // encrypted at rest; shown once on creation
  events     String[]                               // subscribed types, or ["*"]
  active     Boolean  @default(true)
  failingSince DateTime? @map("failing_since") @db.Timestamptz(3)
  @@map("webhook_endpoint")
}

model WebhookDelivery {
  id            String   @id @default(uuid(7)) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  endpointId    String   @map("endpoint_id") @db.Uuid
  eventId       String   @map("event_id")
  attempt       Int
  status        String                              // PENDING | SUCCEEDED | FAILED
  responseCode  Int?     @map("response_code")
  durationMs    Int?     @map("duration_ms")
  error         String?
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([endpointId, eventId, attempt])
  @@index([tenantId, endpointId, createdAt])
  @@map("webhook_delivery")
}
```

## Delivery (`@nestjs/webhooks` sending side)

- One job per (endpoint, event): `jobId = whk-${endpointId}-${eventId}`.
- Signed like F11: `SlotWise-Signature: t=…,v1=hmac_sha256(secret, t.body)`, plus `SlotWise-Event-Id` so receivers can dedupe.
- 5 s timeout; 2xx = success. Retries with exponential backoff over ~24 h (1 m, 5 m, 30 m, 2 h, 6 h, 12 h).
- **SSRF protection:** resolve DNS and reject private/loopback/link-local IPs; no redirects.
- Endpoint failing for 3 days → auto-disable + email the Owner.

## API (Owner, Manager)

| Method | Path                                                                   |
| ------ | ---------------------------------------------------------------------- |
| CRUD   | `/webhook-endpoints` (secret returned once; `POST /:id/rotate-secret`) |
| POST   | `/webhook-endpoints/:id/test` (sends a `ping` event)                   |
| GET    | `/webhook-endpoints/:id/deliveries?cursor=`                            |
| POST   | `/webhook-deliveries/:id/redeliver`                                    |

## Acceptance criteria

- Killing the process right after a booking commits still delivers the webhook after restart (outbox).
- Receiver returning 500 → retries with backoff; returning 200 on attempt 3 → marked delivered, no more attempts.
- Endpoint URL `http://169.254.169.254/` rejected.
- Signature verifiable with a 10-line sample receiver included in the docs.
