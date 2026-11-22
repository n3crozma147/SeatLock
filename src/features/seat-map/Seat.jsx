import { memo } from 'react';
import { SeatStatus } from '../../lib/seatState.js';

const DESCRIPTION = {
  [SeatStatus.FREE]: 'available',
  [SeatStatus.MINE]: 'held for you',
  [SeatStatus.HELD]: 'on hold for someone else',
  [SeatStatus.BOOKED]: 'sold',
  [SeatStatus.MINE_BOOKED]: 'booked by you',
};

/** Re-renders only when its own status or selection changes. */
export const Seat = memo(function Seat({ id, number, status, selected, interactive, aisle, onToggle }) {
  const clickable = interactive && status === SeatStatus.FREE;
  const classes = ['seat', `seat--${status}`, selected && 'seat--selected', aisle && 'seat--aisle']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      disabled={!clickable}
      aria-pressed={clickable ? selected : undefined}
      aria-label={`Seat ${id}, ${selected ? 'selected' : DESCRIPTION[status]}`}
      onClick={() => onToggle(id)}
    >
      {number}
    </button>
  );
});
