import { useEffect, useState } from 'react';
import { authService } from '../services/index.js';

export function useAuth() {
  const [state, setState] = useState({ uid: null, ready: false, error: null });

  useEffect(() => {
    let cancelled = false;
    authService
      .ensureSignedIn()
      .then((uid) => !cancelled && setState({ uid, ready: true, error: null }))
      .catch((error) => !cancelled && setState({ uid: null, ready: true, error }));
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
