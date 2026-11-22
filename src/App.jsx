import { useEffect, useState } from 'react';
import { useAnonymousAuth, ensureEventSeeded } from './firebase.js';
import { useQueue } from './hooks/useQueue.js';
import WaitingRoom from './components/WaitingRoom.jsx';
import SeatMap from './components/SeatMap.jsx';

export default function App() {
  const { uid, ready } = useAnonymousAuth();
  const [seeded, setSeeded] = useState(false);
  const [inSeatMap, setInSeatMap] = useState(false);
  const queue = useQueue(uid);

  useEffect(() => {
    ensureEventSeeded()
      .catch((err) => console.error('seed failed:', err))
      .finally(() => setSeeded(true));
  }, []);

  if (!ready || !seeded) {
    return (
      <div className="page">
        <div className="panel">Loading…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">SeatLock</span>
        <span className="uid muted">
          {uid ? `shopper ${uid.slice(0, 6)}` : ''}
        </span>
      </header>

      {queue.phase === 'admitted' && inSeatMap ? (
        <SeatMap
          uid={uid}
          onDone={() => setInSeatMap(false)}
          onLeaveQueue={queue.leaveQueue}
        />
      ) : (
        <WaitingRoom queue={queue} onEnter={() => setInSeatMap(true)} />
      )}
    </div>
  );
}
