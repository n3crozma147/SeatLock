import { describe, expect, it } from 'vitest';
import { admitAt, admittedCount, isAdmitted, msUntilAdmission, peopleAhead } from '../../src/lib/admission.js';

// 5 people every 10 seconds, starting at t = 100_000.
const event = { saleStart: 100_000, batch: 5, intervalMs: 10_000 };

describe('admission', () => {
  it('admits nobody before the sale starts', () => {
    expect(isAdmitted(0, event, 99_999)).toBe(false);
    expect(admittedCount(event, 99_999)).toBe(0);
  });

  it('admits ticket 0 exactly at saleStart', () => {
    expect(isAdmitted(0, event, 100_000)).toBe(true);
  });

  it('releases `batch` tickets per interval', () => {
    // After 10s: t * 10000 <= 10000 * 5  =>  t <= 5, so tickets 0..5 are in.
    expect(admittedCount(event, 110_000)).toBe(6);
    expect(isAdmitted(5, event, 110_000)).toBe(true);
    expect(isAdmitted(6, event, 110_000)).toBe(false);
  });

  it('admitAt is the first instant isAdmitted becomes true', () => {
    for (const ticket of [0, 1, 7, 42, 999]) {
      const t = admitAt(ticket, event);
      expect(isAdmitted(ticket, event, t)).toBe(true);
      expect(isAdmitted(ticket, event, t - 1)).toBe(false);
    }
  });

  it('reports wait time and people ahead', () => {
    expect(msUntilAdmission(12, event, 100_000)).toBe(24_000);
    expect(peopleAhead(12, event, 100_000)).toBe(11);
    expect(peopleAhead(3, event, 200_000)).toBe(0);
  });

  it('never admits a missing ticket', () => {
    expect(isAdmitted(null, event, 1e12)).toBe(false);
  });
});
