import { Button } from '../../components/Button.jsx';
import './Confirmation.css';

export function BookingConfirmed({ eventName, bookedIds, onBookMore }) {
  return (
    <section className="confirmed">
      <h2>You're booked</h2>
      <p>Your seats for {eventName} are confirmed.</p>
      <ul className="tickets">
        {bookedIds.map((id) => (
          <li key={id} className="ticket">
            <span className="ticket__event">{eventName}</span>
            <span className="ticket__seat">{id}</span>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onBookMore}>
        Book more seats
      </Button>
    </section>
  );
}
