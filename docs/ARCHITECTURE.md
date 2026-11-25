# Architecture

SeatLock has no application server. The React client proposes state changes, and
Firebase Realtime Database security rules (`database.rules.json`) decide whether
each change is allowed. The rules see the true server clock (`now`), and the
database serializes writes to any single location. Those two facts are enough to
enforce every invariant below.

## Data model

| Path | Shape | Who writes it |
|---|---|---|
| `events/{eventId}` | `{ name, rows, cols, ttlMs, batch, intervalMs, maxSeats, saleStart, admissionMode, capacity }`. `admissionMode` is `'time'` (default, also when missing) or `'occupancy'`; `capacity` is the most people allowed inside in occupancy mode | Admin script only |
| `counters/{eventId}/nextTicket` | number | Any signed-in user, +1 at a time |
| `counters/{eventId}/nowServing` | number, starts at 0, never decreases. Occupancy mode only: ticket `t` is admitted iff `t < nowServing` | Coordinator only (clients are denied by the rules; the Admin SDK bypasses them) |
| `coordinator/{eventId}/admitted/{ticket}` | `{ uid, admittedAt, held? }`, the coordinator's own bookkeeping | Coordinator only; closed to clients for read and write |
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

Two modes, chosen per event by `admissionMode`. In both, the **security rules**
decide whether a hold is allowed, so a client cannot admit itself, and people in
the waiting room do not subscribe to seat data.

**Time mode (default).** Ticket `t` is admitted once
`t * intervalMs <= (now - saleStart) * batch`: a leaky bucket that releases
`batch` people every `intervalMs`. It depends only on server time, so no
coordinator is needed. It limits the *rate* of entry, not how many people are
inside: if people stay long, people inside is roughly rate x dwell time and keeps
growing.

**Occupancy mode (prototype).** Ticket `t` is admitted iff `t < nowServing`, where
`counters/{event}/nowServing` is moved only by a coordinator
(`scripts/coordinator.js`), like the "now serving" display at a bank. Tickets are
never rewritten. Rules cannot count how many people are inside, hence the
coordinator.

- **Inside** means: admitted, and not yet one of (1) booked, (2) released their
  hold after being seen holding, (3) past their admission window
  (`admittedAt + 2 x ttlMs` by default). The window is what frees the capacity of
  people who just walk away, because hold expiry is lazy and fires no event.
- Each sweep (every 500 ms, and on seat/booking changes) it computes
  `computeNextServing({ nowServing, nextTicket, capacity, inside, soldOut })`: admit
  the next people in ticket order while `inside < capacity`, never past the number
  of tickets issued, never backwards, and nobody once every seat is booked.
- It is the single writer of `nowServing`, so that value has no write race. Writes
  are throttled to about 4 per second because every waiting user listens to it.
  `nowServing` and the new `coordinator/.../admitted/*` records go out in one atomic
  update.
- State is rebuilt from the database on startup, so a restart is safe.
- Waiting users listen only to `nowServing` and read their own ticket; the room
  shows `ticket - nowServing` people ahead. They stop listening once admitted.

What the rules guarantee in occupancy mode: nobody holds before `ticket < nowServing`,
and the other invariants are unchanged. What only the coordinator guarantees:
that at most `capacity` people are inside.

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
- **Time-based admission wastes capacity / does not bound occupancy.** Addressed in
  prototype form by occupancy mode (above). What remains:
  - The coordinator is a single process and a single point of failure. If it stops,
    `nowServing` freezes and nobody new is admitted; there is no fallback to time mode.
  - Admission is never revoked. Someone past their window (or who already booked)
    can still hold seats, because the rules only compare ticket to `nowServing`. They
    just stop counting toward capacity, so capacity can be exceeded by such people.
  - "Released" is detected by polling: a hold-and-release between two sweeps goes
    unnoticed until the window expires. Someone who releases to pick other seats is
    treated as finished.
  - When every seat is booked the coordinator stops admitting, so people still waiting
    are never told the sale is over. The UI has no sold-out state for them.
  - The coordinator listens to whole `tickets/`, `seats/` and `bookings/` nodes and
    uses its own clock for windows; fine for a prototype, not for 100k users.
  - Clients that never come back hold capacity for up to the window.
- **The ticket counter is a single hot key.** Contention shows up as CAS retries
  in the load test.
- **Payment is simulated.**
