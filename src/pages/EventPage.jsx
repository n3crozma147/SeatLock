import { useParams, useSearchParams } from 'react-router-dom';
import { Banner } from '../components/Banner.jsx';
import { Spinner } from '../components/Spinner.jsx';
import { usingEmulator } from '../config/firebase.js';
import { CheckoutPanel } from '../features/checkout/CheckoutPanel.jsx';
import { BookingConfirmed } from '../features/confirmation/BookingConfirmed.jsx';
import { DebugPanel } from '../features/debug/DebugPanel.jsx';
import { SeatMap } from '../features/seat-map/SeatMap.jsx';
import { WaitingRoom } from '../features/waiting-room/WaitingRoom.jsx';
import { useBookingFlow } from '../hooks/useBookingFlow.js';
import { useEvent } from '../hooks/useEvent.js';
import { useQueue } from '../hooks/useQueue.js';
import { useSeatMap } from '../hooks/useSeatMap.js';
import { useServerClock } from '../hooks/useServerClock.js';
import { Phase } from '../lib/bookingMachine.js';
import NotFoundPage from './NotFoundPage.jsx';

export default function EventPage({ uid }) {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();

  // All hooks run unconditionally, before any early return.
  const { event, loading, error } = useEvent(eventId);
  const { now, offset } = useServerClock();
  const queue = useQueue(eventId, uid, event, now);
  const { seats, version } = useSeatMap(eventId, queue.admitted);
  const flow = useBookingFlow({
    eventId,
    uid,
    event,
    seats,
    version,
    now,
    offset,
    ticket: queue.ticket,
    admitted: queue.admitted,
  });
  const { phase, notice, selected } = flow.state;

  if (loading) {
    return (
      <div className="page-center">
        <Spinner label="Loading event" />
      </div>
    );
  }
  if (error) return <Banner kind="error">Could not load this event: {error.message}</Banner>;
  if (!event) {
    return <NotFoundPage message={`There's no event called "${eventId}". Create it with: npm run seed -- --event ${eventId}`} />;
  }

  let body;
  if (queue.error) {
    body = <Banner kind="error">{queue.error.message}</Banner>;
  } else if (phase === Phase.LOADING) {
    body = <Spinner label="Getting your place in line" />;
  } else if (phase === Phase.QUEUED) {
    body = <WaitingRoom event={event} ticket={queue.ticket} ahead={queue.ahead} admitAt={queue.admitAt} now={now} />;
  } else if (phase === Phase.BOOKED) {
    body = <BookingConfirmed eventName={event.name} bookedIds={flow.hold.bookedIds} onBookMore={flow.actions.bookMore} />;
  } else if (phase === Phase.ERROR) {
    body = <Banner kind="error">{flow.state.error}</Banner>;
  } else {
    body = (
      <div className="booking-layout">
        <SeatMap
          event={event}
          seats={seats}
          version={version}
          uid={uid}
          now={now}
          selected={selected}
          interactive={phase === Phase.SELECTING}
          onToggle={flow.actions.toggleSeat}
        />
        <CheckoutPanel
          phase={phase}
          selected={selected}
          heldIds={flow.hold.heldIds}
          msRemaining={flow.hold.msRemaining}
          ttlMs={event.ttlMs}
          maxSeats={flow.maxSeats}
          actions={flow.actions}
        />
      </div>
    );
  }

  return (
    <div className="event-page">
      <header className="event-header">
        <h1>{event.name}</h1>
        <p>{event.rows * event.cols} seats</p>
      </header>
      {notice && (
        <Banner kind={notice.kind} onDismiss={flow.actions.dismissNotice}>
          {notice.text}
        </Banner>
      )}
      {body}
      {searchParams.has('debug') && (
        <DebugPanel
          rows={{
            uid,
            ticket: queue.ticket,
            'queue retries': queue.retries,
            admitted: queue.admitted,
            phase,
            'clock offset (ms)': Math.round(offset),
            'seats in map': seats.size,
            emulator: usingEmulator,
          }}
        />
      )}
    </div>
  );
}
