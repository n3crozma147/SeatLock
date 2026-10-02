import { useMemo } from 'react';
import { compareSeatIds } from '../lib/seatLayout.js';
import { deriveSeatStatus, holdExpiresAt, SeatStatus } from '../lib/seatState.js';

/** My active holds, my bookings, and how long the hold has left. */
export function useHold(seats, version, uid, ttlMs, now) {
  return useMemo(() => {
    const heldIds = [];
    const bookedIds = [];
    let expiresAt = Infinity;
    for (const [id, seat] of seats) {
      const status = deriveSeatStatus(seat, now, uid, ttlMs);
      if (status === SeatStatus.MINE) {
        heldIds.push(id);
        expiresAt = Math.min(expiresAt, holdExpiresAt(seat, ttlMs));
      } else if (status === SeatStatus.MINE_BOOKED) {
        bookedIds.push(id);
      }
    }
    heldIds.sort(compareSeatIds);
    bookedIds.sort(compareSeatIds);
    return { heldIds, bookedIds, msRemaining: heldIds.length ? Math.max(0, expiresAt - now) : 0 };
    // `version` changes whenever the mutable `seats` Map does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, version, uid, ttlMs, now]);
}
