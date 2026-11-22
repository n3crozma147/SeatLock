import { useCallback, useEffect, useState } from 'react';
import { ref, onValue, runTransaction } from 'firebase/database';
import { db } from '../firebase.js';
import { EVENT_ID, SEAT_LOCK_TTL_MS } from '../config.js';

const seatsPath = `events/${EVENT_ID}/seats`;

export function useSeats() {
  const [seats, setSeats] = useState({});

  useEffect(() => {
    const unsub = onValue(ref(db, seatsPath), (snap) => {
      setSeats(snap.val() || {});
    });
    return () => unsub();
  }, []);

  return seats;
}

// A seat is "effectively available" if it's marked available, or it's
// marked locked but the lock's TTL has passed and nobody has swept it yet.
// The transaction below re-checks this at write time, which is what
// actually prevents double-booking — the read here is just for display.
export function isEffectivelyAvailable(seat) {
  if (!seat) return false;
  if (seat.status === 'available') return true;
  if (seat.status === 'locked' && seat.lockExpiresAt < Date.now()) return true;
  return false;
}

export function useSeatLock(uid) {
  // Attempt to claim a seat. Resolves { ok: true } or { ok: false, reason }.
  const lockSeat = useCallback(
    (seatId) => {
      if (!uid) return Promise.resolve({ ok: false, reason: 'not-authed' });
      const seatRef = ref(db, `${seatsPath}/${seatId}`);
      return runTransaction(seatRef, (seat) => {
        // First run can see an empty local cache (null). Returning it makes
        // Firebase re-run this function with the real server value. Do NOT
        // return undefined here or the transaction would abort without ever
        // seeing the server's data.
        if (!seat) return seat;
        // Returning `undefined` is the only way to ABORT a transaction.
        // (Returning `seat` unchanged is a no-op *write*, which the security
        // rules reject with PERMISSION_DENIED for sold/held seats.)
        if (seat.status === 'sold') return undefined; // abort: already sold
        const lockValid =
          seat.status === 'locked' && seat.lockExpiresAt >= Date.now();
        if (lockValid && seat.lockedBy !== uid) return undefined; // abort: held by someone else

        seat.status = 'locked';
        seat.lockedBy = uid;
        seat.lockExpiresAt = Date.now() + SEAT_LOCK_TTL_MS;
        return seat;
      })
        .then((result) => {
          if (!result.committed) return { ok: false, reason: 'taken' };
          const val = result.snapshot.val();
          if (!val || val.lockedBy !== uid) {
            return { ok: false, reason: 'taken' };
          }
          return { ok: true };
        })
        // Network failure or a rules rejection: report it instead of leaving
        // an unhandled promise rejection with no feedback for the user.
        .catch((err) => ({ ok: false, reason: 'error', error: err }));
    },
    [uid]
  );

  const releaseSeat = useCallback(
    (seatId) => {
      if (!uid || !seatId) return Promise.resolve();
      const seatRef = ref(db, `${seatsPath}/${seatId}`);
      return runTransaction(seatRef, (seat) => {
        if (!seat) return seat;
        // Only the current holder may release. Anything else: abort, so we
        // never send a pointless write that the rules would reject.
        if (!(seat.status === 'locked' && seat.lockedBy === uid)) return undefined;
        seat.status = 'available';
        seat.lockedBy = null;
        seat.lockExpiresAt = null;
        return seat;
      });
    },
    [uid]
  );

  const confirmPurchase = useCallback(
    (seatId) => {
      if (!uid || !seatId) return Promise.resolve({ ok: false });
      const seatRef = ref(db, `${seatsPath}/${seatId}`);
      return runTransaction(seatRef, (seat) => {
        if (!seat) return seat;
        const stillMine =
          seat.status === 'locked' &&
          seat.lockedBy === uid &&
          seat.lockExpiresAt >= Date.now();
        if (!stillMine) return undefined; // abort: lock expired or lost
        seat.status = 'sold';
        seat.soldTo = uid;
        seat.lockedBy = null;
        seat.lockExpiresAt = null;
        return seat;
      })
        .then((result) => {
          if (!result.committed) return { ok: false, reason: 'lock-expired' };
          const val = result.snapshot.val();
          return val && val.status === 'sold' && val.soldTo === uid
            ? { ok: true }
            : { ok: false, reason: 'lock-expired' };
        })
        .catch((err) => ({ ok: false, reason: 'error', error: err }));
    },
    [uid]
  );

  return { lockSeat, releaseSeat, confirmPurchase };
}
