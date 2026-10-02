import { useEffect, useState } from 'react';
import { serverNow } from '../lib/serverClock.js';
import { clockService } from '../services/index.js';

/** Estimated server time, re-rendering every `tickMs`. */
export function useServerClock(tickMs = 1000) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => clockService.subscribeServerOffset(setOffset), []);

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow(offset)), tickMs);
    return () => clearInterval(id);
  }, [offset, tickMs]);

  return { now, offset };
}
