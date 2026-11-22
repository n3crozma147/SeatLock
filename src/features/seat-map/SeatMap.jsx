import { useMemo } from 'react';
import { generateLayout } from '../../lib/seatLayout.js';
import { deriveSeatStatus } from '../../lib/seatState.js';
import { Legend } from './Legend.jsx';
import { Seat } from './Seat.jsx';
import { Stage } from './Stage.jsx';
import './SeatMap.css';

export function SeatMap({ event, seats, version, uid, now, selected, interactive, onToggle }) {
  const layout = useMemo(() => generateLayout(event.rows, event.cols), [event.rows, event.cols]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const aisleAfter = event.cols >= 10 ? Math.floor(event.cols / 2) : -1;

  // `version` is read so this component re-renders when the mutable seat Map changes.
  void version;

  return (
    <section className="seat-map" aria-label="Seat map">
      <Stage />
      <div className="seat-map__scroll">
        <div className="seat-map__rows">
          {layout.map((row) => (
            <div className="seat-row" key={row.label} role="group" aria-label={`Row ${row.label}`}>
              <span className="seat-row__label" aria-hidden="true">
                {row.label}
              </span>
              {row.seats.map((id, col) => (
                <Seat
                  key={id}
                  id={id}
                  number={col + 1}
                  status={deriveSeatStatus(seats.get(id), now, uid, event.ttlMs)}
                  selected={selectedSet.has(id)}
                  interactive={interactive}
                  aisle={col + 1 === aisleAfter}
                  onToggle={onToggle}
                />
              ))}
              <span className="seat-row__label" aria-hidden="true">
                {row.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <Legend />
    </section>
  );
}
