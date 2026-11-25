// Single source of truth for database paths. Used by the browser app,
// the Node scripts, and the tests, so they can never disagree.

export const eventPath = (eventId) => `events/${eventId}`;
export const counterPath = (eventId) => `counters/${eventId}/nextTicket`;
export const ticketsPath = (eventId) => `tickets/${eventId}`;
export const ticketPath = (eventId, uid) => `tickets/${eventId}/${uid}`;
export const seatsPath = (eventId) => `seats/${eventId}`;
export const seatPath = (eventId, seatId) => `seats/${eventId}/${seatId}`;
export const allBookingsPath = (eventId) => `bookings/${eventId}`;
export const bookingsPath = (eventId, uid) => `bookings/${eventId}/${uid}`;
export const bookingPath = (eventId, uid, seatId) => `bookings/${eventId}/${uid}/${seatId}`;

// Occupancy-based admission (see docs/ARCHITECTURE.md).
export const nowServingPath = (eventId) => `counters/${eventId}/nowServing`;
export const coordinatorAdmittedPath = (eventId) => `coordinator/${eventId}/admitted`;
export const coordinatorAdmissionPath = (eventId, ticket) => `coordinator/${eventId}/admitted/${ticket}`;
