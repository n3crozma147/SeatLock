import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

// A separate "demo-" project so tests never touch your dev data.
export const PROJECT_ID = 'demo-seatlock-test';
export const EVENT = 'e1';

/** Server-side timestamp placeholder; works with any Firebase SDK. */
export const TS = { '.sv': 'timestamp' };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function setupEnv() {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000').split(':');
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules: readFileSync('database.rules.json', 'utf8'), host, port: Number(port) },
  });
}

/** Fresh database with one event whose sale started a minute ago. */
export async function seed(env, overrides = {}) {
  await env.clearDatabase();
  const event = {
    name: 'Test event',
    rows: 2,
    cols: 4,
    ttlMs: 2000,
    batch: 1,
    intervalMs: 1000,
    maxSeats: 4,
    saleStart: Date.now() - 60_000, // tickets 0..60 are admitted
    ...overrides,
  };
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().update({
      [`events/${EVENT}`]: event,
      [`counters/${EVENT}/nextTicket`]: 0,
    });
  });
  return event;
}

/** Bypass the queue for tests that only care about seats. */
export async function giveTicket(env, uid, ticket) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(`tickets/${EVENT}/${uid}`).set(ticket);
  });
}

export async function adminRead(env, path) {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => {
    value = (await ctx.database().ref(path).once('value')).val();
  });
  return value;
}

export const dbAs = (env, uid) => env.authenticatedContext(uid).database();
export const seatRef = (db, seatId = 'A1') => db.ref(`seats/${EVENT}/${seatId}`);
export const heldBy = (uid) => ({ status: 'held', holder: uid, lockedAt: TS });

export const confirmUpdate = (uid, seatId = 'A1') => ({
  [`seats/${EVENT}/${seatId}/status`]: 'booked',
  [`seats/${EVENT}/${seatId}/bookedAt`]: TS,
  [`bookings/${EVENT}/${uid}/${seatId}`]: { bookedAt: TS },
});
