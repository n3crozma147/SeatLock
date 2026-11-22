import { isEffectivelyAvailable } from '../hooks/useSeatLock.js';

export default function Seat({ seatId, seat, uid, onSelect, now }) {
  if (!seat) return null;

  const mine = seat.lockedBy === uid && seat.status === 'locked';
  const sold = seat.status === 'sold';
  const available = isEffectivelyAvailable(seat);
  const lockedByOther = seat.status === 'locked' && !mine && !available;

  let cls = 'seat';
  if (sold) cls += ' seat--sold';
  else if (mine) cls += ' seat--mine';
  else if (lockedByOther) cls += ' seat--locked';
  else cls += ' seat--available';

  const secondsLeft =
    mine && seat.lockExpiresAt ? Math.max(0, Math.floor((seat.lockExpiresAt - now) / 1000)) : null;

  return (
    <button
      className={cls}
      disabled={sold || lockedByOther}
      onClick={() => onSelect(seatId)}
      title={`${seat.label} · $${seat.price}`}
    >
      <span className="seat-label">{seat.label}</span>
      {mine && secondsLeft !== null && (
        <span className="seat-timer">{secondsLeft}s</span>
      )}
    </button>
  );
}
