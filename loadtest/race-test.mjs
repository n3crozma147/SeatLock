// SeatLock race test: N concurrent clients all try to grab the SAME seat.
// Pass condition: for every seat, exactly ONE client wins, and the database
// agrees with that winner.
//
// Two modes:
//   emulator (no cloud account):  LOADTEST_EMULATOR=1 node loadtest/race-test.mjs
//   your real Firebase project:   node --env-file=.env loadtest/race-test.mjs
//
// Knobs: CLIENTS (default 25), ROUNDS (default 20).
//
// What it does NOT test: the React UI, real network latency, or 25 separate
// machines. The lock logic below is a copy of lockSeat() in
// src/hooks/useSeatLock.js (keep them in sync).

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  runTransaction,
  connectDatabaseEmulator,
} from 'firebase/database';

const CLIENTS = Number(process.env.CLIENTS || 25);
const ROUNDS = Number(process.env.ROUNDS || 20);
const USE_EMULATOR = process.env.LOADTEST_EMULATOR === '1';
const SEAT_LOCK_TTL_MS = 90 * 1000; // same as src/config.js

// A fresh event per run, so we never touch the real "demo-event" data.
const EVENT_ID = `loadtest-${Date.now()}`;
const seatsPath = `events/${EVENT_ID}/seats`;

// ---------------------------------------------------------------- config
function buildConfig() {
  if (USE_EMULATOR) {
    return {
      apiKey: 'fake-api-key',
      projectId: 'demo-seatlock',
      databaseURL: 'https://demo-seatlock-default-rtdb.firebaseio.com',
    };
  }
  const e = process.env;
  const cfg = {
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: e.VITE_FIREBASE_DATABASE_URL,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  };
  if (!cfg.apiKey || !cfg.databaseURL) {
    console.error(
      'Missing VITE_FIREBASE_* variables. Run with: node --env-file=.env loadtest/race-test.mjs\n' +
        '(or use LOADTEST_EMULATOR=1 for the local emulator)'
    );
    process.exit(2);
  }
  return cfg;
}

const apps = [];

async function makeClient(name, { signIn }) {
  const app = initializeApp(buildConfig(), name);
  apps.push(app);
  const db = getDatabase(app);
  let uid = null;
  const auth = getAuth(app);
  if (USE_EMULATOR) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
  if (signIn) {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
  }
  return { name, db, uid };
}

// ----------------------------------------------- copy of the app's lockSeat
// Returns { outcome, attempts } where outcome is one of:
//   won      - committed and the seat now belongs to me
//   taken    - committed, but the seat belongs to someone else
//   aborted  - transaction reported committed:false
//   error:X  - the database rejected the write (e.g. PERMISSION_DENIED)
function lockSeat(client, seatId) {
  const seatRef = ref(client.db, `${seatsPath}/${seatId}`);
  let attempts = 0;
  return runTransaction(seatRef, (seat) => {
    attempts += 1;
    if (!seat) return seat;
    if (seat.status === 'sold') return undefined; // abort
    const lockValid = seat.status === 'locked' && seat.lockExpiresAt >= Date.now();
    if (lockValid && seat.lockedBy !== client.uid) return undefined; // abort
    seat.status = 'locked';
    seat.lockedBy = client.uid;
    seat.lockExpiresAt = Date.now() + SEAT_LOCK_TTL_MS;
    return seat;
  })
    .then((result) => {
      if (!result.committed) return { outcome: 'aborted', attempts };
      const val = result.snapshot.val();
      if (!val || val.lockedBy !== client.uid) return { outcome: 'taken', attempts };
      return { outcome: 'won', attempts };
    })
    .catch((err) => ({ outcome: `error:${err.code || err.message}`, attempts }));
}

// ------------------------------------------------------------------ helpers
function newSeat(row, col) {
  return {
    label: `R${row}C${col}`,
    row,
    col,
    price: 75,
    status: 'available',
    lockedBy: null,
    lockExpiresAt: null,
    soldTo: null,
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);
}

