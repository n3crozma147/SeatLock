# Architecture

SeatLock has no application server. The React client proposes state changes, and
Firebase Realtime Database security rules (`database.rules.json`) decide whether
each change is allowed. The rules see the true server clock (`now`), and the
database serializes writes to any single location. Those two facts are enough to
enforce every invariant below.

## Data model

| Path | Shape | Who writes it |
|---|---|---|
| `events/{eventId}` | `{ name, rows, cols, ttlMs, batch, intervalMs, maxSeats, saleStart }` | Admin script only |
| `counters/{eventId}/nextTicket` | number | Any signed-in user, +1 at a time |
| `tickets/{eventId}/{uid}` | number | The user, once, together with the counter |
| `seats/{eventId}/{seatId}` | `{ status, holder, lockedAt, bookedAt? }`, absent means free | Holder, under the state machine |
| `bookings/{eventId}/{uid}/{seatId}` | `{ bookedAt }` | The user, in the same write that books the seat |

## Seat state machine

```
free ──acquire──► held(u) ──confirm (u, before expiry)──► booked(u)   [final]
  ▲                 │
  └──release (u)────┤
  └──expiry─────────┘   (lazy: a hold with lockedAt + ttlMs < now counts as free)
```

- **Acquire** requires: the seat is absent or its hold expired; `holder == auth.uid`;
  `lockedAt == now` (the server timestamp, so holds cannot be backdated or extended);
  and the user's queue ticket is admitted.
- **Confirm** requires: the writer is the holder and `lockedAt + ttlMs >= now`.
- **Release** requires: the writer is the holder of an unbooked seat.
- Nothing can modify a booked seat.

## Invariants

1. **At most one active holder per seat.** Writes to one seat are serialized, and
   acquire is only allowed when no unexpired hold exists.
2. **At most one booking per seat.** Booking requires being the unexpired holder,
   and booked is a final state.
3. **No booking after expiry.** Confirm (`lockedAt + ttl >= now`) and reclaim
   (`lockedAt + ttl < now`) are disjoint at every instant, so the holder and a
   new buyer can never both succeed.
4. **Queue tickets are unique and contiguous.** A ticket write must equal the old
   counter and bump it by exactly one, atomically; tickets are write-once.
5. **Nobody acquires a seat before their admission time**, computed from server time.

`tests/rules/` checks each of these against the emulator; `scripts/loadtest/`
checks 1, 2 and 4 under heavy concurrent load.

## Admission control

Ticket `t` is admitted once `t * intervalMs <= (now - saleStart) * batch`: a
leaky bucket that releases `batch` people every `intervalMs`. Because the
condition only depends on server time, no coordinator process is needed. People
in the waiting room do not subscribe to seat data, so the seat map's read
fan-out is bounded by the admission rate.

## Concurrency control

Holds are **optimistic**: the client never takes a lock before deciding. It
writes the hold and the rules reject the write if someone else got there first
(a conditional write, i.e. compare-and-set). Holding several seats uses one
multi-path update, which is all-or-nothing. `runTransaction` is not used because
transactions cover a single node and evaluate their compare step on the client,
without access to the server clock.

## Client structure

`lib/` (pure logic shared with scripts and tests) ← `services/` (all Firebase I/O,
built from factories that take a database handle) ← `hooks/` ← `features/` ← `pages/`.
Replacing Firebase with a custom backend means rewriting `services/` only.

## Known gaps

- **Sybil users**: anonymous auth lets one person take many tickets. Production
  would add App Check and a real identity at checkout.
- **Per-user seat cap** (`maxSeats`) is enforced by the client only; rules cannot
  count children.
- **Time-based admission wastes capacity** when admitted people leave. Fixing it
  needs a coordinator that sees occupancy.
- **The ticket counter is a single hot key.** Contention shows up as CAS retries
  in the load test.
- **Payment is simulated.**
