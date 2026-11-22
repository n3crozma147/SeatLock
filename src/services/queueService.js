import { get, ref, update } from 'firebase/database';
import { jitteredBackoff, sleep } from '../lib/backoff.js';
import { ErrorCode, isPermissionDenied, SeatLockError } from '../lib/errors.js';
import { counterPath, ticketPath } from '../lib/paths.js';

export function createQueueService(db) {
  async function getTicket(eventId, uid) {
    const snap = await get(ref(db, ticketPath(eventId, uid)));
    return snap.exists() ? snap.val() : null;
  }

  /**
   * Take the next queue ticket with an optimistic compare-and-set:
   * read counter n, then atomically write { counter: n + 1, myTicket: n }.
   * The rules reject the write if anyone else already took n, and we retry.
   * Idempotent: if this user already has a ticket, that ticket is returned.
   */
  async function takeTicket(eventId, uid, { maxAttempts = 25, onRetry } = {}) {
    const existing = await getTicket(eventId, uid);
    if (existing !== null) return existing;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const n = (await get(ref(db, counterPath(eventId)))).val() ?? 0;
      try {
        await update(ref(db), {
          [counterPath(eventId)]: n + 1,
          [ticketPath(eventId, uid)]: n,
        });
        return n;
      } catch (err) {
        if (!isPermissionDenied(err)) throw err;
        // Lost the race, or a concurrent call from this same user already won.
        const mine = await getTicket(eventId, uid);
        if (mine !== null) return mine;
        onRetry?.(attempt + 1);
        await sleep(jitteredBackoff(attempt));
      }
    }
    throw new SeatLockError(ErrorCode.QUEUE_CONTENDED, 'The queue is very busy. Reload to try again.');
  }

  return { getTicket, takeTicket };
}
