#!/usr/bin/env node
// Occupancy-admission coordinator: the single writer of counters/{event}/nowServing.
//
// Usage:
//   npm run seed -- --mode occupancy --capacity 20     # an event in occupancy mode
//   npm run coordinator                                # then run this next to the emulators
//   npm run coordinator -- --event demo --sweep 500 --min-write 250 --window 240000
//   npm run coordinator -- --prod --project my-proj --database-url https://my-proj-default-rtdb.<region>.firebasedatabase.app
//
// Safe to restart: all state is rebuilt from the database.

import { connectAdmin, DEFAULT_PROJECT } from './lib/admin.js';
import { num, parseArgs } from './lib/args.js';
import { startCoordinator } from './lib/coordinator.js';

const args = parseArgs();
const eventId = args.event ?? 'demo';

const { db, close } = connectAdmin({
  prod: Boolean(args.prod),
  projectId: args.project ?? DEFAULT_PROJECT,
  databaseURL: args['database-url'],
});

const stamp = () => new Date().toLocaleTimeString();
const coordinator = startCoordinator({
  db,
  eventId,
  sweepMs: num(args.sweep, 500),
  minWriteIntervalMs: num(args['min-write'], 250),
  windowMs: args.window === undefined ? undefined : num(args.window, undefined),
  log: (message) => console.log(`[${stamp()}] ${message}`),
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await coordinator.stop();
  console.log(`\nStopped. ${coordinator.stats.nowServingWrites} nowServing writes, ${coordinator.stats.admitted} people admitted.`);
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await coordinator.ready;
} catch (err) {
  console.error('Coordinator failed to start:', err.message);
  await close();
  process.exit(1);
}
