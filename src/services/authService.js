import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

export function createAuthService(auth) {
  /** Resolves to a uid, signing in anonymously if needed. Reuses the session across reloads. */
  async function ensureSignedIn() {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser.uid;
    const credential = await signInAnonymously(auth);
    return credential.user.uid;
  }

  function onUserChanged(callback) {
    return onAuthStateChanged(auth, callback);
  }

  return { ensureSignedIn, onUserChanged };
}
