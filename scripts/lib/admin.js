// Admin SDK helpers. Admin access bypasses security rules, so this code only
// ever runs on your machine: never import it from src/.

import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { MAX_COLS, MAX_ROWS } from '../../src/lib/seatLayout.js';
import { allBookingsPath, counterPath, eventPath, seatsPath, ticketsPath } from '../../src/lib/paths.js';

export const DEFAULT_PROJECT = 'demo-seatlock';
export const EMULATOR_DB_HOST = '127.0.0.1:9000';

/**
 * Emulator by default. Pass { prod: true } to target a real project; that uses
 * GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON you never commit).
 */
export function connectAdmin({ prod = false, projectId = DEFAULT_PROJECT, databaseURL } = {}) {
  if (!prod) process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= EMULATOR_DB_HOST;
  const app = initializeApp({
    projectId,
    databaseURL: databaseURL ?? `https://${projectId}-default-rtdb.firebaseio.com`,
    ...(prod ? { credential: applicationDefault() } : {}),
  });
  return { app, db: getDatabase(app), close: () => deleteApp(app) };
}

export function buildEventConfig(overrides = {}) {
  const config = {
    name: 'Opening night',
    rows: 10,
    cols: 16,
    ttlMs: 120_000,
    batch: 5,
    intervalMs: 10_000,
    maxSeats: 4,
    saleStart: Date.now(),
    ...overrides,
  };
  const problems = [];
  if (!(config.rows >= 1 && config.rows <= MAX_ROWS)) problems.push(`rows must be 1..${MAX_ROWS}`);
  if (!(config.cols >= 1 && config.cols <= MAX_COLS)) problems.push(`cols must be 1..${MAX_COLS}`);
  for (const key of ['ttlMs', 'batch', 'intervalMs', 'maxSeats']) {
    if (!(Number.isFinite(config[key]) && config[key] > 0)) problems.push(`${key} must be a positive number`);
  }
  if (problems.length) throw new Error(`Invalid event config: ${problems.join('; ')}`);
  return config;
}

/** Create (or wipe and recreate) an event: config, counter, and all seats, tickets, bookings. */
export async function seedEvent(db, eventId, config) {
  await db.ref().update({
    [eventPath(eventId)]: config,
    [counterPath(eventId)]: 0,
    [seatsPath(eventId)]: null,
    [ticketsPath(eventId)]: null,
    [allBookingsPath(eventId)]: null,
  });
}
