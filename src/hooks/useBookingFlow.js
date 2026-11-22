import { useCallback, useEffect, useReducer, useRef } from 'react';
import { sleep } from '../lib/backoff.js';
import { bookingReducer, initialBookingState, Phase } from '../lib/bookingMachine.js';
import { ErrorCode } from '../lib/errors.js';
import { serverNow } from '../lib/serverClock.js';
import { deriveSeatStatus, SeatStatus } from '../lib/seatState.js';
import { seatService } from '../services/index.js';
import { useHold } from './useHold.js';

const MOCK_PAYMENT_MS = 1500;

/** Wires the pure booking state machine to live seat data and the seat service. */
export function useBookingFlow({ eventId, uid, event, seats, version, now, offset, ticket, admitted }) {
  const [state, dispatch] = useReducer(bookingReducer, initialBookingState);
  const ttlMs = event?.ttlMs ?? 0;
  const maxSeats = event?.maxSeats ?? 4;
  const hold = useHold(seats, version, uid, ttlMs, now);

  // Read the freshest values inside async handlers without re-creating them.
  const live = useRef({});
  live.current = { state, seats, offset, ttlMs, uid };
  const statusNow = (id) => {
    const { seats: map, offset: off, ttlMs: ttl, uid: me } = live.current;
    return deriveSeatStatus(map.get(id), serverNow(off), me, ttl);
  };

  // Queue → seats.
  useEffect(() => {
    if (ticket !== null && event) dispatch({ type: 'TICKET_ASSIGNED', admitted });
  }, [ticket, event, admitted]);
  useEffect(() => {
    if (admitted) dispatch({ type: 'ADMITTED' });
  }, [admitted]);

  // Keep the machine consistent with what the database says.
  const heldKey = hold.heldIds.join(',');
  useEffect(() => {
    if (state.phase === Phase.SELECTING && hold.heldIds.length > 0) {
      dispatch({ type: 'HOLDS_DETECTED', seatIds: hold.heldIds }); // e.g. after a refresh
    }
    if (state.phase === Phase.HOLDING) {
      // Lost = no longer my active hold: expired, reclaimed, or released from another tab.
      // (Local writes update the seat Map synchronously, so a fresh hold is already visible here.)
      const lost = state.holdIds.some((id) => statusNow(id) !== SeatStatus.MINE);
      if (lost) dispatch({ type: 'HOLD_LOST' });
    }
    if (state.phase === Phase.SELECTING && state.selected.length > 0) {
      const stillFree = state.selected.filter((id) => statusNow(id) === SeatStatus.FREE);
      if (stillFree.length !== state.selected.length) dispatch({ type: 'SELECTION_PRUNED', selected: stillFree });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.holdIds, state.selected, heldKey, version, now]);

  const toggleSeat = useCallback(
    (seatId) => dispatch({ type: 'TOGGLE_SEAT', seatId, maxSeats }),
    [maxSeats],
  );

  const holdSelected = useCallback(async () => {
    const { phase, selected } = live.current.state;
    if (phase !== Phase.SELECTING || selected.length === 0) return;
    dispatch({ type: 'HOLD_REQUESTED' });
    try {
      await seatService.holdSeats(eventId, selected, uid);
      dispatch({ type: 'HOLD_SUCCEEDED', seatIds: selected });
    } catch (err) {
      const stillFree = selected.filter((id) => statusNow(id) === SeatStatus.FREE);
      let message = 'Could not reach the server. Check your connection and try again.';
      if (err.code === ErrorCode.HOLD_REJECTED) {
        message =
          stillFree.length < selected.length
            ? 'Someone grabbed one of those seats first. The rest are still selected.'
            : 'Those seats could not be held. Your place in line may not be active yet.';
      }
      dispatch({ type: 'HOLD_FAILED', stillFree, message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, uid]);

  const release = useCallback(async () => {
    const { phase, holdIds } = live.current.state;
    if (phase !== Phase.HOLDING) return;
    dispatch({ type: 'RELEASE_REQUESTED' });
    try {
      await seatService.releaseSeats(eventId, holdIds);
      dispatch({ type: 'RELEASED' });
    } catch {
      dispatch({ type: 'RELEASE_FAILED', message: 'Could not release the seats. They will free up when the hold runs out.' });
    }
  }, [eventId]);

  const confirm = useCallback(async () => {
    const { phase, holdIds } = live.current.state;
    if (phase !== Phase.HOLDING) return;
    dispatch({ type: 'PAYMENT_STARTED' });
    await sleep(MOCK_PAYMENT_MS); // stand-in for a payment provider
    try {
      await seatService.confirmBooking(eventId, holdIds, uid);
      dispatch({ type: 'CONFIRM_SUCCEEDED' });
    } catch (err) {
      dispatch({
        type: 'CONFIRM_FAILED',
        message: err.code === ErrorCode.CONFIRM_REJECTED ? err.message : 'Booking failed. Your seats were not charged.',
      });
    }
  }, [eventId, uid]);

  const bookMore = useCallback(() => dispatch({ type: 'BOOK_MORE' }), []);
  const dismissNotice = useCallback(() => dispatch({ type: 'DISMISS_NOTICE' }), []);

  return {
    state,
    hold,
    maxSeats,
    actions: { toggleSeat, holdSelected, release, confirm, bookMore, dismissNotice },
  };
}
