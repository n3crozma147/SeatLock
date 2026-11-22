import { describe, expect, it } from 'vitest';
import { deriveSeatStatus, SeatStatus } from '../../src/lib/seatState.js';

const TTL = 120_000;
const NOW = 1_000_000;

describe('deriveSeatStatus', () => {
  it('treats a missing seat as free', () => {
    expect(deriveSeatStatus(undefined, NOW, 'me', TTL)).toBe(SeatStatus.FREE);
  });

  it("distinguishes my active hold from someone else's", () => {
    const seat = { status: 'held', holder: 'me', lockedAt: NOW - 1000 };
    expect(deriveSeatStatus(seat, NOW, 'me', TTL)).toBe(SeatStatus.MINE);
    expect(deriveSeatStatus(seat, NOW, 'you', TTL)).toBe(SeatStatus.HELD);
  });

  it('keeps a hold active up to and including lockedAt + ttl (matches the confirm rule)', () => {
    const seat = { status: 'held', holder: 'me', lockedAt: NOW - TTL };
    expect(deriveSeatStatus(seat, NOW, 'me', TTL)).toBe(SeatStatus.MINE);
  });

  it('treats an expired hold as free (lazy expiry, matches the acquire rule)', () => {
    const seat = { status: 'held', holder: 'you', lockedAt: NOW - TTL - 1 };
    expect(deriveSeatStatus(seat, NOW, 'me', TTL)).toBe(SeatStatus.FREE);
  });

  it('never expires a booking', () => {
    const seat = { status: 'booked', holder: 'me', lockedAt: 0, bookedAt: 1 };
    expect(deriveSeatStatus(seat, NOW, 'me', TTL)).toBe(SeatStatus.MINE_BOOKED);
    expect(deriveSeatStatus(seat, NOW, 'you', TTL)).toBe(SeatStatus.BOOKED);
  });
});
