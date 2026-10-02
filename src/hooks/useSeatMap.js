import { useEffect, useRef, useState } from 'react';
import { seatService } from '../services/index.js';

/**
 * Live Map<seatId, seat> for one event. The Map is mutated in place and a
 * version counter triggers re-renders, so a burst of N child events costs one
 * render (React batches the setState calls) instead of N full Map copies.
 * Only subscribe once admitted: people in the waiting room don't need seat traffic.
 */
export function useSeatMap(eventId, enabled) {
  const seatsRef = useRef(new Map());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const seats = new Map();
    seatsRef.current = seats;
    setVersion((v) => v + 1);
    return seatService.subscribeSeats(eventId, {
      onUpsert: (id, seat) => {
        seats.set(id, seat);
        setVersion((v) => v + 1);
      },
      onRemove: (id) => {
        seats.delete(id);
        setVersion((v) => v + 1);
      },
    });
  }, [eventId, enabled]);

  return { seats: seatsRef.current, version };
}
