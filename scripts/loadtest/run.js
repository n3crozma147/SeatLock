#!/usr/bin/env node
// Thundering-herd test against the emulator. Start `npm run emulators` first.
//   npm run loadtest -- --clients 300 --rows 4 --cols 10
//   npm run loadtest -- --mode occupancy --capacity 20 --dwell 8000 --clients 200
//
// Flags
//   --mode time|occupancy   admission mode (default time: a leaky bucket, as before)
//   --capacity N            occupancy mode: max people inside at once (default 20)
//   --dwell MS              how long each admitted user "browses" before choosing seats (default 0)
//   --clients --rows --cols --ttl --batch --interval --confirm-rate   as before
// In occupancy mode the coordinator runs inside this process.
// Exits non-zero if any invariant is violated.

import { buildEventConfig, connectAdmin, DEFAULT_PROJECT, seedEvent } from '../lib/admin.js';
import { num, parseArgs } from '../lib/args.js';
import { startCoordinator } from '../lib/coordinator.js';
import { allBookingsPath, seatsPath, ticketsPath } from '../../src/lib/paths.js';
import { runClient } from './client.js';
import { Metrics } from './metrics.js';

const args = parseArgs();
const clients = num(args.clients, 200);
const eventId = args.event ?? 'loadtest';
const projectId = DEFAULT_PROJECT;
const mode = args.mode ?? 'time';
const capacity = num(args.capacity, 20);
const dwellMs = num(args.dwell, 0);

if (!['time', 'occupancy'].includes(mode)) {
  console.error(`--mode must be "time" or "occupancy", got "${mode}"`);
  process.exit(2);
}

const event = buildEventConfig({
  name: 'Load test',
  rows: num(args.rows, 4),
  cols: num(args.cols, 10),
  ttlMs: num(args.ttl, 30_000),
  batch: num(args.batch, 50), // admit quickly: the seat race is what we're testing
  intervalMs: num(args.interval, 1000),
  maxSeats: 4,
  admissionMode: mode,
  capacity,
  saleStart: Date.now() + 2000,
});
const totalSeats = event.rows * event.cols;

const admin = connectAdmin({ projectId });
await seedEvent(admin.db, eventId, event);
console.log(
  `Seeded ${totalSeats} seats. Admission mode: ${mode}${mode === 'occupancy' ? ` (capacity ${capacity})` : ''}, dwell ${dwellMs} ms. ` +
    `Releasing ${clients} clients at once...`,
);

let coordinator = null;
if (mode === 'occupancy') {
  coordinator = startCoordinator({ db: admin.db, eventId, log: (m) => { if (m.startsWith("WARNING")) console.log(m); } });
  await coordinator.ready;
}

// When every seat is booked the coordinator (correctly) stops admitting, so people still
// waiting will never get in. Tell them the sale is over so the test can finish.
const saleEnded = new AbortController();
const seatsRef = admin.db.ref(seatsPath(eventId));
const onSeats = (snap) => {
  let booked = 0;
  snap.forEach((child) => {
    if (child.val()?.status === 'booked') booked++;
  });
  if (booked >= totalSeats) saleEnded.abort();
};
if (mode === 'occupancy') seatsRef.on('value', onSeats);

const metrics = new Metrics();
const started = performance.now();
await Promise.all(
  Array.from({ length: clients }, (_, i) =>
    runClient(
      i,
      {
        projectId,
        eventId,
        event,
        confirmRate: num(args['confirm-rate'], 0.8),
        maxHoldAttempts: 5,
        dwellMs,
        signal: saleEnded.signal,
      },
      metrics,
    ),
  ),
);
const elapsed = ((performance.now() - started) / 1000).toFixed(1);
seatsRef.off('value', onSeats);
if (coordinator) await coordinator.stop();

// Check invariants from the admin side, where rules can't hide anything.
const [seatsSnap, ticketsSnap, bookingsSnap] = await Promise.all([
  admin.db.ref(seatsPath(eventId)).get(),
  admin.db.ref(ticketsPath(eventId)).get(),
  admin.db.ref(allBookingsPath(eventId)).get(),
]);
const seats = seatsSnap.val() ?? {};
const tickets = Object.values(ticketsSnap.val() ?? {});
const bookings = bookingsSnap.val() ?? {};

const violations = [];

const ticketSet = new Set(tickets);
if (ticketSet.size !== tickets.length) violations.push('two users share a queue ticket');
const maxTicket = tickets.length ? Math.max(...tickets) : -1;
if (maxTicket !== tickets.length - 1) violations.push(`ticket numbers have gaps (max ${maxTicket}, count ${tickets.length})`);

const owners = new Map(); // seatId -> [uid]
for (const [uid, seatMap] of Object.entries(bookings)) {
  for (const seatId of Object.keys(seatMap)) owners.set(seatId, [...(owners.get(seatId) ?? []), uid]);
}
for (const [seatId, uids] of owners) {
  if (uids.length > 1) violations.push(`seat ${seatId} booked by ${uids.length} users`);
  const seat = seats[seatId];
  if (seat?.status !== 'booked' || seat.holder !== uids[0]) violations.push(`booking record for ${seatId} does not match the seat`);
}
for (const [seatId, seat] of Object.entries(seats)) {
  if (seat.status === 'booked' && !owners.has(seatId)) violations.push(`seat ${seatId} is booked with no booking record`);
}
// Occupancy mode's own promise: the room is never over capacity.
if (mode === 'occupancy' && metrics.peakInside > capacity) {
  violations.push(`peak people inside was ${metrics.peakInside}, over capacity ${capacity}`);
}

console.log(`\nFinished in ${elapsed}s`);
console.table(metrics.counterTable());
console.table(metrics.latencyTable());
console.log(`Peak people inside: ${metrics.peakInside}${mode === 'occupancy' ? ` (capacity ${capacity})` : ''}`);
if (coordinator) {
  const { nowServingWrites, admitted, peakInside } = coordinator.stats;
  console.log(`Coordinator: ${nowServingWrites} nowServing writes, ${admitted} admitted, peak inside as it counted them: ${peakInside}`);
}
console.log(`Queue tickets issued: ${tickets.length}, seats booked: ${owners.size}/${totalSeats}`);

if (violations.length) {
  console.error('\nINVARIANT VIOLATIONS:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exitCode = 1;
} else {
  console.log(
    `\nAll invariants held: unique contiguous tickets, at most one booking per seat${mode === 'occupancy' ? ', peak inside <= capacity' : ''}.`,
  );
}
await admin.close();
// The client SDK instances can keep the event loop alive after deleteApp(); the work is done, so exit.
process.exit(process.exitCode ?? 0);
