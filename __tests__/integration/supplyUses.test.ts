import { getDb } from '@/db/database';
import { addPastWork } from '@/db/queries/entryQueries';
import {
  deletePiece,
  finishPiece,
  getPieceDetail,
  getPieces,
  setPieceLost,
} from '@/db/queries/pieceQueries';
import {
  addSupply,
  changeSupplyUse,
  deleteSupply,
  getAvailableSupplies,
  getSupply,
  removeSupplyUse,
} from '@/db/queries/supplyQueries';
import { addPrepUse, addSupplyUse } from '@/db/queries/prepQueries';
import { formatAmount, parseAmount } from '@/utils/prepTime';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

// An unfinished cane, an unfinished vase and bowl, each with an hour of work, and two supplies.
const caneId = 1;
const vaseId = 2;
const bowlId = 3;

const fixturesSql = `
  INSERT INTO pieces (id, name, category) VALUES
    (${caneId}, 'Dichroic cane', 'prep'),
    (${vaseId}, 'Blue vase', 'piece'),
    (${bowlId}, 'Green bowl', 'piece');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${caneId}, '2026-11-01T09:00:00.000Z', '2026-11-01T10:00:00.000Z'),
    (${vaseId}, '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z'),
    (${bowlId}, '2026-11-01T11:00:00.000Z', '2026-11-01T12:00:00.000Z');
`;

const finish = {
  endedAt: '2026-11-01T12:00:00.000Z',
  notes: 'Cobalt',
  photoFileName: null,
  lost: false,
  isTemplate: false,
  sizeAmount: null,
  sizeUnit: null,
  prepUses: [],
};

let database: ReturnType<typeof createTestDb>;
let tubeId: number;
let bailId: number;

function share(numerator: number, denominator: number) {
  return { share_numerator: numerator, share_denominator: denominator };
}

function supplyUse(supplyId: number, numerator: number, denominator: number) {
  return { supplyId, share: share(numerator, denominator) };
}

async function getCostOf(pieceId: number) {
  const piece = (await getPieces()).find((listed) => listed.id === pieceId);
  return { cents: piece?.cost_cents, estimated: piece?.cost_estimated };
}

// The cane finished with the whole $40 tube in it.
async function finishCaneFromWholeTube() {
  await finishPiece(caneId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 1)] });
}

beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
  tubeId = await addSupply({ name: '5 ft tube', costCents: 4000, caseCount: 1 });
  bailId = await addSupply({ name: 'Silver bail', costCents: 300, caseCount: 1 });
});

describe('finishPiece with supplies', () => {
  // Otherwise the supply picked in the panel after Done would be lost when the piece is saved.
  it('saves a piece with its share of a supply', async () => {
    await finishPiece(vaseId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 4)] });

    expect((await getPieceDetail(vaseId))?.usedSupplies).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        supply_id: tubeId,
        supply_name: '5 ft tube',
        supply_cost_cents: 4000,
        size_amount: null,
        size_unit: null,
        ...share(1, 4),
      },
    ]);
  });

  // Otherwise a cane's tube couldn't be recorded, and pieces cut from it would carry no cost.
  it('saves prep with its share of a supply', async () => {
    await finishCaneFromWholeTube();

    expect((await getPieceDetail(caneId))?.usedSupplies).toEqual([
      expect.objectContaining({ piece_id: caneId, supply_id: tubeId, ...share(1, 1) }),
    ]);
  });

  // Otherwise a rejected supply would still leave the piece finished without what it used.
  it('leaves the piece unfinished when a supply use is rejected', async () => {
    await expect(
      finishPiece(vaseId, { ...finish, supplyUses: [supplyUse(tubeId, 0, 4)] }),
    ).rejects.toThrow(/CHECK constraint/);
    expect((await getPieceDetail(vaseId))?.piece.finished_at).toBeNull();
  });

  // Otherwise a supply removed in the panel after Done would stay on the piece.
  it('changes a kept use and removes a dropped one', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    await addSupplyUse(vaseId, supplyUse(bailId, 1, 1));
    const [tubeUse] = (await getPieceDetail(vaseId))?.usedSupplies ?? [];

    await finishPiece(vaseId, {
      ...finish,
      supplyUses: [{ ...supplyUse(tubeId, 1, 2), useId: tubeUse.id }],
    });

    expect((await getPieceDetail(vaseId))?.usedSupplies).toEqual([
      expect.objectContaining({ id: tubeUse.id, supply_id: tubeId, ...share(1, 2) }),
    ]);
  });
});

