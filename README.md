# SeatLock

Flash-sale seat booking that stays correct when thousands of people click at once.
A virtual waiting room meters who can reach the seat map, and seats are held
with time-limited, server-enforced locks, so a seat can never be sold twice.

Built with React (Vite) and Firebase Realtime Database. There is no custom
server: every guarantee is enforced by database security rules.

## How it works

- **Waiting room.** Each visitor takes a numbered ticket. Tickets are admitted a
  few at a time on a server-time schedule, so the seat map never sees the full herd.
- **Optimistic seat holds with a TTL.** Selecting seats writes a hold stamped with
  server time. The rules reject it if someone else holds the seat. Holds expire
  lazily: an expired hold simply counts as free.
- **Atomic booking.** Confirming flips held → booked for all your seats in one
  write, and only while your hold is still valid.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the invariants and
[docs/SCALING.md](docs/SCALING.md) for the path to Redis, a message queue and
sharded Postgres.

## Run it locally

Requires Node 20.19+ and Java 21+.

```bash
npm install
cp .env.example .env.local
npm run emulators          # terminal 1
npm run seed               # terminal 2
npm run dev                # open http://localhost:5173/event/demo in two windows
```

## Tests

```bash
npm test                   # pure logic
npm run test:rules         # security rules against the emulator
npm run loadtest           # thundering-herd test (emulators must be running)
```
