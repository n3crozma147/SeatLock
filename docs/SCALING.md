# Scaling SeatLock

Each Firebase mechanism here stands in for a specific production component. The
invariants in ARCHITECTURE.md stay the same; only the enforcement point moves.

| SeatLock today | Production equivalent | Why it changes |
|---|---|---|
| Rules-checked write to `seats/x` | Redis `SET seat:x uid NX PX ttl`; a Lua script for atomic multi-seat holds | Single-digit-ms holds, horizontal sharding by event |
| Ticket counter with CAS retries | Redis `INCR`, no retries | Removes the single hot key's retry storm |
| Time-based leaky bucket | Gateway token bucket fed by real occupancy (admit when someone books or leaves) | No wasted admission slots |
| Confirm write | Enqueue a confirm job (Kafka/SQS) with an idempotency key; payment workers consume it | Payment latency no longer holds a client connection; retries are safe |
| `seats/` as source of truth | Postgres sharded by `event_id`, `UNIQUE (event_id, seat_id)` on bookings | The database constraint is the last line of defence even if the cache is wrong |
| Every client subscribed to the seat map | Seat-state deltas fanned out over websockets/CDN | Read fan-out independent of write path |
| One hot event | Sub-shard seats by section | A single event no longer maps to a single partition |

## The order I'd do it in

1. Move holds to Redis, keep everything else. Measure hold latency against the load test baseline.
2. Put Postgres behind confirmations with the unique constraint.
3. Add the message queue between hold and confirm.
4. Replace time-based admission with occupancy-based admission.
