import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminRead, dbAs, EVENT, giveTicket, heldBy, seatRef, seed, setNowServing, setupEnv } from './helpers.js';

let env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.cleanup();
});

describe('occupancy mode: admission follows nowServing', () => {
  beforeEach(async () => {
    // The sale started a minute ago with a generous time schedule, so only
    // nowServing (not the time formula) can be what decides admission here.
    await seed(env, { admissionMode: 'occupancy', capacity: 5 });
    await setNowServing(env, 0);
    await giveTicket(env, 'alice', 0);
    await giveTicket(env, 'bob', 1);
    await giveTicket(env, 'carol', 5);
  });

  it('rejects a hold while ticket >= nowServing', async () => {
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('alice'))); // 0 >= 0
    await setNowServing(env, 1);
    await assertFails(seatRef(dbAs(env, 'bob')).set(heldBy('bob'))); // 1 >= 1
  });

  it('accepts a hold once ticket < nowServing', async () => {
    await setNowServing(env, 1);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await setNowServing(env, 2);
    await assertSucceeds(seatRef(dbAs(env, 'bob'), 'A2').set(heldBy('bob')));
  });

  it('ignores the time schedule: an old sale start does not admit a ticket nowServing has not reached', async () => {
    await setNowServing(env, 5);
    await assertFails(seatRef(dbAs(env, 'carol')).set(heldBy('carol'))); // 5 >= 5, despite a 60s-old sale
    await setNowServing(env, 6);
    await assertSucceeds(seatRef(dbAs(env, 'carol')).set(heldBy('carol')));
  });

  it('admits regardless of a future saleStart (the coordinator owns timing in this mode)', async () => {
    await seed(env, { admissionMode: 'occupancy', capacity: 5, saleStart: Date.now() + 3_600_000 });
    await setNowServing(env, 1);
    await giveTicket(env, 'alice', 0);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('fails closed when nowServing does not exist', async () => {
    await seed(env, { admissionMode: 'occupancy', capacity: 5 });
    await giveTicket(env, 'alice', 0);
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('rejects a user with no ticket even when nowServing is high', async () => {
    await setNowServing(env, 1000);
    await assertFails(seatRef(dbAs(env, 'nobody')).set(heldBy('nobody')));
  });

  it('holds several seats atomically and admits on nowServing', async () => {
    await setNowServing(env, 1);
    await assertSucceeds(
      dbAs(env, 'alice').ref().update({
        [`seats/${EVENT}/A1`]: heldBy('alice'),
        [`seats/${EVENT}/A2`]: heldBy('alice'),
      }),
    );
    await assertFails(
      dbAs(env, 'bob').ref().update({
        [`seats/${EVENT}/B1`]: heldBy('bob'), // bob's ticket (1) is not < 1
        [`seats/${EVENT}/B2`]: heldBy('bob'),
      }),
    );
    expect(await adminRead(env, `seats/${EVENT}/B1`)).toBeNull();
  });
});

describe('nowServing and the coordinator node belong to the coordinator', () => {
  beforeEach(async () => {
    await seed(env, { admissionMode: 'occupancy', capacity: 5 });
    await setNowServing(env, 3);
    await giveTicket(env, 'alice', 0);
  });

  it('lets signed-in users read nowServing but not unauthenticated ones', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref(`counters/${EVENT}/nowServing`).once('value'));
    await assertFails(env.unauthenticatedContext().database().ref(`counters/${EVENT}/nowServing`).once('value'));
  });

  it('rejects any client write to nowServing', async () => {
    const ref = dbAs(env, 'alice').ref(`counters/${EVENT}/nowServing`);
    await assertFails(ref.set(4)); // forward
    await assertFails(ref.set(1000)); // admit everyone
    await assertFails(ref.set(0)); // backward
    await assertFails(ref.remove());
    await assertFails(dbAs(env, 'alice').ref().update({ [`counters/${EVENT}/nowServing`]: 4 }));
    expect(await adminRead(env, `counters/${EVENT}/nowServing`)).toBe(3);
  });

  it('rejects writing nowServing together with a legal ticket write', async () => {
    await assertFails(
      dbAs(env, 'bob').ref().update({
        [`counters/${EVENT}/nextTicket`]: 1,
        [`tickets/${EVENT}/bob`]: 0,
        [`counters/${EVENT}/nowServing`]: 999,
      }),
    );
  });

  it('rejects a client creating nowServing when it does not exist', async () => {
    await seed(env, { admissionMode: 'occupancy', capacity: 5 });
    await assertFails(dbAs(env, 'alice').ref(`counters/${EVENT}/nowServing`).set(1));
  });

  it('keeps coordinator/ closed to clients', async () => {
    await assertFails(dbAs(env, 'alice').ref(`coordinator/${EVENT}/admitted/0`).set({ uid: 'alice', admittedAt: 1 }));
    await assertFails(dbAs(env, 'alice').ref(`coordinator/${EVENT}`).once('value'));
  });

  it('still lets users take queue tickets as before', async () => {
    await assertSucceeds(
      dbAs(env, 'bob').ref().update({
        [`counters/${EVENT}/nextTicket`]: 1,
        [`tickets/${EVENT}/bob`]: 0,
      }),
    );
  });
});

describe('time mode is unchanged', () => {
  it('ignores nowServing when admissionMode is "time"', async () => {
    await seed(env, { admissionMode: 'time', capacity: 5 });
    await setNowServing(env, 100_000); // would admit everyone in occupancy mode
    await giveTicket(env, 'dave', 10_000); // 10_000s of schedule needed; only 60s elapsed
    await assertFails(seatRef(dbAs(env, 'dave')).set(heldBy('dave')));
    await giveTicket(env, 'alice', 0);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('treats a missing admissionMode as time mode', async () => {
    await seed(env); // no admissionMode in the config at all
    await setNowServing(env, 100_000);
    await giveTicket(env, 'dave', 10_000);
    await assertFails(seatRef(dbAs(env, 'dave')).set(heldBy('dave')));
    await giveTicket(env, 'alice', 0);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('still rejects every hold before the sale starts', async () => {
    await seed(env, { admissionMode: 'time', saleStart: Date.now() + 60_000 });
    await giveTicket(env, 'alice', 0);
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });
});
