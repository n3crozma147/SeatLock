import { useEffect, useState } from 'react';
import { eventService } from '../services/index.js';

export function useEvent(eventId) {
  const [state, setState] = useState({ event: null, loading: true, error: null });

  useEffect(() => {
    return eventService.subscribeEvent(
      eventId,
      (event) => setState({ event, loading: false, error: null }),
      (error) => setState({ event: null, loading: false, error }),
    );
  }, [eventId]);

  return state;
}
