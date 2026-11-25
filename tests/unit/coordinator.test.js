import { describe, expect, it } from 'vitest';
import { buildEventConfig } from '../../scripts/lib/admin.js';
import { assessAdmitted, computeNextServing, scanInside } from '../../scripts/lib/coordinator.js';

describe('computeNextServing', () => {
  const base = { nowServing: 0, nextTicket: 100, capacity: 10, inside: 0, soldOut: false };

  it('admits up to capacity when the room is empty', () => {
    expect(computeNextServing(base)).toBe(10);
  });

  it('admits nobody when the room is full', () => {
    expect(computeNextServing({ ...base, nowServing: 10, inside: 10 })).toBe(10);
  });

  it('admits exactly as many as have left (capacity freed)', () => {
    expect(computeNextServing({ ...base, nowServing: 10, inside: 7 })).toBe(13);
    expect(computeNextServing({ ...base, nowServing: 10, inside: 0 })).toBe(20);
  });

  it('never goes past the number of tickets issued', () => {
    expect(computeNextServing({ ...base, nextTicket: 4 })).toBe(4);
    expect(computeNextServing({ ...base, nowServing: 4, nextTicket: 4, inside: 0 })).toBe(4);
    expect(computeNextServing({ ...base, nextTicket: 0 })).toBe(0);
  });

  it('stops admitting once every seat is booked', () => {
    expect(computeNextServing({ ...base, nowServing: 25, inside: 0, soldOut: true })).toBe(25);
  });

  it('never moves backwards, even if the room is over capacity', () => {
    expect(computeNextServing({ ...base, nowServing: 30, inside: 50 })).toBe(30);
    expect(computeNextServing({ ...base, nowServing: 30, nextTicket: 20, inside: 0 })).toBe(30);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = { ...base, nowServing: 3, inside: 2 };
    const copy = { ...input };
    expect(computeNextServing(input)).toBe(computeNextServing(input));
    expect(input).toEqual(copy);
  });

  it('rejects nonsense input instead of admitting people', () => {
    expect(() => computeNextServing({ ...base, capacity: -1 })).toThrow(RangeError);
    expect(() => computeNextServing({ ...base, inside: Number.NaN })).toThrow(RangeError);
    expect(() => computeNextServing({ ...base, nextTicket: undefined })).toThrow(RangeError);
  });
});

describe('assessAdmitted: who is still inside', () => {
  const windowMs = 60_000;
  const ctx = (extra = {}) => ({ now: 1_030_000, windowMs, bookedUids: new Set(), holders: new Set(), ...extra });
  const person = { uid: 'u1', admittedAt: 1_000_000 };

  it('counts someone who was just admitted and is still browsing', () => {
    expect(assessAdmitted(person, ctx()).inside).toBe(true);
  });

  it('counts someone holding seats', () => {
    const verdict = assessAdmitted(person, ctx({ holders: new Set(['u1']) }));
    expect(verdict).toMatchObject({ inside: true, holding: true });
  });

  it('stops counting someone once they have a booking', () => {
    expect(assessAdmitted(person, ctx({ bookedUids: new Set(['u1']), holders: new Set(['u1']) })).inside).toBe(false);
  });

  it('stops counting someone who was seen holding and now holds nothing (released)', () => {
    expect(assessAdmitted({ ...person, held: true }, ctx()).inside).toBe(false);
  });

  it('keeps counting someone who has not been seen holding anything yet', () => {
    expect(assessAdmitted({ ...person, held: false }, ctx()).inside).toBe(true);
  });

  it('stops counting when the admission window expires, even if they still hold seats', () => {
    const late = ctx({ now: 1_000_000 + windowMs, holders: new Set(['u1']) });
    expect(assessAdmitted(person, late).inside).toBe(false);
    expect(assessAdmitted(person, { ...late, now: late.now - 1 }).inside).toBe(true);
  });
});

