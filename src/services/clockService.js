import { onValue, ref } from 'firebase/database';

export function createClockService(db) {
  /** Calls back with (serverTime - localTime) in ms whenever Firebase re-estimates it. */
  function subscribeServerOffset(callback) {
    return onValue(ref(db, '.info/serverTimeOffset'), (snap) => callback(snap.val() ?? 0));
  }

  return { subscribeServerOffset };
}
