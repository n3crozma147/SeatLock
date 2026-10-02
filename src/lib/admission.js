// Time-based admission (a leaky bucket driven by server time).
//
// Ticket t is admitted once:   t * intervalMs <= (now - saleStart) * batch
// i.e. `batch` people are let in every `intervalMs`, starting at saleStart.
// The security rules check the same inequality, so a client cannot admit itself early.

export function isAdmitted(ticket, event, nowMs) {
  if (ticket === null || ticket === undefined || !event) return false;
  return ticket * event.intervalMs <= (nowMs - event.saleStart) * event.batch;
}

/** Earliest server time (ms) at which `ticket` is admitted. */
export function admitAt(ticket, event) {
  return event.saleStart + Math.ceil((ticket * event.intervalMs) / event.batch);
}

export function msUntilAdmission(ticket, event, nowMs) {
  return Math.max(0, admitAt(ticket, event) - nowMs);
}

/** How many tickets have been admitted so far (tickets 0 .. count-1). */
export function admittedCount(event, nowMs) {
  const elapsed = nowMs - event.saleStart;
  if (elapsed < 0) return 0;
  return Math.floor((elapsed * event.batch) / event.intervalMs) + 1;
}

/** People in front of `ticket` who have not been admitted yet. */
export function peopleAhead(ticket, event, nowMs) {
  return Math.max(0, ticket - admittedCount(event, nowMs));
}
