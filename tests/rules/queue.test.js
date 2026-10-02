import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { dbAs, EVENT, seed, setupEnv } from './helpers.js';

const take = (uid, ticket) => ({
  [`counters/${EVENT}/nextTicket`]: ticket + 1,
  [`tickets/${EVENT}/${uid}`]: ticket,
});

let env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

describe('taking a queue ticket', () => {
  it('hands out ticket 0 first', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref().update(take('alice', 0)));
  });

  it('rejects a client that read a stale counter (compare-and-set)', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref().update(take('alice', 0)));
    await assertFails(dbAs(env, 'bob').ref().update(take('bob', 0)));
    await assertSucceeds(dbAs(env, 'bob').ref().update(take('bob', 1)));
  });

  it('rejects skipping ahead', async () => {
    await assertFails(dbAs(env, 'alice').ref().update(take('alice', 4)));
  });

  it('rejects a ticket written without bumping the counter', async () => {
    await assertFails(dbAs(env, 'alice').ref(`tickets/${EVENT}/alice`).set(0));
  });

  it('makes tickets write-once', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref().update(take('alice', 0)));
    await assertFails(dbAs(env, 'alice').ref().update(take('alice', 1)));
  });

  it("rejects taking a ticket in someone else's name", async () => {
    await assertFails(dbAs(env, 'alice').ref().update(take('bob', 0)));
  });

  it('only lets you read your own ticket', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref().update(take('alice', 0)));
    await assertSucceeds(dbAs(env, 'alice').ref(`tickets/${EVENT}/alice`).once('value'));
    await assertFails(dbAs(env, 'bob').ref(`tickets/${EVENT}/alice`).once('value'));
  });

  it('never lets the counter go backwards', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref().update(take('alice', 0)));
    await assertFails(dbAs(env, 'bob').ref(`counters/${EVENT}/nextTicket`).set(0));
  });
});

describe('event config', () => {
  it('is readable by anyone and writable by no client', async () => {
    await assertSucceeds(env.unauthenticatedContext().database().ref(`events/${EVENT}`).once('value'));
    await assertFails(dbAs(env, 'alice').ref(`events/${EVENT}/ttlMs`).set(10 ** 9));
  });
});
