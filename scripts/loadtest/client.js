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

export async function runClient(index, { projectId, eventId, event, confirmRate, maxHoldAttempts }, metrics) {
  const app = initializeApp(
    {
      apiKey: 'demo-api-key',
      projectId,
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    },
    `loadtest-${index}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000);

  const queue = createQueueService(db);
  const seatsApi = createSeatService(db);
  const allSeatIds = generateLayout(event.rows, event.cols).flatMap((row) => row.seats);

  try {
    const { user } = await metrics.time('sign in', () => signInAnonymously(auth));
    const uid = user.uid;

    let retries = 0;
    const ticket = await metrics.time('take ticket', () =>
      queue.takeTicket(eventId, uid, { maxAttempts: 200, onRetry: (n) => (retries = n) }),
    );
    metrics.count('ticket CAS retries', retries);

    // Wait our turn. Local and emulator clocks are the same machine here.
    await sleep(msUntilAdmission(ticket, event, Date.now()) + 50);

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
    await deleteApp(app);
  }
}
