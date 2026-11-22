import { Countdown } from '../../components/Countdown.jsx';
import { plural } from '../../lib/format.js';
import './WaitingRoom.css';

export function WaitingRoom({ event, ticket, ahead, admitAt, now }) {
  const beforeSale = now < event.saleStart;
  const msLeft = Math.max(0, (beforeSale ? event.saleStart : admitAt) - now);

  return (
    <section className="waiting-room" aria-live="polite">
      <h2>{beforeSale ? 'Sales open soon' : "You're in line"}</h2>
      <p className="waiting-room__lead">
        Keep this tab open. When it's your turn, the seat map opens here automatically.
      </p>
      <dl className="waiting-room__stats">
        <div>
          <dt>Your place</dt>
          <dd>{ticket + 1}</dd>
        </div>
        <div>
          <dt>Ahead of you</dt>
          <dd>{ahead}</dd>
        </div>
        <div>
          <dt>{beforeSale ? 'Sale opens in' : 'Estimated wait'}</dt>
          <dd>
            <Countdown ms={msLeft} />
          </dd>
        </div>
      </dl>
      <p className="waiting-room__note">
        People are let in {plural(event.batch, 'person', 'people')} every {event.intervalMs / 1000} seconds, so
        everyone choosing seats gets a fair, responsive map.
      </p>
    </section>
  );
}
