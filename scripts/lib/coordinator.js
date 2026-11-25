// Occupancy-based admission coordinator.
//
// Security rules cannot count how many people are inside the booking room, so a
// single trusted process does. It is the ONLY writer of counters/{event}/nowServing
// (clients are denied by the rules; the Admin SDK bypasses them). A ticket t may
// hold seats in occupancy mode iff t < nowServing. Tickets are never rewritten.
//
// "Inside" (the definition this file implements):
//   An admitted person (ticket < nowServing) counts as inside from the moment they
//   are admitted until the FIRST of:
//     1. they confirm a booking            (they appear in bookings/{event})
//     2. they release their hold           (they were seen holding, and now hold nothing)
//     3. their admission window expires    (admittedAt + windowMs, default 2 * ttlMs)
//   Hold expiry is lazy (nothing fires when a hold times out), so (3) is what frees
//   the capacity of people who simply walk away, and a periodic sweep is what notices it.
//
// Everything above this line's `startCoordinator` is pure and unit-tested.

import {
  allBookingsPath,
  coordinatorAdmissionPath,
  coordinatorAdmittedPath,
  counterPath,
  eventPath,
  nowServingPath,
  seatsPath,
  ticketsPath,
} from '../../src/lib/paths.js';

export const DEFAULT_WINDOW_FACTOR = 2; // admission window = 2 * ttlMs

/**
 * The next value of nowServing. Never decreases, never passes the number of
 * tickets issued, admits only into free capacity, and stops once sold out.
 */
