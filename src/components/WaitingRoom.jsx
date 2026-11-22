import { useEffect, useState } from 'react';

export default function WaitingRoom({ queue, onEnter }) {
  const { phase, position, waitingCount, admittedCount, capacity, expiresAt, joinQueue } =
    queue;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (phase === 'idle') {
    return (
      <div className="panel">
        <h2>SeatLock Demo — Flash Sale</h2>
        <p className="muted">
          This sale only lets {capacity} shoppers into seat selection at
          once. Everyone else waits in a fair, first-come queue.
        </p>
        <button className="primary" onClick={joinQueue}>
          Join the queue
        </button>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="panel">
        <h2>You're in line</h2>
        <div className="big-number">#{position}</div>
        <p className="muted">
          {waitingCount} people waiting · {admittedCount}/{capacity} currently
          shopping
        </p>
        <p className="muted small">
          You'll be admitted automatically as slots free up — keep this tab
          open.
        </p>
      </div>
    );
  }

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;

  return (
    <div className="panel">
      <h2>You're up!</h2>
      <p className="muted">
        Select your seat within {secondsLeft}s or your slot will be given to
        the next person in line.
      </p>
      <button className="primary" onClick={onEnter}>
        Choose your seat
      </button>
    </div>
  );
}
