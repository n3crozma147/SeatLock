import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { confirmUpdate, dbAs, EVENT, giveTicket, heldBy, seatRef, seed, setupEnv, TS } from './helpers.js';

let env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
  await giveTicket(env, 'alice', 0);
  await giveTicket(env, 'bob', 1);
});

describe('booking records', () => {
  it('can only be written in the same update that books the seat', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertFails(dbAs(env, 'alice').ref(`bookings/${EVENT}/alice/A1`).set({ bookedAt: TS }));
    await assertSucceeds(dbAs(env, 'alice').ref().update(confirmUpdate('alice')));
  });

  it('cannot be forged for a seat you do not hold', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'bob')).set(heldBy('bob')));
    await assertFails(dbAs(env, 'alice').ref(`bookings/${EVENT}/alice/A1`).set({ bookedAt: TS }));
  });

  it('are private to their owner', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertSucceeds(dbAs(env, 'alice').ref().update(confirmUpdate('alice')));
    await assertSucceeds(dbAs(env, 'alice').ref(`bookings/${EVENT}/alice`).once('value'));
    await assertFails(dbAs(env, 'bob').ref(`bookings/${EVENT}/alice`).once('value'));
  });
});