export function computeNextServing({ nowServing, nextTicket, capacity, inside, soldOut = false }) {
  for (const [name, value] of Object.entries({ nowServing, nextTicket, capacity, inside })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative number, got ${value}`);
  }
  if (soldOut) return nowServing;
  const room = Math.max(0, capacity - inside);
  return Math.max(nowServing, Math.min(nextTicket, nowServing + room));
}

/**
 * Is one admitted person still inside?
 *   record: { uid, admittedAt, held? }   held = the coordinator has seen them hold seats
 *   ctx:    { now, windowMs, bookedUids: Set, holders: Set }   holders = uids owning any seat right now
 */
export function assessAdmitted(record, { now, windowMs, bookedUids, holders }) {
  if (now >= record.admittedAt + windowMs) return { inside: false, holding: false, reason: 'window-expired' };
  const { uid } = record;
  if (uid && bookedUids.has(uid)) return { inside: false, holding: false, reason: 'booked' };
  if (uid && holders.has(uid)) return { inside: true, holding: true, reason: 'holding' };
  if (record.held) return { inside: false, holding: false, reason: 'released' };
  return { inside: true, holding: false, reason: 'browsing' };
}

/**
 * Count people inside among tickets [cursor, nowServing).
 * Tickets below `cursor` are known to be past their admission window (admission times
 * never decrease with the ticket number), so a sweep only looks at recent admissions.
 *
 * Returns the count, the advanced cursor, tickets newly seen holding (to persist the
 * `held` flag so a restart can still recognise a release), and admitted tickets that
 * have no record yet (counted as inside until a record is written).
 */
export function scanInside({ cursor, nowServing, admissions, ticketToUid, bookedUids, holders, now, windowMs }) {
  let start = Math.min(cursor, nowServing);
  while (start < nowServing) {
    const record = admissions.get(start);
    if (!record || now < record.admittedAt + windowMs) break;
    start++;
  }

  let inside = 0;
  const newlyHolding = [];
  const missing = [];
  for (let ticket = start; ticket < nowServing; ticket++) {
    const stored = admissions.get(ticket);
    if (!stored) {
      missing.push(ticket);
      inside++;
      continue;
    }
    const record = { ...stored, uid: stored.uid ?? ticketToUid.get(ticket) ?? null };
    const verdict = assessAdmitted(record, { now, windowMs, bookedUids, holders });
    if (verdict.inside) inside++;
    if (verdict.holding && !stored.held) newlyHolding.push(ticket);
  }
  return { inside, cursor: start, newlyHolding, missing };
}

/**
 * Run the coordinator against a database handle (Admin SDK `getDatabase()`).
 * State is rebuilt from the database on startup, so a restart is safe.
 */
export function startCoordinator({
  db,
  eventId,
  sweepMs = 500,
  minWriteIntervalMs = 250, // at most ~4 nowServing writes per second: every waiting user listens to it
  windowMs, // admission window; default 2 * ttlMs
  now = Date.now,
  log = () => {},
}) {
  const state = {
    event: null,
    nextTicket: 0,
    nowServing: 0,
    ticketToUid: new Map(),
    holders: new Set(),
    bookedSeats: 0,
    bookedUids: new Set(),
    admissions: new Map(),
    cursor: 0,
  };
  const stats = { ticks: 0, nowServingWrites: 0, admitted: 0, peakInside: 0, lastInside: 0 };

  let ready = false;
  let busy = false;
  let dirty = false;
  let stopped = false;
  let lastWrite = 0;
  let warnedMode = false;
  const timers = new Set();
  const unsubscribers = [];

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  async function loadAdmissions() {
    const snap = await db.ref(coordinatorAdmittedPath(eventId)).get();
    state.admissions = new Map();
    snap.forEach((child) => {
      state.admissions.set(Number(child.key), child.val());
    });
    state.cursor = 0;
  }

  // Subscribe and resolve once the first snapshot has been handled.
  function listen(path, handler) {
    const reference = db.ref(path);
    return new Promise((resolve, reject) => {
      let first = true;
      const callback = async (snap) => {
        try {
          await handler(snap);
        } catch (err) {
          if (first) reject(err);
          else log(`handler error on ${path}: ${err.message}`);
        }
        if (first) {
          first = false;
          resolve();
        } else {
          kick();
        }
      };
      reference.on('value', callback, reject);
      unsubscribers.push(() => reference.off('value', callback));
    });
  }

  function kick() {
    if (stopped || !ready) return;
    if (busy) dirty = true;
    else setImmediate(tick);
  }

  async function tick() {
    if (busy || stopped || !ready) return;
    busy = true;
    try {
      const { event } = state;
      if (!event) return;
      if (event.admissionMode !== 'occupancy') {
        if (!warnedMode) log(`event "${eventId}" is in "${event.admissionMode ?? 'time'}" admission mode; coordinator is idle`);
        warnedMode = true;
        return;
      }
      warnedMode = false;
      if (!(event.capacity > 0)) {
        log(`event "${eventId}" has no positive capacity; coordinator is idle`);
        return;
      }
      stats.ticks++;

      const at = now();
      const window = windowMs ?? DEFAULT_WINDOW_FACTOR * event.ttlMs;
      const scan = scanInside({
        cursor: state.cursor,
        nowServing: state.nowServing,
        admissions: state.admissions,
        ticketToUid: state.ticketToUid,
        bookedUids: state.bookedUids,
        holders: state.holders,
        now: at,
        windowMs: window,
      });
      state.cursor = scan.cursor;
      if (scan.inside > event.capacity) {
        // Should not happen: we only admit into free capacity. Say exactly who is counted.
        const who = [];
        for (let ticket = scan.cursor; ticket < state.nowServing; ticket++) {
          const stored = state.admissions.get(ticket);
          if (!stored) {
            who.push(`${ticket}:no-record`);
            continue;
          }
          const uid = stored.uid ?? state.ticketToUid.get(ticket) ?? null;
          const verdict = assessAdmitted({ ...stored, uid }, { now: at, windowMs: window, bookedUids: state.bookedUids, holders: state.holders });
          if (verdict.inside) who.push(`${ticket}:${verdict.reason}${stored.held ? '+held' : ''}${uid ? '' : '+nouid'}`);
        }
        log(`WARNING inside ${scan.inside} > capacity ${event.capacity}; nowServing ${state.nowServing}: ${who.join(' ')}`);
      }
      stats.lastInside = scan.inside;
      stats.peakInside = Math.max(stats.peakInside, scan.inside);

      const updates = {};
      for (const ticket of scan.newlyHolding) updates[`${coordinatorAdmissionPath(eventId, ticket)}/held`] = true;
      for (const ticket of scan.missing) {
        updates[coordinatorAdmissionPath(eventId, ticket)] = { uid: state.ticketToUid.get(ticket) ?? null, admittedAt: at };
      }

      const totalSeats = event.rows * event.cols;
      const throttled = at - lastWrite < minWriteIntervalMs;
      const saleOpen = at >= event.saleStart;
      let target = state.nowServing;
      if (saleOpen && !throttled) {
        target = computeNextServing({
          nowServing: state.nowServing,
          nextTicket: state.nextTicket,
          capacity: event.capacity,
          inside: scan.inside,
          soldOut: state.bookedSeats >= totalSeats,
        });
      }
      const newTickets = [];
      for (let ticket = state.nowServing; ticket < target; ticket++) newTickets.push(ticket);
      for (const ticket of newTickets) {
        updates[coordinatorAdmissionPath(eventId, ticket)] = { uid: state.ticketToUid.get(ticket) ?? null, admittedAt: at };
      }
      if (newTickets.length) updates[nowServingPath(eventId)] = target;

      if (Object.keys(updates).length === 0) return;
      // One atomic write: the admission records and nowServing move together.
      await db.ref().update(updates);

      for (const ticket of scan.newlyHolding) {
        const record = state.admissions.get(ticket);
        if (record) state.admissions.set(ticket, { ...record, held: true });
      }
      for (const ticket of scan.missing) {
        state.admissions.set(ticket, { uid: state.ticketToUid.get(ticket) ?? null, admittedAt: at });
      }
      if (newTickets.length) {
        for (const ticket of newTickets) {
          state.admissions.set(ticket, { uid: state.ticketToUid.get(ticket) ?? null, admittedAt: at });
        }
        const from = state.nowServing;
        state.nowServing = target;
        lastWrite = at;
        stats.nowServingWrites++;
        stats.admitted += newTickets.length;
        log(`admitted ${newTickets.length} (nowServing ${from} -> ${target}, inside ${scan.inside}/${event.capacity}, waiting ${state.nextTicket - target})`);
      }
    } catch (err) {
      log(`tick failed: ${err.message}`);
    } finally {
      busy = false;
      if (dirty && !stopped) {
        dirty = false;
        later(tick, minWriteIntervalMs);
      }
    }
  }

  const started = (async () => {
    await Promise.all([
      listen(eventPath(eventId), (snap) => {
        state.event = snap.exists() ? snap.val() : null;
      }),
      listen(counterPath(eventId), (snap) => {
        state.nextTicket = snap.val() ?? 0;
      }),
      listen(nowServingPath(eventId), async (snap) => {
        const value = snap.val() ?? 0;
        // First snapshot, or somebody reset it (e.g. a re-seed): rebuild admissions from the database.
        if (!ready && state.admissions.size === 0) await loadAdmissions();
        else if (value < state.nowServing) await loadAdmissions();
        state.nowServing = Math.max(value, 0);
        if (value < state.cursor) state.cursor = 0;
      }),
      listen(ticketsPath(eventId), (snap) => {
        const map = new Map();
        snap.forEach((child) => {
          map.set(child.val(), child.key);
        });
        state.ticketToUid = map;
      }),
      listen(seatsPath(eventId), (snap) => {
        const holders = new Set();
        let booked = 0;
        snap.forEach((child) => {
          const seat = child.val();
          if (seat?.holder) holders.add(seat.holder);
          if (seat?.status === 'booked') booked++;
        });
        state.holders = holders;
        state.bookedSeats = booked;
      }),
      listen(allBookingsPath(eventId), (snap) => {
        const uids = new Set();
        snap.forEach((child) => {
          uids.add(child.key);
        });
        state.bookedUids = uids;
      }),
    ]);
    ready = true;
    const sweep = setInterval(tick, sweepMs); // lazy hold expiry fires no event, so poll for it
    timers.add(sweep);
    kick();
    log(`coordinator ready for "${eventId}" (nowServing ${state.nowServing}, issued ${state.nextTicket})`);
  })();

  async function stop() {
    stopped = true;
    for (const id of timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    await started.catch(() => {});
    while (busy) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return { ready: started, stop, state, stats };
}
