export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "Full jitter" exponential backoff: a random delay in [0, min(cap, base * 2^attempt)).
 * Randomness spreads retries out so contending clients don't collide again in lockstep.
 */
export function jitteredBackoff(attempt, baseMs = 50, capMs = 2000, random = Math.random) {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}
