import { getDb } from '@/db/database';
import { addPastWork } from '@/db/queries/entryQueries';
import { finishPiece, getPieceDetail, getPieces } from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  addSupplyUse,
  getAvailablePrep,
  getPrepPrice,
  setPrepUsedUp,
} from '@/db/queries/prepQueries';
import { addSupply, getSupply, updateSupply } from '@/db/queries/supplyQueries';
import { parseAmount } from '@/utils/prepTime';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const minute = 60 * 1000;

const loopError = "A prep can't use itself or prep made from it.";
const addPrepError =
  "Only finished prep that isn't all used or lost can be added, and counted prep only by its template.";

// Points pulled from a tube in 40 minutes, a cane pulled in 30, beads made in 20, a frit mix
// mixed in 20, and a vase and a bowl to make from them.
const pointsId = 1;
const caneId = 2;
const beadsId = 3;
const fritId = 4;
const vaseId = 5;
const bowlId = 6;

const fixturesSql = `
  INSERT INTO pieces (id, name, category) VALUES
    (${pointsId}, 'Points, 30 mm', 'prep'),
    (${caneId}, 'Blue cane', 'prep'),
    (${beadsId}, 'Frit beads', 'prep'),
    (${fritId}, 'Frit mix', 'prep'),
    (${vaseId}, 'Blue vase', 'piece'),
    (${bowlId}, 'Green bowl', 'piece');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${pointsId}, '2026-11-01T08:00:00.000Z', '2026-11-01T08:40:00.000Z'),
    (${caneId}, '2026-11-01T09:00:00.000Z', '2026-11-01T09:30:00.000Z'),
    (${beadsId}, '2026-11-01T10:00:00.000Z', '2026-11-01T10:20:00.000Z'),
    (${fritId}, '2026-11-01T07:00:00.000Z', '2026-11-01T07:20:00.000Z'),
    (${vaseId}, '2026-11-01T11:00:00.000Z', '2026-11-01T12:00:00.000Z'),
    (${bowlId}, '2026-11-01T12:00:00.000Z', '2026-11-01T13:00:00.000Z');
`;

const finish = {
  endedAt: '2026-11-01T14:00:00.000Z',
  notes: 'Clear',
  photoFileName: null,
  lost: false,
  isTemplate: false,
  sizeAmount: null,
  sizeUnit: null,
  prepUses: [],
  supplyUses: [],
};

const whole = { share_numerator: 1, share_denominator: 1 };

let database: ReturnType<typeof createTestDb>;
let tubeId: number;
let fritBagId: number;

// Points, typed the way a prep enters them: "2" of 8.
function points(amount: string) {
  return { prepId: pointsId, share: parseAmount(amount, 8)! };
}

function byEye(prepId: number, amount: string) {
  return { prepId, share: parseAmount(amount)! };
}

async function getListed(pieceId: number) {
  return (await getPieces()).find((piece) => piece.id === pieceId);
}

async function getSavedCost(pieceId: number, prepId: number) {
  const use = await database.getFirstAsync<{ prep_cost_cents: number | null }>(
    'SELECT prep_cost_cents FROM prep_uses WHERE piece_id = ? AND prep_id = ?',
    pieceId,
    prepId,
  );
  return use?.prep_cost_cents;
}

// Beads counted 20 to a batch and saved as their template, made from the frit mix.
async function finishBeadsFromFrit(amount: string) {
  await finishPiece(beadsId, {
    ...finish,
    isTemplate: true,
    sizeAmount: 20,
    sizeUnit: 'beads',
    prepUses: [byEye(fritId, amount)],
  });
}

// The points are pulled from a whole $15 tube, made 8, and saved as their template. The frit mix
// is by eye, made from a whole $10 bag of frit.
beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
  tubeId = await addSupply({ name: '30 mm tube', costCents: 1500, caseCount: 1 });
  fritBagId = await addSupply({ name: 'Frit, blue', costCents: 1000, caseCount: 1 });
  await finishPiece(pointsId, {
    ...finish,
    isTemplate: true,
    sizeAmount: 8,
    sizeUnit: 'points',
    supplyUses: [{ supplyId: tubeId, share: whole }],
  });
  await finishPiece(fritId, { ...finish, supplyUses: [{ supplyId: fritBagId, share: whole }] });
});

