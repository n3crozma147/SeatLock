import { useEffect, useState } from 'react';
import {
  admitAt,
  isAdmitted,
  isAdmittedByServing,
  isOccupancyMode,
  peopleAhead,
  peopleAheadByServing,
} from '../lib/admission.js';
import { queueService } from '../services/index.js';

/**
 * Takes (or recovers) this user's ticket, then works out admission.
 *  - time mode:      derived from the server clock (a leaky bucket)
 *  - occupancy mode: derived from the coordinator's `nowServing` number; the user listens to
 *                    that one value (and holds their own ticket) while waiting, and stops
 *                    listening once admitted. Admission is never revoked by the rules.
 */
export function useQueue(eventId, uid, event, now) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [retries, setRetries] = useState(0);
  const [nowServing, setNowServing] = useState(null);
  const eventExists = Boolean(event);
  const occupancy = isOccupancyMode(event);

  useEffect(() => {
    if (!uid || !eventExists) return undefined;
    let cancelled = false;
    queueService
      .takeTicket(eventId, uid, { onRetry: (n) => !cancelled && setRetries(n) })
      .then((t) => !cancelled && setTicket(t))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [eventId, uid, eventExists]);

  const hasTicket = ticket !== null && eventExists;
  const servedByCoordinator = occupancy && isAdmittedByServing(ticket, nowServing);

  useEffect(() => {
    // Only waiting users listen. Once admitted, the subscription is dropped (nowServing never decreases).
    if (!occupancy || !hasTicket || servedByCoordinator) return undefined;
    return queueService.subscribeNowServing(eventId, setNowServing, setError);
  }, [eventId, occupancy, hasTicket, servedByCoordinator]);

  if (occupancy) {
    return {
      ticket,
      error,
      retries,
      admitted: hasTicket && servedByCoordinator,
      admitAt: null, // a coordinator decides when, so there is no honest countdown
      ahead: hasTicket ? peopleAheadByServing(ticket, nowServing) : null,
    };
  }

  return {
    ticket,
    error,
    retries,
    admitted: hasTicket && isAdmitted(ticket, event, now),
    admitAt: hasTicket ? admitAt(ticket, event) : null,
    ahead: hasTicket ? peopleAhead(ticket, event, now) : null,
  };
}
