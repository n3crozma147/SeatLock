import { onChildAdded, onChildChanged, onChildRemoved, ref, serverTimestamp, update } from 'firebase/database';
import { ErrorCode, isPermissionDenied, SeatLockError } from '../lib/errors.js';
import { bookingPath, seatPath, seatsPath } from '../lib/paths.js';

export function createSeatService(db) {
  /** Streams seat changes. Child events mean one change ships one seat, not the whole map. */
  function subscribeSeats(eventId, { onUpsert, onRemove }) {
    const seatsRef = ref(db, seatsPath(eventId));
    const unsubscribers = [
      onChildAdded(seatsRef, (snap) => onUpsert(snap.key, snap.val())),
      onChildChanged(seatsRef, (snap) => onUpsert(snap.key, snap.val())),
      onChildRemoved(seatsRef, (snap) => onRemove(snap.key)),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /**
   * Hold several seats in one multi-path update. The rules check every seat,
   * and if any one is taken (or the user is not admitted) the whole write fails.
   */
  async function holdSeats(eventId, seatIds, uid) {
    const updates = {};
    for (const id of seatIds) {
      updates[seatPath(eventId, id)] = { status: 'held', holder: uid, lockedAt: serverTimestamp() };
    }
    try {
      await update(ref(db), updates);
    } catch (err) {
      if (isPermissionDenied(err)) {
        throw new SeatLockError(ErrorCode.HOLD_REJECTED, 'Those seats could not be held.', err);
      }
      throw err;
    }
  }

  async function releaseSeats(eventId, seatIds) {
    const updates = {};
    for (const id of seatIds) updates[seatPath(eventId, id)] = null;
    await update(ref(db), updates);
  }

  /**
   * held → booked for every seat, plus the user's booking records, in one atomic write.
   * Child-path updates leave holder and lockedAt untouched, which the rules require.
   */
  async function confirmBooking(eventId, seatIds, uid) {
    const updates = {};
    for (const id of seatIds) {
      updates[`${seatPath(eventId, id)}/status`] = 'booked';
      updates[`${seatPath(eventId, id)}/bookedAt`] = serverTimestamp();
      updates[bookingPath(eventId, uid, id)] = { bookedAt: serverTimestamp() };
    }
    try {
      await update(ref(db), updates);
    } catch (err) {
      if (isPermissionDenied(err)) {
        throw new SeatLockError(ErrorCode.CONFIRM_REJECTED, 'Your hold expired before payment finished.', err);
      }
      throw err;
    }
  }

  return { subscribeSeats, holdSeats, releaseSeats, confirmBooking };
}
