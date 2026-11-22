// How a client interprets a raw seat node. Mirrors the security rules:
// a hold whose lockedAt + ttlMs < now is treated exactly like an absent seat.

export const SeatStatus = Object.freeze({
  FREE: 'free',
  MINE: 'mine', // held by me, hold still active
  HELD: 'held', // held by someone else, hold still active
  BOOKED: 'booked', // sold to someone else
  MINE_BOOKED: 'mine-booked', // sold to me
});

export function holdExpiresAt(seat, ttlMs) {
  return seat.lockedAt + ttlMs;
}

export function isHoldActive(seat, nowMs, ttlMs) {
  return seat?.status === 'held' && holdExpiresAt(seat, ttlMs) >= nowMs;
}

export function deriveSeatStatus(seat, nowMs, uid, ttlMs) {
  if (!seat) return SeatStatus.FREE;
  if (seat.status === 'booked') {
    return seat.holder === uid ? SeatStatus.MINE_BOOKED : SeatStatus.BOOKED;
  }
  if (isHoldActive(seat, nowMs, ttlMs)) {
    return seat.holder === uid ? SeatStatus.MINE : SeatStatus.HELD;
  }
  return SeatStatus.FREE;
}
