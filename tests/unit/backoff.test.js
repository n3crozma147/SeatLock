import { describe, expect, it } from 'vitest';
import { jitteredBackoff } from '../../src/lib/backoff.js';

describe('jitteredBackoff', () => {
  it('grows exponentially up to the cap', () => {
    const max = () => 0.999999;
    expect(jitteredBackoff(0, 50, 2000, max)).toBe(49);
    expect(jitteredBackoff(3, 50, 2000, max)).toBe(399);
    expect(jitteredBackoff(20, 50, 2000, max)).toBe(1999);
  });

  it('can return zero (full jitter)', () => {
    expect(jitteredBackoff(5, 50, 2000, () => 0)).toBe(0);
  });
});