describe('scanInside: rebuilding the picture from the database (also what a restart does)', () => {
  const windowMs = 60_000;
  const NOW = 2_000_000;

  // Tickets 0..9 admitted. 0-2 admitted long ago (window over), 3 booked, 4 released,
  // 5 holding, 6-9 still browsing.
  function snapshot() {
    const admissions = new Map();
    for (let t = 0; t < 10; t++) {
      admissions.set(t, { uid: `u${t}`, admittedAt: t < 3 ? NOW - 500_000 : NOW - 10_000, ...(t === 4 ? { held: true } : {}) });
    }
    return {
      cursor: 0,
      nowServing: 10,
      admissions,
      ticketToUid: new Map(),
      bookedUids: new Set(['u3']),
      holders: new Set(['u5']),
      now: NOW,
      windowMs,
    };
  }

  it('counts only people still inside', () => {
    const scan = scanInside(snapshot());
    // u3 booked, u4 released, u0-u2 expired -> u5 (holding) + u6..u9 (browsing)
    expect(scan.inside).toBe(5);
  });

  it('skips tickets whose window is long over by advancing the cursor', () => {
    expect(scanInside(snapshot()).cursor).toBe(3);
  });

  it('reports who was newly seen holding so the held flag can be persisted', () => {
    expect(scanInside(snapshot()).newlyHolding).toEqual([5]);
  });

  it('gives the same answer from a fresh start as from an advanced cursor', () => {
    const fresh = scanInside(snapshot());
    const resumed = scanInside({ ...snapshot(), cursor: fresh.cursor });
    expect(resumed.inside).toBe(fresh.inside);
  });

  it('does not re-admit anyone after a restart: the next value continues from the stored nowServing', () => {
    const scan = scanInside(snapshot());
    // capacity 8, 5 inside -> room for 3 more, starting at the stored nowServing (10), not at 0.
    expect(computeNextServing({ nowServing: 10, nextTicket: 50, capacity: 8, inside: scan.inside })).toBe(13);
  });

  it('counts admitted tickets with no record as inside and reports them', () => {
    const snap = snapshot();
    snap.admissions.delete(8);
    const scan = scanInside(snap);
    expect(scan.missing).toEqual([8]);
    expect(scan.inside).toBe(5); // u8 still counted (conservative), same total as before
  });

  it('finds nobody inside before anyone has been admitted', () => {
    expect(scanInside({ ...snapshot(), nowServing: 0 }).inside).toBe(0);
  });
});

describe('simulated room: the coordinator can never overfill it', () => {
  it('keeps inside <= capacity while people arrive and leave', () => {
    const capacity = 7;
    const windowMs = 1000;
    const admissions = new Map();
    const finished = new Set();
    let nowServing = 0;
    let nextTicket = 0;
    let cursor = 0;
    let peak = 0;
    for (let step = 0; step < 400; step++) {
      const now = step * 100;
      nextTicket += step % 3 === 0 ? 5 : 0; // bursty arrivals
      // every 4th step the two oldest people inside confirm a booking
      const bookedUids = new Set(finished);
      const scan = scanInside({
        cursor,
        nowServing,
        admissions,
        ticketToUid: new Map(),
        bookedUids,
        holders: new Set(),
        now,
        windowMs,
      });
      cursor = scan.cursor;
      peak = Math.max(peak, scan.inside);
      expect(scan.inside).toBeLessThanOrEqual(capacity);
      const next = computeNextServing({ nowServing, nextTicket, capacity, inside: scan.inside });
      for (let t = nowServing; t < next; t++) admissions.set(t, { uid: `u${t}`, admittedAt: now });
      nowServing = next;
      if (step % 4 === 0) {
        let n = 0;
        for (let t = cursor; t < nowServing && n < 2; t++) {
          if (finished.has(`u${t}`)) continue;
          finished.add(`u${t}`);
          n++;
        }
      }
    }
    expect(peak).toBeGreaterThan(0);
    expect(nowServing).toBeLessThanOrEqual(nextTicket);
  });
});

describe('event config for admission modes', () => {
  it('defaults to time mode so existing events behave as before', () => {
    expect(buildEventConfig().admissionMode).toBe('time');
  });

  it('accepts occupancy mode with a capacity and rejects bad values', () => {
    expect(buildEventConfig({ admissionMode: 'occupancy', capacity: 20 })).toMatchObject({ admissionMode: 'occupancy', capacity: 20 });
    expect(() => buildEventConfig({ admissionMode: 'nope' })).toThrow(/admissionMode/);
    expect(() => buildEventConfig({ capacity: 0 })).toThrow(/capacity/);
    expect(() => buildEventConfig({ capacity: 2.5 })).toThrow(/capacity/);
  });
});
