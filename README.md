# SeatLock

A real-time seat booking demo that solves the two classic flash-sale
failure modes:

1. **Thundering herd** — everyone hits "buy" at the same second and the
   backend falls over. SeatLock admits shoppers through a **virtual
   waiting queue**: you get a ticket number, and only a small number of
   people are let into seat selection at once.
2. **Double-booking** — two people grab the same seat in the same
   millisecond. SeatLock uses **TTL-based optimistic locking**: claiming a
   seat is an atomic, conflict-checked database transaction, and an
   unpurchased hold auto-expires so seats don't get stuck.

No custom backend server — Firebase Realtime Database (+ anonymous Auth)
does the coordination, and the whole frontend is a static React/Vite app
you can deploy to Vercel or Netlify.

---

## 1. What you need to do

### a) Create a Firebase project
1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. Inside the project, go to **Build → Realtime Database → Create Database**.
   Pick any region; start in **locked mode** (we'll deploy our own rules).
3. Go to **Build → Authentication → Sign-in method** and enable **Anonymous**.
4. Go to **Project settings → General → Your apps → Add app → Web (</>)**.
   Register the app (no Firebase Hosting needed) and copy the config
   object it gives you.

### b) Configure the app locally
```bash
cd seatlock
cp .env.example .env
# paste the values from the Firebase config object into .env
npm install
npm run dev
```
Open two or three browser tabs (or one normal + one incognito, since
anonymous auth gives each *storage context* its own identity) to see the
queue and seat locking work with multiple "shoppers" at once.

### c) Deploy the database rules
The rules in `database.rules.json` are what actually stop double-booking
— the client-side transaction logic only works because the database
rejects writes that violate the invariant. Deploy them with the
[Firebase CLI](https://firebase.google.com/docs/cli):
```bash
npm install -g firebase-tools
firebase login
firebase init database   # point it at database.rules.json, same project
firebase deploy --only database
```

### d) Deploy the frontend
Vercel or Netlify both work out of the box for a Vite app:
- **Vercel**: `vercel` in the project root, or connect the repo in the dashboard. Framework preset: Vite.
- **Netlify**: build command `npm run build`, publish directory `dist`.

Either way, add the same environment variables from your `.env` file in
the host's dashboard (Vercel: Project → Settings → Environment Variables;
Netlify: Site settings → Environment variables) — `.env` itself isn't
deployed.

### e) Tune it
Open `src/config.js` — `ROOM_CAPACITY`, `SEAT_LOCK_TTL_MS`, and
`ADMITTED_SESSION_MS` are the three numbers that make the queueing and
locking behavior visible when you're testing with a handful of tabs.
Turn `ROOM_CAPACITY` up for a real event.

---

## 2. How it works

### Data model (Realtime Database)
```
events/{eventId}/
  meta/                     { name, totalSeats, createdAt }
  seats/{seatId}/           { label, row, col, price, status, lockedBy, lockExpiresAt, soldTo }
  queue/
    ticketCounter           last issued ticket number
    waiting/{uid}/          { ticketNumber, joinedAt }
    admitted/{uid}/         { ticketNumber, admittedAt, expiresAt }
```

### Virtual waiting queue (admission control)
- Joining the queue is a `runTransaction` that increments a shared
  `ticketCounter` and writes `waiting/{uid}` — this is what makes ticket
  numbers globally unique and ordered even if a thousand people join in
  the same second.
- A **sweep** (also a transaction, so concurrent sweeps can't
  double-admit) expires any `admitted` entry whose TTL has passed, then
  promotes the lowest ticket numbers from `waiting` into `admitted` to
  fill the freed slots.
- Every connected client triggers a sweep every few seconds
  (`SWEEP_INTERVAL_MS`), and an admitted client sends a heartbeat
  (`HEARTBEAT_MS`) to keep its slot while the tab is open. Close the tab
  or let the TTL lapse, and the sweep hands your slot to the next person.

### TTL-based seat locking (anti-double-booking)
- Clicking a seat runs a `runTransaction` on that seat only: it checks
  the *current* server-side value, and only commits the lock if the seat
  is available, or locked-but-expired, or already locked by you. Two
  clients racing for the same seat can't both win — the DB serializes the
  transaction and one of them gets rejected, not just "loses" client-side.
- A lock carries `lockExpiresAt`. If you don't confirm purchase in time,
  the seat is up for grabs again — enforced by the same transaction logic
  on the next person's attempt (a lazy/check-on-read expiry, no cron
  needed).
- Confirming purchase is itself a transaction that only succeeds if your
  lock is still valid, so an expired hold can't be "checked out" after
  the fact.

### A known limitation, on purpose
The admission sweep runs on the client (any connected tab can trigger
it), which is why `database.rules.json` leaves `queue/*` writable by any
signed-in user — a client has to be able to move *other* users from
waiting to admitted. That's fine for a demo behind anonymous auth, but
it's not a real fairness guarantee (a malicious client could tamper with
its own ticket number). The seat-locking rules, by contrast, **are**
fully enforced server-side and are safe as written.

---

## 3. Moving to production scale

This architecture is intentionally the simplest thing that demonstrates
the two core patterns. Here's the path to a system that holds up at
real flash-sale volume (hundreds of thousands of concurrent shoppers):

| Concern | Demo (this repo) | Production |
|---|---|---|
| Admission queue | Client-triggered sweep via RTDB transactions | A **Redis**-backed queue (sorted set keyed by ticket number) with a small worker pool doing admission — O(log n) operations at any scale, and no client ever needs write access to move other users |
| Seat lock | RTDB transaction with TTL field | Redis `SET seat:id uid NX PX <ttl>` — a single atomic op with native expiry, no polling/lazy-expiry needed, sub-millisecond |
| Fan-out to shoppers | RTDB's built-in realtime listeners | A **message queue** (e.g. Kafka/SQS/Pub-Sub) publishing admission and seat-status events, consumed by a thin realtime layer (websockets or SSE) so the write path and the fan-out path scale independently |
| Source of truth for sold seats | RTDB `seats/` node | **Sharded Postgres** (shard by `eventId`) as the durable, transactional system of record — Redis holds the hot lock state, Postgres commits the final sale with a real `SERIALIZABLE` or `SELECT … FOR UPDATE` transaction as the last step, so a Redis failure can't sell a seat twice |
| Rules enforcement | Firebase security rules | An actual backend service (Cloud Function, or a dedicated API) — rules-as-code is fine for a demo but you want normal application logic, monitoring, and rate limiting at this volume |

The core invariant carries over unchanged: **admission is rate-limited
by a queue, and seat locks are atomic-with-TTL** — only the substrate
they run on changes.