describe('a cane made from points', () => {
  // Otherwise a cane made from points would cost nothing and carry only its own pulling time.
  it("costs 2 of 8 points of a $15 tube, $3.75, and carries the points' 10m", async () => {
    await finishPiece(caneId, { ...finish, prepUses: [points('2')] });

    expect(await getListed(caneId)).toMatchObject({
      cost_cents: 375,
      cost_estimated: false,
      prep_milliseconds: 10 * minute,
      no_cost: 0,
    });
    expect((await getPieceDetail(caneId))?.usedPrep).toEqual([
      expect.objectContaining({ piece_id: caneId, prep_id: pointsId, ...parseAmount('2', 8) }),
    ]);
  });

  // Otherwise a piece using the cane would leave out the points and the tube behind them.
  it("gives pieces their share of the cane's cost and time, points included, settled once all used", async () => {
    await finishPiece(caneId, { ...finish, prepUses: [points('2')] });
    await addPrepUse(vaseId, byEye(caneId, '25'));
    await addPrepUse(bowlId, byEye(caneId, '25'));

    expect(await getListed(vaseId)).toMatchObject({
      cost_cents: 94,
      cost_estimated: true,
      prep_milliseconds: 10 * minute,
      prep_estimated: true,
      no_cost: 0,
    });

    await setPrepUsedUp(caneId, true);

    expect(await getListed(vaseId)).toMatchObject({
      cost_cents: 188,
      cost_estimated: false,
      prep_milliseconds: 20 * minute,
      prep_estimated: false,
    });
  });

  // Otherwise prep recorded after the fact on Add Work or New prep would lose what it was made from.
  it('saves the prep it used on Add Work', async () => {
    const pastCaneId = await addPastWork({
      piece: {
        name: 'Red cane',
        category: 'prep',
        templateId: null,
        sizeAmount: null,
        sizeUnit: null,
      },
      startedAt: '2026-11-02T09:00:00.000Z',
      endedAt: '2026-11-02T09:30:00.000Z',
      photoFileName: null,
      finish: { notes: 'Red', lost: false, isTemplate: false },
      prepUses: [points('2')],
      supplyUses: [],
    });

    expect(await getListed(pastCaneId)).toMatchObject({ cost_cents: 375, cost_estimated: false });
  });

  // Otherwise a finish that failed partway would leave the cane finished, or with some of its prep.
  it('saves no prep uses when the finish is rejected', async () => {
    await expect(
      finishPiece(caneId, { ...finish, prepUses: [points('2'), byEye(vaseId, '25')] }),
    ).rejects.toThrow(addPrepError);

    expect(await getPieceDetail(caneId)).toMatchObject({
      piece: { finished_at: null },
      usedPrep: [],
    });
  });
});

describe('counted prep made from prep', () => {
  // Otherwise a bead's price would leave out the points it was made from.
  it('prices a part from the whole, prep included', async () => {
    await finishPiece(beadsId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 10,
      sizeUnit: 'beads',
      prepUses: [points('2')],
    });

    expect((await getAvailablePrep(vaseId)).find((prep) => prep.id === beadsId)).toMatchObject({
      cost_cents: 375,
      cost_estimated: false,
    });
    expect(await getPrepPrice(beadsId)).toMatchObject({
      cost_cents: 375,
      total_milliseconds: 30 * minute,
      estimated: false,
      supplies: [expect.objectContaining({ id: tubeId })],
    });
  });

  // Otherwise a new tube price would change what a piece made from the beads already cost.
  it("keeps a piece's saved cost after the tube's price changes", async () => {
    await finishPiece(beadsId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 10,
      sizeUnit: 'beads',
      prepUses: [points('2')],
    });
    await addPrepUse(vaseId, { prepId: beadsId, share: parseAmount('1', 10)! });

    await updateSupply(tubeId, { name: '30 mm tube', costCents: 3000, caseCount: 1 });

    expect(await getSavedCost(vaseId, beadsId)).toBe(375);
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 38, cost_estimated: false });
    expect((await getPrepPrice(beadsId)).cost_cents).toBe(750);
  });
});

