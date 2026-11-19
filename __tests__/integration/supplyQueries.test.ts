import { getDb } from '@/db/database';
import {
  addSupply,
  deleteSupply,
  getAvailableSupplies,
  getSupplies,
  getSupply,
  getSupplyGroups,
  updateSupply,
} from '@/db/queries/supplyQueries';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const tube = {
  name: '5 ft tube',
  costCents: 4000,
  caseCount: 1,
  sizeAmount: null,
  sizeUnit: null,
  groupName: null,
};
const bail = {
  name: 'Silver bail',
  costCents: 300,
  caseCount: 1,
  sizeAmount: null,
  sizeUnit: null,
  groupName: null,
};

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
      size_amount: null,
      size_unit: null,
      group_name: null,
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

    await updateSupply(supplyId, {
      name: '4 ft tube',
      costCents: 3550,
      caseCount: 1,
      sizeAmount: null,
      sizeUnit: null,
      groupName: null,
    });

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

describe('supply groups', () => {
  function inGroup(name: string, groupName: string | null) {
    return { ...tube, name, groupName };
  }

  // Added oldest first: a rod, a clear tube, a bail with no group, then a newer rod.
  async function addGroupedSupplies() {
    const rodId = await addSupply(inGroup('Cobalt rod', 'Color rods'));
    const tubeId = await addSupply(inGroup('Clear tube', 'Clear tubing'));
    const bailId = await addSupply(inGroup('Silver bail', null));
    const newerRodId = await addSupply(inGroup('Amber rod', 'Color rods'));
    return { rodId, tubeId, bailId, newerRodId };
  }

  // Otherwise the group filter on the Supplies list and Add supply would have no group to match.
  it('returns each supply with its group, newest first, on the list and for a piece', async () => {
    const { rodId, tubeId, bailId, newerRodId } = await addGroupedSupplies();
    const expected = [
      { id: newerRodId, group_name: 'Color rods' },
      { id: bailId, group_name: null },
      { id: tubeId, group_name: 'Clear tubing' },
      { id: rodId, group_name: 'Color rods' },
    ];

    const listed = (await getSupplies()).map(({ id, group_name }) => ({ id, group_name }));
    const offered = (await getAvailableSupplies(null)).map(({ id, group_name }) => ({
      id,
      group_name,
    }));
    expect(listed).toEqual(expected);
    expect(offered).toEqual(expected);
  });

  // Otherwise the Group dropdown would list Color rods once per rod, or offer a blank group.
  it('lists each group once, in alphabetical order', async () => {
    await addGroupedSupplies();

    expect(await getSupplyGroups()).toEqual(['Clear tubing', 'Color rods']);
  });

  // Otherwise a supply filed under the wrong group could never be moved or taken out of it.
  it('changes and takes off a supply group', async () => {
    const { rodId } = await addGroupedSupplies();

    await updateSupply(rodId, inGroup('Cobalt rod', 'Clear tubing'));
    expect(await getSupply(rodId)).toMatchObject({ group_name: 'Clear tubing' });

    await updateSupply(rodId, inGroup('Cobalt rod', null));
    expect(await getSupply(rodId)).toMatchObject({ group_name: null });
  });

  // Otherwise a blank group would show as a heading with no name.
  it('rejects a blank group', async () => {
    await expect(addSupply(inGroup('Cobalt rod', '  '))).rejects.toThrow(/CHECK constraint/);
  });
});
