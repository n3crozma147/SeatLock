# Load test

`npm run loadtest` seeds a small event (few seats) and releases many simulated
fans at the same instant against the emulator. Each fan runs the app's real
service code: sign in, take a queue ticket, wait to be admitted, try to hold
front-row seats, then confirm, release, or abandon the hold.

Afterwards the script reads the database with admin access and fails if:

- two users share a queue ticket, or ticket numbers have gaps
- any seat has more than one booking
- a booking record disagrees with its seat

## Results

The emulator is single-threaded and local, and all simulated clients share one Node
process, so treat the numbers as relative, not as production capacity. Every row below
is a real run (Windows laptop, Firebase emulator, one run each: no averaging, and
run-to-run variance is large, see the two occupancy rows). Only 200 clients were run;
the 100/300/500 rows that used to be here were never measured, so they are not filled in.

### Time mode vs occupancy mode

All rows: 200 clients, 4x10 = 40 seats, hold TTL 30 s, `--dwell 8000` (each admitted
user browses for 8 s before choosing seats), confirm rate 0.8. Time mode admits 50 people
per second (the load test's default `batch 50` / `interval 1000`). Occupancy mode has
`--capacity 20`, with the coordinator running in-process.

```
npm run loadtest -- --clients 200 --rows 4 --cols 10 --dwell 8000 --mode time
npm run loadtest -- --clients 200 --rows 4 --cols 10 --dwell 8000 --mode occupancy --capacity 20
```

| Run | Mode | Peak people inside | Hold p50 / p95 (ms) | Hold conflicts | Seats booked | Ticket CAS retries | Wall time | Invariants |
|---|---|---|---|---|---|---|---|---|
| 1 | time | 187 | 9 / 98 | 2 | 34/40 | 1550 | 29.1 s | held |
| 2 | time | 183 | 11 / 145 | 2 | 35/40 | 1375 | 26.2 s | held |
| 3 | occupancy (cap 20) | 20 | 16 / 64 | 3 | 40/40 | 1270 | 214.0 s | held |
| 4 | occupancy (cap 20) | 20 | 10 / 329 | 0 | 40/40 | 1652 | 103.2 s | held |

"Invariants held" means the load test printed `All invariants held`: unique contiguous
tickets and at most one booking per seat (and, in occupancy mode, peak inside <= capacity).
"Peak people inside" is measured by the simulated clients: admitted and not yet finished
(booked, released, gave up or walked away), so it undercounts people the coordinator still
treats as inside until their window ends.

How to read it:

- Time mode lets in almost everyone within seconds, so with a long dwell the room fills
  to about 183-187 people. Occupancy mode held the room at exactly its capacity of 20.
- Hold latency is in the same range for both modes in these runs (p50 9-16 ms). The p95
  differs between runs of the *same* mode (98 vs 145 ms; 64 vs 329 ms), so these runs do
  not show a latency difference between the modes.
- Hold conflicts are low in every run (0-3). Most clients in time mode (169-171) found
  the sale already sold out when they got in; ticket-taking alone took about 11-14 s at
  p50 because of the hot counter, so arrivals were spread out. Treat the conflict count as
  not comparable with a genuinely simultaneous arrival.
- Occupancy mode sold all 40 seats; time mode sold 34 and 35.
- Occupancy mode took longer (103-214 s vs 26-29 s). It deliberately lets in at most 20
  at a time, and the two runs differ by about 2x, so the wall time is noisy. In these runs
  the waiting people were told the sale ended (87 and 129 clients) once all seats booked.
- Coordinator view: run 3 reported 61 `nowServing` writes and its own count of people
  inside peaked at **21 against a capacity of 20**, while the client-side peak was 20. A
  re-run with a warning log added (run 4) did not reproduce it (coordinator peak 20, 63
  writes), so the cause of the 21 is **unexplained**. It was seen once in two occupancy runs.

The ticket CAS retries grow quickly with clients (the counter is one hot key), in both
modes, and are unrelated to admission mode.
