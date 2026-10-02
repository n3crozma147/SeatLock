import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminRead, confirmUpdate, dbAs, EVENT, giveTicket, heldBy, seatRef, seed, setupEnv, sleep } from './helpers.js';

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

describe('acquiring a hold', () => {
  it('lets an admitted user hold a free seat', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('rejects a hold on a seat someone else is holding', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertFails(seatRef(dbAs(env, 'bob')).set(heldBy('bob')));
  });

  it('lets exactly one of two racing users win', async () => {
    const results = await Promise.allSettled([
      seatRef(dbAs(env, 'alice')).set(heldBy('alice')),
      seatRef(dbAs(env, 'bob')).set(heldBy('bob')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it("rejects holding a seat in someone else's name", async () => {
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('bob')));
  });

  it('rejects a client-chosen lockedAt (no extending holds by lying about time)', async () => {
    const forged = { status: 'held', holder: 'alice', lockedAt: Date.now() + 3_600_000 };
    await assertFails(seatRef(dbAs(env, 'alice')).set(forged));
  });

  it('rejects re-holding your own active hold (which would reset the timer)', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });

  it('rejects writing a seat straight to booked', async () => {
    const booked = { status: 'booked', holder: 'alice', lockedAt: { '.sv': 'timestamp' }, bookedAt: { '.sv': 'timestamp' } };
    await assertFails(seatRef(dbAs(env, 'alice')).set(booked));
  });

  it('rejects malformed seat IDs and extra fields', async () => {
    await assertFails(seatRef(dbAs(env, 'alice'), 'not-a-seat').set(heldBy('alice')));
    await assertFails(seatRef(dbAs(env, 'alice')).set({ ...heldBy('alice'), price: 0 }));
  });

  it('holds several seats atomically: all or nothing', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'bob'), 'A2').set(heldBy('bob')));
    await assertFails(
      dbAs(env, 'alice').ref().update({
        [`seats/${EVENT}/A1`]: heldBy('alice'),
        [`seats/${EVENT}/A2`]: heldBy('alice'),
      }),
    );
    expect(await adminRead(env, `seats/${EVENT}/A1`)).toBeNull();
  });
});

describe('admission', () => {
  it('rejects a hold from a user with no ticket', async () => {
    await assertFails(seatRef(dbAs(env, 'carol')).set(heldBy('carol')));
  });

  it('rejects a hold from a user whose ticket is not admitted yet', async () => {
    await giveTicket(env, 'dave', 10_000);
    await assertFails(seatRef(dbAs(env, 'dave')).set(heldBy('dave')));
  });

  it('rejects every hold before the sale starts', async () => {
    await seed(env, { saleStart: Date.now() + 60_000 });
    await giveTicket(env, 'alice', 0);
    await assertFails(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
  });
});

describe('expiry', () => {
  it('lets anyone reclaim a seat once the hold expires (lazy expiry)', async () => {
    await seed(env, { ttlMs: 300 });
    await giveTicket(env, 'alice', 0);
    await giveTicket(env, 'bob', 1);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await sleep(600);
    await assertSucceeds(seatRef(dbAs(env, 'bob')).set(heldBy('bob')));
  });
});

describe('confirming a booking', () => {
  it('lets the holder confirm within the TTL', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertSucceeds(dbAs(env, 'alice').ref().update(confirmUpdate('alice')));
    const seat = await adminRead(env, `seats/${EVENT}/A1`);
    expect(seat.status).toBe('booked');
  });

  it('rejects confirmation by anyone but the holder', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertFails(dbAs(env, 'bob').ref().update(confirmUpdate('bob')));
  });

  it('rejects confirmation after the hold expires', async () => {
    await seed(env, { ttlMs: 300 });
    await giveTicket(env, 'alice', 0);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await sleep(600);
    await assertFails(dbAs(env, 'alice').ref().update(confirmUpdate('alice')));
  });

  it('makes bookings final: no release, no re-hold, even after the TTL', async () => {
    await seed(env, { ttlMs: 300 });
    await giveTicket(env, 'alice', 0);
    await giveTicket(env, 'bob', 1);
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertSucceeds(dbAs(env, 'alice').ref().update(confirmUpdate('alice')));
    await sleep(600);
    await assertFails(seatRef(dbAs(env, 'alice')).remove());
    await assertFails(seatRef(dbAs(env, 'bob')).set(heldBy('bob')));
  });
});

describe('releasing a hold', () => {
  it('lets the holder release', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertSucceeds(seatRef(dbAs(env, 'alice')).remove());
  });

  it('rejects release by anyone else', async () => {
    await assertSucceeds(seatRef(dbAs(env, 'alice')).set(heldBy('alice')));
    await assertFails(seatRef(dbAs(env, 'bob')).remove());
  });
});
