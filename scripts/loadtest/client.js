// One simulated fan. Uses the app's real service code against the emulator,
// so the load test exercises exactly what the browser does.

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, get, getDatabase, ref } from 'firebase/database';
import { msUntilAdmission } from '../../src/lib/admission.js';
import { sleep } from '../../src/lib/backoff.js';
import { ErrorCode } from '../../src/lib/errors.js';
import { seatsPath } from '../../src/lib/paths.js';
import { generateLayout } from '../../src/lib/seatLayout.js';
import { deriveSeatStatus, SeatStatus } from '../../src/lib/seatState.js';
import { createQueueService } from '../../src/services/queueService.js';
import { createSeatService } from '../../src/services/seatService.js';

const pick = (items, k) => [...items].sort(() => Math.random() - 0.5).slice(0, k);

// Occupancy mode: wait until the coordinator's nowServing passes our ticket, exactly like the
// browser does (one listener on one number). Resolves false if `signal` aborts first (sale ended).
function waitUntilServed(queue, eventId, ticket, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let unsubscribe = () => {};
    const onAbort = () => finish(false);
    function finish(served) {
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      resolve(served);
    }
    signal?.addEventListener('abort', onAbort);
    unsubscribe = queue.subscribeNowServing(
      eventId,
      (nowServing) => {
        if (ticket < nowServing) finish(true);
      },
      reject,
    );
  });
}

// Standard emulator env vars, defaulting to the ports in firebase.json.
function hostPort(value, fallbackHost, fallbackPort) {
  const [host, port] = (value ?? `${fallbackHost}:${fallbackPort}`).split(':');
  return { host, port: Number(port) };
}

export async function runClient(
  index,
  { projectId, eventId, event, confirmRate, maxHoldAttempts, dwellMs = 0, signal },
  metrics,
) {
  const app = initializeApp(
    {
      apiKey: 'demo-api-key',
      projectId,
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    },
    `loadtest-${index}`,
  );
  const auth = getAuth(app);
  const authHost = hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1', 9099);
  connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, { disableWarnings: true });
  const db = getDatabase(app);
  const dbHost = hostPort(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1', 9000);
  connectDatabaseEmulator(db, dbHost.host, dbHost.port);

  const queue = createQueueService(db);
  const seatsApi = createSeatService(db);
  const allSeatIds = generateLayout(event.rows, event.cols).flatMap((row) => row.seats);

  let inside = false;
  try {
    const { user } = await metrics.time('sign in', () => signInAnonymously(auth));
    const uid = user.uid;

    let retries = 0;
    const ticket = await metrics.time('take ticket', () =>
      queue.takeTicket(eventId, uid, { maxAttempts: 200, onRetry: (n) => (retries = n) }),
    );
    metrics.count('ticket CAS retries', retries);

    if (event.admissionMode === 'occupancy') {
      // Wait for the coordinator to let us in.
      const served = await waitUntilServed(queue, eventId, ticket, signal);
      if (!served) {
        metrics.count('left queue: sale ended');
        return;
      }
    } else {
      // Wait our turn. Local and emulator clocks are the same machine here.
      await sleep(msUntilAdmission(ticket, event, Date.now()) + 50);
    }

    // We are in the room: from here until we finish, we count as "inside".
    metrics.enter();
    inside = true;
    if (dwellMs > 0) await sleep(dwellMs); // browsing the seat map before choosing

    const want = 1 + Math.floor(Math.random() * Math.min(2, event.maxSeats));
    for (let attempt = 0; attempt < maxHoldAttempts; attempt++) {
      const snap = await get(ref(db, seatsPath(eventId)));
      const current = snap.val() ?? {};
      const now = Date.now();
      // Most fans want the front rows, which is what creates contention.
      const free = allSeatIds.filter((id) => deriveSeatStatus(current[id], now, uid, event.ttlMs) === SeatStatus.FREE);
      if (free.length < want) {
        metrics.count('sold out before holding');
        return;
      }
      const front = free.slice(0, Math.max(want, Math.ceil(free.length / 4)));
      const chosen = pick(front, want);

      metrics.count('hold attempts');
      try {
        await metrics.time('hold', () => seatsApi.holdSeats(eventId, chosen, uid));
      } catch (err) {
        if (err.code !== ErrorCode.HOLD_REJECTED) throw err;
        metrics.count('hold conflicts');
        continue;
      }

      if (Math.random() < confirmRate) {
        await sleep(100 + Math.random() * 400); // "payment"
        await metrics.time('confirm', () => seatsApi.confirmBooking(eventId, chosen, uid));
        metrics.count('clients booked');
        metrics.count('seats booked', chosen.length);
      } else if (Math.random() < 0.5) {
        await seatsApi.releaseSeats(eventId, chosen);
        metrics.count('clients released');
      } else {
        metrics.count('clients abandoned hold'); // left to expire
      }
      return;
    }
    metrics.count('gave up after conflicts');
  } catch (err) {
    metrics.count(`error: ${err.code ?? err.message}`);
  } finally {
    if (inside) metrics.leave();
    await deleteApp(app);
  }
}
