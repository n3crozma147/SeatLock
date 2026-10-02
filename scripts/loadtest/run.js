#!/usr/bin/env node
// Thundering-herd test against the emulator. Start `npm run emulators` first.
//   npm run loadtest -- --clients 300 --rows 4 --cols 10
// Exits non-zero if any invariant is violated.

import { buildEventConfig, connectAdmin, DEFAULT_PROJECT, seedEvent } from '../lib/admin.js';
import { num, parseArgs } from '../lib/args.js';
import { allBookingsPath, seatsPath, ticketsPath } from '../../src/lib/paths.js';
import { runClient } from './client.js';
import { Metrics } from './metrics.js';

const args = parseArgs();
const clients = num(args.clients, 200);
const eventId = args.event ?? 'loadtest';
const projectId = DEFAULT_PROJECT;

const event = buildEventConfig({
  name: 'Load test',
  rows: num(args.rows, 4),
  cols: num(args.cols, 10),
  ttlMs: num(args.ttl, 30_000),
  batch: num(args.batch, 50), // admit quickly: the seat race is what we're testing
  intervalMs: num(args.interval, 1000),
  maxSeats: 4,
  saleStart: Date.now() + 2000,
});

const admin = connectAdmin({ projectId });
await seedEvent(admin.db, eventId, event);
console.log(`Seeded ${event.rows * event.cols} seats. Releasing ${clients} clients at once...`);

const metrics = new Metrics();
const started = performance.now();
await Promise.all(
  Array.from({ length: clients }, (_, i) =>
    runClient(i, { projectId, eventId, event, confirmRate: num(args['confirm-rate'], 0.8), maxHoldAttempts: 5 }, metrics),
  ),
);
const elapsed = ((performance.now() - started) / 1000).toFixed(1);

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

console.log(`\nFinished in ${elapsed}s`);
console.table(metrics.counterTable());
console.table(metrics.latencyTable());
console.log(`Queue tickets issued: ${tickets.length}, seats booked: ${owners.size}/${event.rows * event.cols}`);

if (violations.length) {
  console.error('\nINVARIANT VIOLATIONS:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exitCode = 1;
} else {
  console.log('\nAll invariants held: unique contiguous tickets, at most one booking per seat.');
}
await admin.close();
