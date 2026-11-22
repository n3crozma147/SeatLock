import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, runTransaction, remove, update } from 'firebase/database';
import { db } from '../firebase.js';
import {
  EVENT_ID,
  ROOM_CAPACITY,
  ADMITTED_SESSION_MS,
  HEARTBEAT_MS,
  SWEEP_INTERVAL_MS,
} from '../config.js';

const queuePath = `events/${EVENT_ID}/queue`;

// Runs the admission sweep as a single RTDB transaction so concurrent
// clients can't double-admit or race each other. Any connected client can
// trigger this (see README for the production alternative: a scheduled
// Cloud Function / server-side worker instead of every tab doing it).
function sweep() {
  const qRef = ref(db, queuePath);
  return runTransaction(qRef, (data) => {
    if (!data) return data;
    const now = Date.now();

    const admitted = { ...(data.admitted || {}) };
    for (const uid of Object.keys(admitted)) {
      if (!admitted[uid] || admitted[uid].expiresAt < now) {
        delete admitted[uid];
      }
    }

    const waitingEntries = Object.entries(data.waiting || {})
      .filter(([, v]) => v)
      .sort((a, b) => a[1].ticketNumber - b[1].ticketNumber);

    let free = ROOM_CAPACITY - Object.keys(admitted).length;
    const waiting = { ...(data.waiting || {}) };

    for (const [uid, entry] of waitingEntries) {
      if (free <= 0) break;
      admitted[uid] = {
        ticketNumber: entry.ticketNumber,
        admittedAt: now,
        expiresAt: now + ADMITTED_SESSION_MS,
      };
      delete waiting[uid];
      free -= 1;
    }

    data.admitted = admitted;
    data.waiting = waiting;
    return data;
  });
}

export function useQueue(uid) {
  const [snapshot, setSnapshot] = useState(null);
  const sweepTimer = useRef(null);
  const heartbeatTimer = useRef(null);

  useEffect(() => {
    const qRef = ref(db, queuePath);
    const unsub = onValue(qRef, (snap) => setSnapshot(snap.val() || {}));
    return () => unsub();
  }, []);

  // Every connected client nudges the sweep along. Transactions make this
  // safe even with many tabs sweeping at once.
  useEffect(() => {
    sweepTimer.current = setInterval(() => {
      sweep().catch((err) => console.error('sweep failed:', err));
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(sweepTimer.current);
  }, []);

  const waiting = snapshot?.waiting || {};
  const admitted = snapshot?.admitted || {};
  const myWaitingEntry = uid ? waiting[uid] : null;
  const myAdmittedEntry = uid ? admitted[uid] : null;

  const phase = myAdmittedEntry ? 'admitted' : myWaitingEntry ? 'waiting' : 'idle';

  const position = myWaitingEntry
    ? Object.values(waiting).filter(
        (w) => w && w.ticketNumber < myWaitingEntry.ticketNumber
      ).length + 1
    : 0;

  // Heartbeat keeps an admitted session alive while the tab is open.
  useEffect(() => {
    if (phase !== 'admitted' || !uid) {
      clearInterval(heartbeatTimer.current);
      return;
    }
    heartbeatTimer.current = setInterval(() => {
      update(ref(db, `${queuePath}/admitted/${uid}`), {
        expiresAt: Date.now() + ADMITTED_SESSION_MS,
      }).catch((err) => console.error('heartbeat failed:', err));
    }, HEARTBEAT_MS);
    return () => clearInterval(heartbeatTimer.current);
  }, [phase, uid]);

  const joinQueue = useCallback(() => {
    if (!uid) return Promise.resolve();
    const qRef = ref(db, queuePath);
    return runTransaction(qRef, (data) => {
      data = data || { ticketCounter: 0, waiting: {}, admitted: {} };
      data.ticketCounter = (data.ticketCounter || 0) + 1;
      data.waiting = data.waiting || {};
      data.waiting[uid] = {
        ticketNumber: data.ticketCounter,
        joinedAt: Date.now(),
      };
      return data;
    });
  }, [uid]);

  const leaveQueue = useCallback(() => {
    if (!uid) return Promise.resolve();
    return Promise.all([
      remove(ref(db, `${queuePath}/waiting/${uid}`)),
      remove(ref(db, `${queuePath}/admitted/${uid}`)),
    ]);
  }, [uid]);

  return {
    phase, // 'idle' | 'waiting' | 'admitted'
    position, // 1-based position among waiting users
    waitingCount: Object.keys(waiting).length,
    admittedCount: Object.keys(admitted).length,
    capacity: ROOM_CAPACITY,
    expiresAt: myAdmittedEntry?.expiresAt || null,
    joinQueue,
    leaveQueue,
  };
}