describe("saving a counted use's cost", () => {
  // Otherwise a piece using beads finished before their supply was added would follow every
  // later price of that supply.
  it('saves it once a supply is added to the prep, and keeps it after a price change', async () => {
    await finishPiece(beadsId, { ...finish, isTemplate: true, sizeAmount: 10, sizeUnit: 'beads' });
    await addPrepUse(vaseId, { prepId: beadsId, share: parseAmount('1', 10)! });

    expect(await getSavedCost(vaseId, beadsId)).toBeNull();

    await addSupplyUse(beadsId, { supplyId: tubeId, share: whole });
    await updateSupply(tubeId, { name: '30 mm tube', costCents: 3000, caseCount: 1 });

    expect(await getSavedCost(vaseId, beadsId)).toBe(1500);
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 150, cost_estimated: false });
  });

  // Otherwise beads made from an open cane with no supply yet would save a cost leaving out the
  // frit added to the cane later, and the bead price would show its guessed time as exact.
  it('waits on an open by eye prep with no supply, so the supply added to it gets in', async () => {
    await finishPiece(caneId, finish);
    await finishPiece(beadsId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 10,
      sizeUnit: 'beads',
      prepUses: [byEye(caneId, '50')],
      supplyUses: [{ supplyId: tubeId, share: whole }],
    });
    await addPrepUse(vaseId, { prepId: beadsId, share: parseAmount('1', 10)! });

    expect(await getSavedCost(vaseId, beadsId)).toBeNull();
    expect(await getPrepPrice(beadsId)).toMatchObject({ cost_estimated: false, estimated: true });

    await addSupplyUse(caneId, { supplyId: fritBagId, share: whole });
    await setPrepUsedUp(caneId, true);

    expect(await getSavedCost(vaseId, beadsId)).toBe(2500);
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 250, cost_estimated: false });
  });
});

describe('a by eye prep behind other prep', () => {
  // Otherwise a cane made from a frit mix still being guessed at would read as final.
  it('makes a cane from it estimated, and actual once both are all used', async () => {
    await finishPiece(caneId, { ...finish, prepUses: [byEye(fritId, '50')] });
    await addPrepUse(vaseId, { prepId: caneId, share: whole });

    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 500, cost_estimated: true });

    await setPrepUsedUp(fritId, true);

    expect(await getListed(caneId)).toMatchObject({ cost_cents: 1000, cost_estimated: false });
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 1000, cost_estimated: false });
  });

  // Otherwise a piece would freeze the beads' guessed cost, or never keep the settled one.
  it("saves a counted use's cost only once the frit is all used, and takes it off when it opens again", async () => {
    await finishBeadsFromFrit('50');
    await addPrepUse(vaseId, { prepId: beadsId, share: parseAmount('2', 20)! });

    expect(await getSavedCost(vaseId, beadsId)).toBeNull();
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 50, cost_estimated: true });
    expect((await getAvailablePrep(bowlId)).find((prep) => prep.id === beadsId)).toMatchObject({
      cost_cents: 500,
      cost_estimated: true,
    });

    await setPrepUsedUp(fritId, true);

    expect(await getSavedCost(vaseId, beadsId)).toBe(1000);
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 100, cost_estimated: false });

    await updateSupply(fritBagId, { name: 'Frit, blue', costCents: 2000, caseCount: 1 });

    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 100 });

    await setPrepUsedUp(fritId, false);

    expect(await getSavedCost(vaseId, beadsId)).toBeNull();
    expect(await getListed(vaseId)).toMatchObject({ cost_cents: 100, cost_estimated: true });
  });

  // Otherwise Delete supply would leave out the prep made from prep that used it.
  it('counts prep made from it in Delete supply, stopping at a saved cost', async () => {
    await finishPiece(caneId, { ...finish, prepUses: [byEye(fritId, '50')] });
    await addPrepUse(vaseId, byEye(caneId, '25'));

    expect(await getSupply(fritBagId)).toMatchObject({ prep_count: 2, piece_count: 1 });

    await finishPiece(beadsId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 10,
      sizeUnit: 'beads',
      prepUses: [points('2')],
    });
    await addPrepUse(bowlId, { prepId: beadsId, share: parseAmount('1', 10)! });

    expect(await getSupply(tubeId)).toMatchObject({ prep_count: 2, piece_count: 0 });
  });
});

describe('loops', () => {
  // Otherwise a prep could use itself, and its cost would never finish adding up.
  it('refuses a prep using itself and leaves it out of its own Add prep', async () => {
    await finishPiece(caneId, finish);

    await expect(addPrepUse(caneId, byEye(caneId, '25'))).rejects.toThrow(loopError);
    expect((await getAvailablePrep(caneId)).map((prep) => prep.id)).not.toContain(caneId);
  });

  // Otherwise the points could be made from beads made from a cane made from the same points.
  it('refuses prep made from it two levels down, and leaves it out of Add prep', async () => {
    await finishPiece(caneId, { ...finish, prepUses: [points('2')] });
    await finishPiece(beadsId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 10,
      sizeUnit: 'beads',
      prepUses: [byEye(caneId, '50')],
    });

    await expect(
      addPrepUse(pointsId, { prepId: beadsId, share: parseAmount('1', 10)! }),
    ).rejects.toThrow(loopError);
    expect((await getAvailablePrep(pointsId)).map((prep) => prep.id)).toEqual([fritId]);
  });
});