describe('addSupplyUse', () => {
  // Otherwise a supply would drop out of every list once one prep took a whole one, and its price
  // couldn't go on anything else.
  it('lists and adds a supply a prep already took whole, at its full price each time', async () => {
    await finishCaneFromWholeTube();

    expect((await getAvailableSupplies(vaseId)).map(({ id }) => id)).toContain(tubeId);
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 1));

    expect(await getCostOf(caneId)).toEqual({ cents: 4000, estimated: false });
    expect(await getCostOf(vaseId)).toEqual({ cents: 4000, estimated: false });
  });

  // Otherwise one piece could carry the same supply twice and count its cost twice.
  it('rejects the same supply twice on one piece', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));

    await expect(addSupplyUse(vaseId, supplyUse(tubeId, 1, 8))).rejects.toThrow(
      /UNIQUE constraint/,
    );
  });

  // Otherwise a mistyped amount would put a supply on a piece at no cost.
  it('rejects a share of 0', async () => {
    await expect(addSupplyUse(vaseId, supplyUse(tubeId, 0, 4))).rejects.toThrow(/CHECK constraint/);
  });
});

describe('changeSupplyUse and removeSupplyUse', () => {
  // Otherwise a wrong guess on a piece's page could never be corrected.
  it('changes a use and then removes it', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    const [use] = (await getPieceDetail(vaseId))?.usedSupplies ?? [];

    await changeSupplyUse(use.id, share(1, 2));
    expect(await getCostOf(vaseId)).toEqual({ cents: 2000, estimated: false });

    await removeSupplyUse(use.id);
    expect(await getCostOf(vaseId)).toEqual({ cents: null, estimated: false });
  });

  // Otherwise a stale page could report a change to a removed use as saved.
  it('fails for a use that no longer exists', async () => {
    await expect(changeSupplyUse(999, share(1, 2))).rejects.toThrow(
      'That supply use no longer exists.',
    );
    await expect(removeSupplyUse(999)).rejects.toThrow('That supply use no longer exists.');
  });
});

describe('cost', () => {
  // Otherwise a piece made with an eighth of a cane wouldn't carry its share of the tube.
  it('gives a piece at 1/8 of a cane made from a whole $40 tube $5.00', async () => {
    await finishCaneFromWholeTube();

    await finishPiece(vaseId, {
      ...finish,
      prepUses: [{ prepId: caneId, share: share(1, 8) }],
      supplyUses: [],
    });

    expect(await getCostOf(vaseId)).toEqual({ cents: 500, estimated: true });
    expect(await getCostOf(caneId)).toEqual({ cents: 4000, estimated: false });
  });

  // Otherwise a pendant with a bail would carry only its cane, or only its bail.
  it('adds a supply used directly to the share of a prep', async () => {
    await finishCaneFromWholeTube();

    await finishPiece(bowlId, {
      ...finish,
      prepUses: [{ prepId: caneId, share: share(1, 8) }],
      supplyUses: [supplyUse(bailId, 1, 1)],
    });

    expect(await getCostOf(bowlId)).toEqual({ cents: 800, estimated: true });
  });

  // Otherwise a share of a rod would be marked a guess, or change when another piece uses it.
  it('gives two pieces at 1/4 of a $40 supply $10.00 each, exact', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 4));

    expect(await getCostOf(vaseId)).toEqual({ cents: 1000, estimated: false });
    expect(await getCostOf(bowlId)).toEqual({ cents: 1000, estimated: false });
  });

  // Otherwise the glass that went in the garbage with a broken piece would drop off its cost.
  it('keeps the cost of a lost piece', async () => {
    await finishPiece(vaseId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 4)] });

    await setPieceLost(vaseId, true);

    expect(await getCostOf(vaseId)).toEqual({ cents: 1000, estimated: false });
  });

  // Otherwise a piece caught up on through Add Work would carry no cost.
  it('saves the supplies on Add Work', async () => {
    await addPastWork({
      piece: {
        name: 'Red cup',
        category: 'piece',
        templateId: null,
        sizeAmount: null,
        sizeUnit: null,
      },
      startedAt: '2026-11-02T09:00:00.000Z',
      endedAt: '2026-11-02T10:00:00.000Z',
      photoFileName: null,
      finish: { notes: 'Red', lost: false, isTemplate: false },
      prepUses: [],
      supplyUses: [supplyUse(bailId, 1, 1)],
    });

    const cup = (await getPieces()).find((piece) => piece.name === 'Red cup');
    expect(cup).toMatchObject({ cost_cents: 300, cost_estimated: false });
  });
});

