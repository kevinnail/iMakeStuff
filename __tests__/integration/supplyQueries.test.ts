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

const noCount = { sizeAmount: null, sizeUnit: null };
const tube = { name: '5 ft tube', costCents: 4000, ...noCount };
const bail = { name: 'Silver bail', costCents: 300, ...noCount };

beforeEach(() => {
  (getDb as jest.Mock).mockResolvedValue(createTestDb());
});

describe('addSupply', () => {
  // Otherwise a supply added from the panel would be missing from the list, carry the wrong cost, or lose when its price was entered.
  it('saves its name, cost in cents, and when it was added', async () => {
    const supplyId = await addSupply(tube);

    expect(await getSupply(supplyId)).toEqual({
      id: supplyId,
      name: '5 ft tube',
      cost_cents: 4000,
      used_up_at: null,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      size_amount: null,
      size_unit: null,
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
  it('lists supplies that can be used first, newest first', async () => {
    const tubeId = await addSupply(tube);
    const bailId = await addSupply(bail);
    const newerTubeId = await addSupply(tube);
    await setSupplyUsedUp(bailId, true);

    expect((await getSupplies()).map((supply) => supply.id)).toEqual([newerTubeId, tubeId, bailId]);
  });
});

describe('updateSupply', () => {
  // Otherwise a cost typed wrong when the supply was added could never be corrected.
  it('changes its name and cost', async () => {
    const supplyId = await addSupply(tube);

    await updateSupply(supplyId, { name: '4 ft tube', costCents: 3550, ...noCount });

    expect(await getSupply(supplyId)).toMatchObject({ name: '4 ft tube', cost_cents: 3550 });
  });

  // Otherwise a box bought by the tube couldn't be priced per tube.
  it('saves what a supply holds, and turns it back to by eye', async () => {
    const supplyId = await addSupply(tube);

    await updateSupply(supplyId, { ...tube, sizeAmount: 16, sizeUnit: 'tubes' });
    expect(await getSupply(supplyId)).toMatchObject({ size_amount: 16, size_unit: 'tubes' });

    await updateSupply(supplyId, tube);
    expect(await getSupply(supplyId)).toMatchObject({ size_amount: null, size_unit: null });
  });

  // Otherwise a count with no unit, or a count of 0, would divide a price into nothing.
  it.each([
    ['a count without a unit', { sizeAmount: 16, sizeUnit: null }],
    ['a count of 0', { sizeAmount: 0, sizeUnit: 'tubes' }],
    ['a blank unit', { sizeAmount: 16, sizeUnit: ' ' }],
  ])('rejects %s', async (_case, count) => {
    await expect(addSupply({ ...tube, ...count })).rejects.toThrow(/CHECK constraint/);
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
