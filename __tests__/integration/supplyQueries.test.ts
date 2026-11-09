import { getDb } from '@/db/database';
import {
  addSupply,
  deleteSupply,
  getSupplies,
  getSupply,
  updateSupply,
} from '@/db/queries/supplyQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const tube = { name: '5 ft tube', costCents: 4000, caseCount: 1 };
const bail = { name: 'Silver bail', costCents: 300, caseCount: 1 };

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
      case_count: 1,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      priced_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
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
  // Otherwise the supply just bought would be buried under older ones.
  it('lists supplies newest first', async () => {
    const tubeId = await addSupply(tube);
    const bailId = await addSupply(bail);
    const newerTubeId = await addSupply(tube);

    expect((await getSupplies()).map((supply) => supply.id)).toEqual([newerTubeId, bailId, tubeId]);
  });
});

describe('updateSupply', () => {
  // Otherwise a cost typed wrong when the supply was added could never be corrected.
  it('changes its name and cost', async () => {
    const supplyId = await addSupply(tube);

    await updateSupply(supplyId, { name: '4 ft tube', costCents: 3550, caseCount: 1 });

    expect(await getSupply(supplyId)).toMatchObject({ name: '4 ft tube', cost_cents: 3550 });
  });

  // Otherwise a stale page could report a change to a deleted supply as saved.
  it('fails for a supply that no longer exists', async () => {
    await expect(updateSupply(999, tube)).rejects.toThrow('That supply no longer exists.');
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
