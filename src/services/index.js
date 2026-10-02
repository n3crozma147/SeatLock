// The app's service instances, bound to the browser Firebase app.
// Scripts and tests import the create*Service factories directly instead,
// passing their own database handle, so they exercise the exact same code.

import { auth, db } from '../config/firebase.js';
import { createAuthService } from './authService.js';
import { createClockService } from './clockService.js';
import { createEventService } from './eventService.js';
import { createQueueService } from './queueService.js';
import { createSeatService } from './seatService.js';

export const authService = createAuthService(auth);
export const clockService = createClockService(db);
export const eventService = createEventService(db);
export const queueService = createQueueService(db);
export const seatService = createSeatService(db);