function tally(list) {
  const t = {};
  for (const x of list) t[x] = (t[x] || 0) + 1;
  return t;
}

// ------------------------------------------------------------------- main
async function main() {
  console.log(
    `Mode: ${USE_EMULATOR ? 'LOCAL EMULATOR (rules loaded from database.rules.json)' : 'REAL FIREBASE PROJECT'}`
  );
  console.log(`Event: ${EVENT_ID} | clients: ${CLIENTS} | rounds: ${ROUNDS}\n`);

  // 1. Create N shoppers (each with its own anonymous identity) + a verifier
  //    with no listeners, so its reads come from the server, not a local cache.
  const clients = await withTimeout(
    Promise.all(Array.from({ length: CLIENTS }, (_, i) => makeClient(`shopper-${i}`, { signIn: true }))),
    60000,
    'sign-in'
  );
  const verifier = await makeClient('verifier', { signIn: false });
  console.log(`Signed in ${clients.length} anonymous shoppers (distinct uids: ${new Set(clients.map((c) => c.uid)).size}).`);

  // 2. Seed test seats one by one (the rules allow creating a seat that
  //    doesn't exist yet).
  const seedRef = (id) => ref(clients[0].db, `${seatsPath}/${id}`);
  const lockIds = Array.from({ length: ROUNDS }, (_, r) => `lock-${r + 1}`);
  const rawIds = Array.from({ length: ROUNDS }, (_, r) => `raw-${r + 1}`);
  const probeIds = ['probe-expiry', 'probe-sold'];
  await withTimeout(
    Promise.all(
      [...lockIds, ...rawIds, ...probeIds].map((id, i) => set(seedRef(id), newSeat(1, i + 1)))
    ),
    60000,
    'seeding'
  );

  // 3. Like the real app, every client keeps a live listener (warm cache).
  await withTimeout(
    Promise.all(
      clients.map(
        (c) =>
          new Promise((resolve) => {
            let first = true;
            onValue(ref(c.db, seatsPath), () => {
              if (first) {
                first = false;
                resolve();
              }
            });
          })
      )
    ),
    60000,
    'listeners'
  );

  let failures = 0;

  // ---------------------------------------------------------------- TEST A
  console.log('\n=== TEST A: all clients run the app\'s lockSeat() on the same seat ===');
  let totalRetries = 0;
  for (const seatId of lockIds) {
    const results = await withTimeout(
      Promise.all(clients.map((c) => lockSeat(c, seatId))),
      60000,
      `race ${seatId}`
    );
    const outcomes = results.map((r) => r.outcome);
    const winners = clients.filter((_, i) => outcomes[i] === 'won');
    totalRetries += results.reduce((s, r) => s + Math.max(0, r.attempts - 1), 0);

    const server = (await get(ref(verifier.db, `${seatsPath}/${seatId}`))).val();
    // Besides "exactly one winner", losers must be told cleanly (aborted/taken),
    // never via a thrown error: that was the bug the first version of this test found.
    const noErrors = outcomes.every((o) => !o.startsWith('error'));
    const ok =
      winners.length === 1 &&
      noErrors &&
      server.status === 'locked' &&
      server.lockedBy === winners[0].uid;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${seatId}: winners=${winners.length}  server.lockedBy matches winner=${
        winners.length === 1 && server.lockedBy === winners[0].uid
      }  outcomes=${JSON.stringify(tally(outcomes))}`
    );
  }
  console.log(`(extra transaction re-runs caused by conflicts across all rounds: ${totalRetries})`);

  // ---------------------------------------------------------------- TEST B
  console.log('\n=== TEST B: raw writes, NO transaction (can the RULES alone stop double-booking?) ===');
  for (const seatId of rawIds) {
    const settled = await withTimeout(
      Promise.allSettled(
        clients.map((c) =>
          set(ref(c.db, `${seatsPath}/${seatId}`), {
            ...newSeat(1, 0),
            status: 'locked',
            lockedBy: c.uid,
            lockExpiresAt: Date.now() + SEAT_LOCK_TTL_MS,
          })
        )
      ),
      60000,
      `raw race ${seatId}`
    );
    const fulfilledIdx = settled.map((s, i) => (s.status === 'fulfilled' ? i : -1)).filter((i) => i >= 0);
    const reasons = tally(settled.filter((s) => s.status === 'rejected').map((s) => s.reason.code || s.reason.message));
    const server = (await get(ref(verifier.db, `${seatsPath}/${seatId}`))).val();
    const ok =
      fulfilledIdx.length === 1 && server.lockedBy === clients[fulfilledIdx[0]].uid;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${seatId}: accepted writes=${fulfilledIdx.length}  rejected=${JSON.stringify(reasons)}`
    );
  }

  // --------------------------------------------- TEST C: known limitations
  console.log('\n=== TEST C: probes of limitations I claimed from reading the code (informational) ===');
  const c0 = clients[0];

  console.log(
    `Probe 1 - none of the ${CLIENTS} clients ever joined the queue, yet Test A shows one of them locked each seat.\n` +
      '          => admission is NOT enforced by the database.'
  );

  const tryExpiry = async (label, lockExpiresAt) => {
    try {
      await set(ref(c0.db, `${seatsPath}/probe-expiry`), {
        ...newSeat(1, 99),
        status: 'locked',
        lockedBy: c0.uid,
        lockExpiresAt,
      });
      return `${label}: ACCEPTED`;
    } catch (e) {
      return `${label}: REJECTED (${e.code || e.message})`;
    }
  };
  console.log('Probe 2 - lock expiry cap (rule allows at most server-now + 2 min):');
  console.log('   ' + (await tryExpiry('year 2286          ', 9999999999999)) + '   <- should be REJECTED');
  console.log('   ' + (await tryExpiry('now + 10 minutes   ', Date.now() + 10 * 60 * 1000)) + '   <- should be REJECTED');
  console.log('   ' + (await tryExpiry('now + 90s (normal) ', Date.now() + SEAT_LOCK_TTL_MS)) + '   <- should be ACCEPTED');

  try {
    await set(ref(c0.db, `${seatsPath}/probe-sold`), {
      ...newSeat(1, 98),
      status: 'sold',
      soldTo: c0.uid,
    });
    console.log('Probe 3 - mark an available seat SOLD without locking it: ACCEPTED => locking is not mandatory.');
  } catch (e) {
    console.log(`Probe 3 - mark available seat SOLD directly: REJECTED (${e.code || e.message}).`);
  }

  try {
    await set(ref(clients[1].db, `${seatsPath}/probe-sold`), {
      ...newSeat(1, 98),
      status: 'locked',
      lockedBy: clients[1].uid,
      lockExpiresAt: Date.now() + SEAT_LOCK_TTL_MS,
    });
    console.log('Probe 4 - overwrite a SOLD seat: ACCEPTED  <-- would be a double-booking hole!');
    failures += 1;
  } catch (e) {
    console.log(`Probe 4 - overwrite a SOLD seat: REJECTED (${e.code || e.message}) => "sold is final" holds.`);
  }

  // ----------------------------------------------------------------- result
  console.log(
    `\nRESULT: ${failures === 0 ? 'PASS' : 'FAIL'} - ${ROUNDS} app-logic rounds + ${ROUNDS} raw-write rounds, ${CLIENTS} clients each, double-bookings detected: ${failures}`
  );
  return failures === 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    await Promise.all(apps.map((a) => deleteApp(a).catch(() => {})));
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('Test crashed:', err);
    await Promise.all(apps.map((a) => deleteApp(a).catch(() => {})));
    process.exit(2);
  });
