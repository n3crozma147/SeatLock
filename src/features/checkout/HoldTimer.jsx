import { Countdown } from '../../components/Countdown.jsx';

const URGENT_MS = 30_000;

export function HoldTimer({ msRemaining, ttlMs }) {
  const fraction = ttlMs > 0 ? Math.min(1, msRemaining / ttlMs) : 0;
  const urgent = msRemaining <= URGENT_MS;
  return (
    <div className={`hold-timer${urgent ? ' hold-timer--urgent' : ''}`}>
      <p className="hold-timer__label">{urgent ? 'Hold ends soon' : 'Seats held for you'}</p>
      <Countdown ms={msRemaining} className="hold-timer__time" />
      <div className="hold-timer__track" aria-hidden="true">
        <div className="hold-timer__fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </div>
  );
}
