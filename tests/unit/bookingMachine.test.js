import { describe, expect, it } from 'vitest';
import { bookingReducer, initialBookingState, Phase } from '../../src/lib/bookingMachine.js';

const run = (actions, state = initialBookingState) => actions.reduce(bookingReducer, state);

describe('bookingReducer', () => {
  it('goes to the waiting room when not yet admitted, then to seat selection', () => {
    const queued = run([{ type: 'TICKET_ASSIGNED', admitted: false }]);
    expect(queued.phase).toBe(Phase.QUEUED);
    expect(bookingReducer(queued, { type: 'ADMITTED' }).phase).toBe(Phase.SELECTING);
  });

  it('runs the happy path to a booking', () => {
    const state = run([
      { type: 'TICKET_ASSIGNED', admitted: true },
      { type: 'TOGGLE_SEAT', seatId: 'A1', maxSeats: 4 },
      { type: 'TOGGLE_SEAT', seatId: 'A2', maxSeats: 4 },
      { type: 'HOLD_REQUESTED' },
      { type: 'HOLD_SUCCEEDED', seatIds: ['A1', 'A2'] },
      { type: 'PAYMENT_STARTED' },
      { type: 'CONFIRM_SUCCEEDED' },
    ]);
    expect(state.phase).toBe(Phase.BOOKED);
  });

  it('caps the selection size', () => {
    const state = run([
      { type: 'TICKET_ASSIGNED', admitted: true },
      { type: 'TOGGLE_SEAT', seatId: 'A1', maxSeats: 1 },
      { type: 'TOGGLE_SEAT', seatId: 'A2', maxSeats: 1 },
    ]);
    expect(state.selected).toEqual(['A1']);
    expect(state.notice.kind).toBe('warn');
  });

  it('returns to selection with the surviving seats when a hold is rejected', () => {
    const state = run([
      { type: 'TICKET_ASSIGNED', admitted: true },
      { type: 'TOGGLE_SEAT', seatId: 'A1', maxSeats: 4 },
      { type: 'TOGGLE_SEAT', seatId: 'A2', maxSeats: 4 },
      { type: 'HOLD_REQUESTED' },
      { type: 'HOLD_FAILED', stillFree: ['A2'], message: 'taken' },
    ]);
    expect(state.phase).toBe(Phase.SELECTING);
    expect(state.selected).toEqual(['A2']);
  });

  it('drops back to selection when a hold is lost', () => {
    const state = run([
      { type: 'TICKET_ASSIGNED', admitted: true },
      { type: 'HOLDS_DETECTED', seatIds: ['B3'] },
      { type: 'HOLD_LOST' },
    ]);
    expect(state.phase).toBe(Phase.SELECTING);
    expect(state.holdIds).toEqual([]);
  });

  it('ignores actions that are invalid in the current phase', () => {
    const state = run([{ type: 'TICKET_ASSIGNED', admitted: false }, { type: 'PAYMENT_STARTED' }]);
    expect(state.phase).toBe(Phase.QUEUED);
  });
});
