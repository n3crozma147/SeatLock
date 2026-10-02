// Seat IDs look like "A1", "C12": one row letter, then a 1-based seat number.
// The security rules accept exactly this shape (/^[A-Z][0-9]+$/).

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const MAX_ROWS = ROW_LABELS.length;
export const MAX_COLS = 99;

export function rowLabel(rowIndex) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) {
    throw new RangeError(`rowIndex must be an integer in [0, ${MAX_ROWS - 1}], got ${rowIndex}`);
  }
  return ROW_LABELS[rowIndex];
}

export function seatId(rowIndex, colIndex) {
  return `${rowLabel(rowIndex)}${colIndex + 1}`;
}

/** [{ label: "A", seats: ["A1", "A2", ...] }, ...] */
export function generateLayout(rows, cols) {
  if (!Number.isInteger(cols) || cols < 1 || cols > MAX_COLS) {
    throw new RangeError(`cols must be an integer in [1, ${MAX_COLS}], got ${cols}`);
  }
  return Array.from({ length: rows }, (_, r) => ({
    label: rowLabel(r),
    seats: Array.from({ length: cols }, (_, c) => seatId(r, c)),
  }));
}

export function parseSeatId(id) {
  const match = /^([A-Z])([0-9]+)$/.exec(id);
  if (!match) return null;
  return { row: ROW_LABELS.indexOf(match[1]), col: Number(match[2]) - 1 };
}

/** Sort comparator: row first, then seat number numerically (A2 before A10). */
export function compareSeatIds(a, b) {
  const pa = parseSeatId(a);
  const pb = parseSeatId(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.row - pb.row || pa.col - pb.col;
}