describe('bought by the case', () => {
  // Otherwise a piece using one tube from a case would carry the whole case.
  it('gives a whole tube from a $240 case of 16 $15.00', async () => {
    const caseId = await addSupply({ name: 'Clear tube', costCents: 24000, caseCount: 16 });

    await addSupplyUse(vaseId, supplyUse(caseId, 1, 1));

    expect(await getCostOf(vaseId)).toEqual({ cents: 1500, estimated: false });
  });

  // Otherwise a share of a rod from a case would be a share of the whole case.
  it('gives a piece at 1/4 of a rod from a $100 case of 10 $2.50', async () => {
    const caseId = await addSupply({ name: 'Cobalt rod', costCents: 10000, caseCount: 10 });

    await addSupplyUse(vaseId, supplyUse(caseId, 1, 4));

    expect(await getCostOf(vaseId)).toEqual({ cents: 250, estimated: false });
  });

  // Otherwise a case that doesn't divide evenly would lose or add a fraction of a cent per line.
  it('prices a tube from $250 for 16 at $15.63, in the picker and on the piece', async () => {
    const caseId = await addSupply({ name: 'Clear tube', costCents: 25000, caseCount: 16 });

    await addSupplyUse(vaseId, supplyUse(caseId, 1, 1));

    expect(await getCostOf(vaseId)).toEqual({ cents: 1563, estimated: false });
    expect(
      (await getAvailableSupplies(bowlId)).find((supply) => supply.id === caseId),
    ).toMatchObject({ cost_cents: 1563 });
  });

  // Otherwise "3" rods from a case would be read as 3% of one rod.
  it('lists a case to be entered as a count, and a supply bought singly as a share', async () => {
    const caseId = await addSupply({ name: 'Cobalt rod', costCents: 24000, caseCount: 400 });

    const available = await getAvailableSupplies(vaseId);

    expect(available.find((supply) => supply.id === caseId)).toMatchObject({
      size_amount: 1,
      size_unit: null,
      cost_cents: 60,
    });
    expect(available.find((supply) => supply.id === bailId)).toMatchObject({
      size_amount: null,
      size_unit: null,
    });
  });

  // Otherwise a piece using 3 rods from a case could only take part of one.
  it('gives a piece 3 rods from a $240 case of 400 $1.80, shown as 3', async () => {
    const caseId = await addSupply({ name: 'Cobalt rod', costCents: 24000, caseCount: 400 });
    const [rod] = (await getAvailableSupplies(vaseId)).filter((supply) => supply.id === caseId);

    await addSupplyUse(vaseId, { supplyId: caseId, share: parseAmount('3', rod.size_amount)! });

    const [use] = (await getPieceDetail(vaseId))?.usedSupplies ?? [];
    expect(await getCostOf(vaseId)).toEqual({ cents: 180, estimated: false });
    expect(formatAmount(use, use)).toBe('3');
  });

  // Otherwise a supply bought singly would be divided by a count nobody entered.
  it('prices a supply bought singly at what was typed', async () => {
    await addSupplyUse(vaseId, supplyUse(bailId, 1, 1));

    expect(await getCostOf(vaseId)).toEqual({ cents: 300, estimated: false });
    expect(await getSupply(bailId)).toMatchObject({ cost_cents: 300, case_count: 1 });
  });

  // Otherwise a case of 0 would divide by zero and give every piece using it no real cost.
  it('rejects a case count of 0', async () => {
    await expect(addSupply({ name: 'Clear tube', costCents: 24000, caseCount: 0 })).rejects.toThrow(
      /CHECK constraint/,
    );
  });
});

describe('getSupply counts', () => {
  // Otherwise Delete supply would call a cane a piece and leave out the pieces cut from it.
  it('counts the prep that used it and each piece whose cost it is in, once', async () => {
    await finishPiece(caneId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 2)] });
    await addPrepUse(vaseId, { prepId: caneId, share: share(1, 8) });
    await addPrepUse(bowlId, { prepId: caneId, share: share(1, 8) });
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 4));

    expect(await getSupply(tubeId)).toMatchObject({ prep_count: 1, piece_count: 2 });
    expect(await getSupply(bailId)).toMatchObject({ prep_count: 0, piece_count: 0 });
  });
});

describe('deleting', () => {
  // Otherwise a deleted supply's cost would stay on the pieces that used it.
  it('removes a deleted supply from the pieces that used it, and their cost', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    await addSupplyUse(vaseId, supplyUse(bailId, 1, 1));

    await deleteSupply(tubeId);

    expect((await getPieceDetail(vaseId))?.usedSupplies).toEqual([
      expect.objectContaining({ supply_id: bailId }),
    ]);
    expect(await getCostOf(vaseId)).toEqual({ cents: 300, estimated: false });
  });

  // Otherwise Delete supply would warn about a cost coming off a piece that's already gone.
  it('removes a deleted piece from the supplies it used', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 2));
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 2));

    await deletePiece(vaseId);

    expect(await getSupply(tubeId)).toMatchObject({ piece_count: 1 });
  });
});
