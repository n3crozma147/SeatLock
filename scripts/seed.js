#!/usr/bin/env node
// Usage:
//   npm run seed                                   # demo event on the emulator
//   npm run seed -- --event demo --rows 8 --cols 12 --ttl 60000 --batch 2 --interval 15000 --start-in 30000
//   npm run seed -- --prod --project my-proj --database-url https://my-proj-default-rtdb.asia-southeast1.firebasedatabase.app
//
// Seeding always resets the event: seats, tickets and bookings are wiped.

import { buildEventConfig, connectAdmin, DEFAULT_PROJECT, seedEvent } from './lib/admin.js';
import { num, parseArgs } from './lib/args.js';

const args = parseArgs();
const eventId = args.event ?? 'demo';

const config = buildEventConfig({
  ...(args.name ? { name: args.name } : {}),
  rows: num(args.rows, 10),
  cols: num(args.cols, 16),
  ttlMs: num(args.ttl, 120_000),
  batch: num(args.batch, 5),
  intervalMs: num(args.interval, 10_000),
  maxSeats: num(args['max-seats'], 4),
  saleStart: Date.now() + num(args['start-in'], 0),
});

const { db, close } = connectAdmin({
  prod: Boolean(args.prod),
  projectId: args.project ?? DEFAULT_PROJECT,
  databaseURL: args['database-url'],
});

try {
  await seedEvent(db, eventId, config);
  console.log(`Seeded event "${eventId}" (${config.rows}x${config.cols} seats)`);
  console.table({
    ttl: `${config.ttlMs / 1000}s`,
    admission: `${config.batch} every ${config.intervalMs / 1000}s`,
    'sale starts': new Date(config.saleStart).toLocaleTimeString(),
    'max seats per person': config.maxSeats,
  });
} catch (err) {
  console.error('Seeding failed:', err.message);
  process.exitCode = 1;
} finally {
  await close();
}
