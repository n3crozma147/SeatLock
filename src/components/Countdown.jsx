import { formatDuration } from '../lib/format.js';
import './components.css';

export function Countdown({ ms, className = '' }) {
  return <span className={`countdown ${className}`.trim()}>{formatDuration(ms)}</span>;
}
