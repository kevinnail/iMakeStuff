import { getDb } from '@/db/database';
import {
  addSupply,
  deleteSupply,
  getSupplies,
  getSupply,
  setSupplyUsedUp,
  updateSupply,
} from '@/db/queries/supplyQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const tube = { name: '5 ft tube', costCents: 4000, boughtAt: '2026-11-01T17:00:00.000Z' };
const bail = { name: 'Silver bail', costCents: 300, boughtAt: '2026-11-03T17:00:00.000Z' };

beforeEach(() => {
  (getDb as jest.Mock).mockResolvedValue(createTestDb());
});

describe('addSupply', () => {
  // Otherwise a supply added from the panel would be missing from the list or carry the wrong cost.
  it('saves its name, cost in cents, and the day it was bought', async () => {
    const supplyId = await addSupply(tube);

    expect(await getSupply(supplyId)).toEqual({
      id: supplyId,
      name: '5 ft tube',
      cost_cents: 4000,
      bought_at: '2026-11-01T17:00:00.000Z',
      used_up_at: null,
      used_share: 0,
      used_up: 0,
      prep_count: 0,
      piece_count: 0,
    });
  });

  // Otherwise a supply with no name could be saved and never told apart from the others.
  it('rejects a blank name', async () => {
    await expect(addSupply({ ...tube, name: '  ' })).rejects.toThrow(/CHECK constraint/);
    expect(await getSupplies()).toEqual([]);
  });

  // Otherwise a negative cost would take money off every piece that used the supply.
  it('rejects a negative cost', async () => {
    await expect(addSupply({ ...tube, costCents: -500 })).rejects.toThrow(/CHECK constraint/);
  });
});

describe('getSupplies', () => {
  // Otherwise a used-up tube would sit above the ones that can still be used.
  it('lists supplies that can be used first, newest bought first', async () => {
    const tubeId = await addSupply(tube);
    const bailId = await addSupply(bail);
    const olderTubeId = await addSupply({ ...tube, boughtAt: '2026-10-01T17:00:00.000Z' });
    await setSupplyUsedUp(bailId, true);

    expect((await getSupplies()).map((supply) => supply.id)).toEqual([tubeId, olderTubeId, bailId]);
  });
});

describe('updateSupply', () => {
  // Otherwise a cost typed wrong when the supply was added could never be corrected.
  it('changes its name, cost, and the day it was bought', async () => {
    const supplyId = await addSupply(tube);

    await updateSupply(supplyId, {
      name: '4 ft tube',
      costCents: 3550,
      boughtAt: '2026-10-30T17:00:00.000Z',
    });

    expect(await getSupply(supplyId)).toMatchObject({
      name: '4 ft tube',
      cost_cents: 3550,
      bought_at: '2026-10-30T17:00:00.000Z',
    });
  });

  // Otherwise a stale page could report a change to a deleted supply as saved.
  it('fails for a supply that no longer exists', async () => {
    await expect(updateSupply(999, tube)).rejects.toThrow('That supply no longer exists.');
  });
});

describe('setSupplyUsedUp', () => {
  // Otherwise a tube that's gone would stay offered, or a mistaken Used up couldn't be undone.
  it('marks a supply used up and puts it back in use', async () => {
    const supplyId = await addSupply(tube);

    await setSupplyUsedUp(supplyId, true);
    expect((await getSupply(supplyId))?.used_up_at).toEqual(expect.any(String));

    await setSupplyUsedUp(supplyId, false);
    expect((await getSupply(supplyId))?.used_up_at).toBeNull();
  });

  // Otherwise a second tap would move the used up date, or a stale switch would look like it worked.
  it('fails for a supply already in the state asked for', async () => {
    const supplyId = await addSupply(tube);

    await expect(setSupplyUsedUp(supplyId, false)).rejects.toThrow(
      "That supply isn't marked all used.",
    );
    await setSupplyUsedUp(supplyId, true);
    await expect(setSupplyUsedUp(supplyId, true)).rejects.toThrow(
      'That supply is already marked all used.',
    );
  });
});

describe('deleteSupply', () => {
  // Otherwise a supply entered by mistake would stay on the list, or take another one with it.
  it('removes the supply and leaves the others', async () => {
    const tubeId = await addSupply(tube);
    const bailId = await addSupply(bail);

    await deleteSupply(tubeId);

    expect(await getSupply(tubeId)).toBeNull();
    expect((await getSupplies()).map((supply) => supply.id)).toEqual([bailId]);
  });

  // Otherwise deleting from a stale page would look like it worked.
  it('fails for a supply that no longer exists', async () => {
    await expect(deleteSupply(999)).rejects.toThrow('That supply no longer exists.');
  });
});
