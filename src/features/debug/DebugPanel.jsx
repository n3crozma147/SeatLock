import './DebugPanel.css';

/** Add ?debug to the URL to see what the client believes. Useful when demoing races. */
export function DebugPanel({ rows }) {
  return (
    <aside className="debug-panel" aria-label="Debug information">
      <dl>
        {Object.entries(rows).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
