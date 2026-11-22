import './components.css';

/** kind: 'info' | 'warn' | 'error'. Errors interrupt screen readers; the rest wait politely. */
export function Banner({ kind = 'info', children, onDismiss }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p className="banner__text">{children}</p>
      {onDismiss && (
        <button type="button" className="banner__dismiss" onClick={onDismiss} aria-label="Dismiss message">
          ×
        </button>
      )}
    </div>
  );
}
