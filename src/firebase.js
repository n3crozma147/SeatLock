import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  get,
  set,
} from 'firebase/database';
import { useEffect, useState } from 'react';
import { EVENT_ID, TOTAL_SEATS, SEATS_PER_ROW } from './config.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// --- Anonymous auth ---------------------------------------------------
// Every browser tab is one "shopper". Anonymous auth gives each tab a
// stable uid for the life of the session without a login form.
export function useAnonymousAuth() {
  const [uid, setUid] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid);
        setReady(true);
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error('Anonymous sign-in failed:', err);
          setReady(true);
        });
      }
    });
    return () => unsub();
  }, []);

  return { uid, ready };
}

// --- One-time demo data seed -------------------------------------------
// If the event's seat map doesn't exist yet, create it. This only writes
// when the node is empty, so it's safe to call on every app load.
export async function ensureEventSeeded() {
  const seatsRef = ref(db, `events/${EVENT_ID}/seats`);
  const snap = await get(seatsRef);
  if (snap.exists()) return;

  const seats = {};
  for (let i = 1; i <= TOTAL_SEATS; i++) {
    const row = Math.ceil(i / SEATS_PER_ROW);
    const col = ((i - 1) % SEATS_PER_ROW) + 1;
    seats[`seat-${i}`] = {
      label: `${String.fromCharCode(64 + row)}${col}`,
      row,
      col,
      price: 75,
      status: 'available', // 'available' | 'locked' | 'sold'
      lockedBy: null,
      lockExpiresAt: null,
      soldTo: null,
    };
  }

  await set(seatsRef, seats);
  await set(ref(db, `events/${EVENT_ID}/meta`), {
    name: 'SeatLock Demo — Flash Sale',
    totalSeats: TOTAL_SEATS,
    createdAt: Date.now(),
  });
}
