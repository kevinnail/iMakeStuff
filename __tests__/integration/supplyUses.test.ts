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
  addSupplyUse,
  changeSupplyUse,
  deleteSupply,
  getAvailableSupplies,
  getSupply,
  removeSupplyUse,
  setSupplyUsedUp,
} from '@/db/queries/supplyQueries';
import { addPrepUse } from '@/db/queries/prepQueries';
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
  tubeId = await addSupply({
    name: '5 ft tube',
    costCents: 4000,
  });
  bailId = await addSupply({
    name: 'Silver bail',
    costCents: 300,
  });
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
        used_up: 0,
        measured: 0,
        shares_total: 0.25,
      },
    ]);
  });

  // Otherwise a cane's tube couldn't be recorded, and pieces cut from it would carry no cost.
  it('saves prep with its share of a supply', async () => {
    await finishCaneFromWholeTube();

    expect((await getPieceDetail(caneId))?.usedSupplies).toEqual([
      expect.objectContaining({ piece_id: caneId, supply_id: tubeId, ...share(1, 1), used_up: 1 }),
    ]);
  });

  // Otherwise a rejected supply would still leave the piece finished without what it used.
  it('leaves the piece unfinished when a supply use is rejected', async () => {
    await setSupplyUsedUp(tubeId, true);

    await expect(
      finishPiece(vaseId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 4)] }),
    ).rejects.toThrow("Only a supply that isn't all used can be added.");
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
  // Otherwise a tube that's gone could keep collecting shares from new pieces.
  it('rejects a supply marked all used, or one use took all of', async () => {
    await setSupplyUsedUp(bailId, true);
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 1));

    for (const supplyId of [bailId, tubeId]) {
      await expect(addSupplyUse(caneId, supplyUse(supplyId, 1, 8))).rejects.toThrow(
        "Only a supply that isn't all used can be added.",
      );
    }
    expect(await getAvailableSupplies(caneId)).toEqual([]);
  });

  // Otherwise one piece could carry the same supply twice and count its cost twice.
  it('rejects the same supply twice on one piece', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));

    await expect(addSupplyUse(vaseId, supplyUse(tubeId, 1, 8))).rejects.toThrow(
      /UNIQUE constraint/,
    );
  });

  // Otherwise a mistyped amount would put no share, or more than the whole supply, on a piece.
  it('rejects a share of 0 or over 1', async () => {
    await expect(addSupplyUse(vaseId, supplyUse(tubeId, 0, 4))).rejects.toThrow(/CHECK constraint/);
    await expect(addSupplyUse(vaseId, supplyUse(tubeId, 5, 4))).rejects.toThrow(/CHECK constraint/);
  });
});

describe('changeSupplyUse and removeSupplyUse', () => {
  // Otherwise a wrong guess on a piece's page could never be corrected.
  it('changes a use and then removes it', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    const [use] = (await getPieceDetail(vaseId))?.usedSupplies ?? [];

    await changeSupplyUse(use.id, share(1, 2));
    expect(await getCostOf(vaseId)).toEqual({ cents: 2000, estimated: true });

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

  // Otherwise points pulled from a whole tube would show their cost as a guess until something else closed.
  it('gives a piece at 1 of 8 points from a whole $40 tube $5.00, not estimated', async () => {
    await finishPiece(caneId, {
      ...finish,
      sizeAmount: 8,
      sizeUnit: 'points',
      supplyUses: [supplyUse(tubeId, 1, 1)],
    });

    await finishPiece(vaseId, {
      ...finish,
      prepUses: [{ prepId: caneId, share: share(1, 8) }],
      supplyUses: [],
    });

    expect(await getCostOf(vaseId)).toEqual({ cents: 500, estimated: false });
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

  // Otherwise the leftover of a used-up tube, waste included, would be paid for by nobody.
  it('gives two pieces at 1/4 of a $40 supply $10.00 each, then $20.00 once it is used up', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 4));
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 4));

    expect(await getCostOf(vaseId)).toEqual({ cents: 1000, estimated: true });
    expect(await getCostOf(bowlId)).toEqual({ cents: 1000, estimated: true });

    await setSupplyUsedUp(tubeId, true);

    expect(await getCostOf(vaseId)).toEqual({ cents: 2000, estimated: false });
    expect(await getCostOf(bowlId)).toEqual({ cents: 2000, estimated: false });
  });

  // Otherwise the glass that went in the garbage with a broken piece would drop off its cost.
  it('keeps the cost of a lost piece', async () => {
    await finishPiece(vaseId, { ...finish, supplyUses: [supplyUse(tubeId, 1, 4)] });

    await setPieceLost(vaseId, true);

    expect(await getCostOf(vaseId)).toEqual({ cents: 1000, estimated: true });
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
      finish: { notes: 'Red', lost: false },
      prepUses: [],
      supplyUses: [supplyUse(bailId, 1, 1)],
    });

    const cup = (await getPieces()).find((piece) => piece.name === 'Red cup');
    expect(cup).toMatchObject({ cost_cents: 300, cost_estimated: false });
  });
});

describe('closing a supply', () => {
  // Otherwise guesses on a rod that runs long would close it at 100% and refuse the next piece.
  it('leaves a supply open at 100% from several uses, taking another use', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 2));
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 2));

    await addSupplyUse(caneId, supplyUse(tubeId, 1, 4));

    expect(await getSupply(tubeId)).toMatchObject({ used_share: 1.25, used_up: 0 });
  });

  // Otherwise turning All used off would look like it worked on a tube one prep took all of.
  it('refuses to turn All used off while one use takes all of it', async () => {
    await finishCaneFromWholeTube();

    await expect(setSupplyUsedUp(tubeId, false)).rejects.toThrow(
      'One use takes all of it. Lower it to turn All used off.',
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

  // Otherwise a deleted piece's shares would keep the supply from being used up properly.
  it('removes a deleted piece from the supplies it used', async () => {
    await addSupplyUse(vaseId, supplyUse(tubeId, 1, 2));
    await addSupplyUse(bowlId, supplyUse(tubeId, 1, 2));

    await deletePiece(vaseId);

    expect(await getAvailableSupplies(caneId)).toEqual([
      { id: bailId, name: 'Silver bail', size_amount: null, size_unit: null, used_share: 0 },
      { id: tubeId, name: '5 ft tube', size_amount: null, size_unit: null, used_share: 0.5 },
    ]);
  });
});
