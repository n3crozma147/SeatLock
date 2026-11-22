import { Button } from '../../components/Button.jsx';
import { Phase } from '../../lib/bookingMachine.js';
import { plural } from '../../lib/format.js';
import { HoldTimer } from './HoldTimer.jsx';
import { MockPayment } from './MockPayment.jsx';
import './Checkout.css';

function SeatChips({ ids }) {
  return (
    <ul className="seat-chips">
      {ids.map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  );
}

export function CheckoutPanel({ phase, selected, heldIds, msRemaining, ttlMs, maxSeats, actions }) {
  const ttlMinutes = Math.round(ttlMs / 60_000);

  if (phase === Phase.PAYING) {
    return (
      <aside className="checkout">
        <h2>Paying</h2>
        <SeatChips ids={heldIds} />
        <MockPayment />
      </aside>
    );
  }

  if (phase === Phase.HOLDING || phase === Phase.RELEASING) {
    return (
      <aside className="checkout">
        <HoldTimer msRemaining={msRemaining} ttlMs={ttlMs} />
        <SeatChips ids={heldIds} />
        <div className="checkout__actions">
          <Button onClick={actions.confirm} disabled={phase === Phase.RELEASING}>
            Pay and confirm
          </Button>
          <Button variant="secondary" onClick={actions.release} disabled={phase === Phase.RELEASING}>
            Release seats
          </Button>
        </div>
      </aside>
    );
  }

  const requesting = phase === Phase.REQUESTING;
  return (
    <aside className="checkout">
      <h2>Your seats</h2>
      {selected.length === 0 ? (
        <p className="checkout__hint">Pick up to {plural(maxSeats, 'seat')} on the map.</p>
      ) : (
        <SeatChips ids={selected} />
      )}
      <div className="checkout__actions">
        <Button onClick={actions.holdSelected} disabled={selected.length === 0 || requesting}>
          {requesting ? 'Holding…' : `Hold ${plural(selected.length, 'seat')}`}
        </Button>
      </div>
      <p className="checkout__hint">
        Held seats are yours for {ttlMinutes >= 1 ? plural(ttlMinutes, 'minute') : `${ttlMs / 1000} seconds`}{' '}
        while you pay. After that they go back on sale.
      </p>
    </aside>
  );
}
