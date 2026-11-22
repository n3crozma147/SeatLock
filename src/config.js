// Central place to tune SeatLock's behavior for the demo.
// In a real system these would live in event metadata in the DB (per-event
// capacity, per-event lock duration, etc). They're constants here to keep
// the demo simple to read and to test.

// The event this build points at. You could make this a route param
// (e.g. /event/:eventId) to support multiple simultaneous sales.
export const EVENT_ID = 'demo-event';

// How many users are allowed into seat-selection at once. This is the
// "admission control" knob — set it low (e.g. 2-3) so you can actually see
// queueing behavior when testing with a few browser tabs.
export const ROOM_CAPACITY = 3;

// How many seats the demo venue has.
export const TOTAL_SEATS = 40;
export const SEATS_PER_ROW = 8;

// How long an admitted session lives before it's reclaimed if the tab
// doesn't heartbeat (e.g. closed, crashed, network lost).
export const ADMITTED_SESSION_MS = 5 * 60 * 1000; // 5 minutes

// How often an admitted client renews its session so it isn't reclaimed.
export const HEARTBEAT_MS = 20 * 1000; // 20 seconds

// How often every connected client attempts to "sweep" the queue (expire
// stale admissions, promote the next people in line). See README for why
// this is client-driven in the demo and how you'd move it server-side.
export const SWEEP_INTERVAL_MS = 3 * 1000; // 3 seconds

// How long a seat stays locked for one shopper before it's up for grabs
// again. This is the anti-double-booking TTL.
export const SEAT_LOCK_TTL_MS = 90 * 1000; // 90 seconds

// How often the seat map re-renders lock countdowns.
export const TICK_MS = 1000;
