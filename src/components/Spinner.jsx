import './components.css';

export function Spinner({ label }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      <span className="spinner__label">{label}</span>
    </div>
  );
}
