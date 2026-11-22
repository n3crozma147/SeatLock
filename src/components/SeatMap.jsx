import { useEffect, useRef, useState } from 'react';
import { useSeats, useSeatLock } from '../hooks/useSeatLock.js';
import { TICK_MS } from '../config.js';
import Seat from './Seat.jsx';

export default function SeatMap({ uid, onDone, onLeaveQueue }) {
  const seats = useSeats();
  const { lockSeat, releaseSeat, confirmPurchase } = useSeatLock(uid);
  const [mySeatId, setMySeatId] = useState(null);
  const [status, setStatus] = useState(''); // transient status message
  const [now, setNow] = useState(Date.now());
  const mySeatRef = useRef(null);
  mySeatRef.current = mySeatId;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Release any held lock if the tab closes or the component unmounts
  // without a completed purchase.
  useEffect(() => {
    const handleUnload = () => {
      if (mySeatRef.current) releaseSeat(mySeatRef.current);
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      if (mySeatRef.current) releaseSeat(mySeatRef.current);
    };
  }, [releaseSeat]);

  async function handleSelect(seatId) {
    if (mySeatId === seatId) return;
    setStatus('');
    const result = await lockSeat(seatId);
    if (!result.ok) {
      setStatus(
        result.reason === 'error'
          ? "Couldn't reach the server — please try again."
          : 'That seat just got taken — try another.'
      );
      return;
    }
    if (mySeatId) {
      releaseSeat(mySeatId).catch(() => {});
    }
    setMySeatId(seatId);
  }

  async function handleConfirm() {
    if (!mySeatId) return;
    const result = await confirmPurchase(mySeatId);
    if (!result.ok) {
      if (result.reason === 'error') {
        // Network/server problem: keep the hold so the user can retry.
        setStatus("Couldn't reach the server — please try confirming again.");
        return;
      }
      setStatus('Your hold expired before checkout completed. Pick a seat again.');
      setMySeatId(null);
      return;
    }
    setStatus('purchased');
    // Purchase complete — free up the admission slot right away instead of
    // waiting for the session TTL, so the next person in line gets in sooner.
    onLeaveQueue().catch(() => {});
  }

  async function handleLeave() {
    if (mySeatId) await releaseSeat(mySeatId);
    await onLeaveQueue();
    onDone();
  }

  const seatIds = Object.keys(seats).sort(
    (a, b) => seats[a].row - seats[b].row || seats[a].col - seats[b].col
  );
  const rows = {};
  for (const id of seatIds) {
    const r = seats[id].row;
    (rows[r] = rows[r] || []).push(id);
  }

  if (status === 'purchased') {
    const seat = seats[mySeatId];
    return (
      <div className="panel">
        <h2>You're in! 🎟️</h2>
        <p>
          Seat {seat?.label} is yours — ${seat?.price}.
        </p>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="panel panel--wide">
      <div className="seatmap-header">
        <h2>Pick a seat</h2>
        <button className="link" onClick={handleLeave}>
          Leave sale
        </button>
      </div>
      {status && <p className="warn">{status}</p>}
      <SeatComponentGrid rows={rows} seats={seats} uid={uid} now={now} onSelect={handleSelect} />
      <div className="legend">
        <span><i className="dot dot--available" /> Available</span>
        <span><i className="dot dot--locked" /> Held by someone</span>
        <span><i className="dot dot--mine" /> Your hold</span>
        <span><i className="dot dot--sold" /> Sold</span>
      </div>
      <button className="primary" disabled={!mySeatId} onClick={handleConfirm}>
        {mySeatId ? `Confirm purchase — ${seats[mySeatId]?.label}` : 'Select a seat to continue'}
      </button>
    </div>
  );
}

function SeatComponentGrid({ rows, seats, uid, now, onSelect }) {
  return (
    <div className="seatgrid">
      {Object.keys(rows)
        .sort((a, b) => a - b)
        .map((r) => (
          <div className="seatrow" key={r}>
            {rows[r].map((seatId) => (
              <Seat
                key={seatId}
                seatId={seatId}
                seat={seats[seatId]}
                uid={uid}
                now={now}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
