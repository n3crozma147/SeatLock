import { get, onValue, ref } from 'firebase/database';
import { eventPath } from '../lib/paths.js';

const toEvent = (eventId, snap) => (snap.exists() ? { id: eventId, ...snap.val() } : null);

export function createEventService(db) {
  async function getEvent(eventId) {
    return toEvent(eventId, await get(ref(db, eventPath(eventId))));
  }

  function subscribeEvent(eventId, onData, onError) {
    return onValue(ref(db, eventPath(eventId)), (snap) => onData(toEvent(eventId, snap)), onError);
  }

  return { getEvent, subscribeEvent };
}
