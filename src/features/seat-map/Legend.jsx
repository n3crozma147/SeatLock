const ITEMS = [
  ['free', 'Available'],
  ['selected', 'Selected'],
  ['mine', 'Held for you'],
  ['held', 'On hold'],
  ['booked', 'Sold'],
];

export function Legend() {
  return (
    <ul className="legend">
      {ITEMS.map(([key, label]) => (
        <li key={key}>
          <span className={`legend__swatch seat--${key}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
