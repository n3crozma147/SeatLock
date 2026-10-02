import { useEffect, useState } from 'react';
import { admitAt, isAdmitted, peopleAhead } from '../lib/admission.js';
import { queueService } from '../services/index.js';

/** Takes (or recovers) this user's ticket, then derives admission from server time. */
export function useQueue(eventId, uid, event, now) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [retries, setRetries] = useState(0);
  const eventExists = Boolean(event);

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

  const hasTicket = ticket !== null && Boolean(event);
  return {
    ticket,
    error,
    retries,
    admitted: hasTicket && isAdmitted(ticket, event, now),
    admitAt: hasTicket ? admitAt(ticket, event) : null,
    ahead: hasTicket ? peopleAhead(ticket, event, now) : null,
  };
}
