// Firebase exposes the estimated difference between server and local clocks
// at `.info/serverTimeOffset`. Every expiry or admission decision on the client
// uses this, so a user whose laptop clock is wrong still sees the truth.

export function serverNow(offsetMs = 0) {
  return Date.now() + offsetMs;
}
