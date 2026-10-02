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

Fill this in from your own runs. The emulator is single-threaded and local, so
treat the numbers as relative, not as production capacity.

| Clients | Seats | Ticket CAS retries | Hold conflicts | Seats booked | p95 hold (ms) | Invariants |
|---|---|---|---|---|---|---|
| 100 | 40 | | | | | |
| 300 | 40 | | | | | |
| 500 | 40 | | | | | |

What to look for: CAS retries should grow faster than linearly with clients
(the counter is one hot key), while hold conflicts concentrate on the front rows.
