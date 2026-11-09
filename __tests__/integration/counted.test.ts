import { getDb } from '@/db/database';
import { addPastWork, addPieceTime } from '@/db/queries/entryQueries';
import {
  finishPiece,
  getPieceDetail,
  getPieces,
  getTemplates,
  getUnfinishedPieces,
  setPieceTemplate,
  startFromTemplate,
  updatePiece,
} from '@/db/queries/pieceQueries';
import { addPrepUse, addSupplyUse, getAvailablePrep } from '@/db/queries/prepQueries';
import { addSupply, getSupply, updateSupply } from '@/db/queries/supplyQueries';
import { parseAmount } from '@/utils/prepTime';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const minute = 60 * 1000;

const addPrepError =
  "Only finished prep that isn't all used or lost can be added, and counted prep only by its template.";

// Points pulled from a tube in 40 minutes, two pieces to make from them, and an open dichroic
// cane, which is by eye.
const pointsId = 1;
const pendantId = 2;
const bubblerId = 3;
const caneId = 4;

const fixturesSql = `
  INSERT INTO pieces (id, name, category) VALUES
    (${pointsId}, 'Points, 32.7 × 4', 'prep'),
    (${pendantId}, 'Pendant', 'piece'),
    (${bubblerId}, 'Bubbler', 'piece');
  INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
    (${caneId}, 'Dichroic cane', 'prep', 'Blue', '2026-11-01T08:00:00.000Z');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${caneId}, '2026-11-01T07:00:00.000Z', '2026-11-01T08:00:00.000Z'),
    (${pointsId}, '2026-11-01T09:00:00.000Z', '2026-11-01T09:40:00.000Z'),
    (${pendantId}, '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z'),
    (${bubblerId}, '2026-11-01T11:00:00.000Z', '2026-11-01T12:00:00.000Z');
`;

const finish = {
  endedAt: '2026-11-01T12:00:00.000Z',
  notes: 'Clear',
  photoFileName: null,
  lost: false,
  isTemplate: false,
  sizeAmount: null,
  sizeUnit: null,
  prepUses: [],
  supplyUses: [],
};

const tube = { name: '32.7 × 4 tube', costCents: 1500, caseCount: 1 };

let tubeId: number;

// A use of the points, typed the way a piece enters it: "1/3", "1 1/2".
function points(amount: string) {
  return { prepId: pointsId, share: parseAmount(amount, 8)! };
}

async function getListed(pieceId: number) {
  return (await getPieces()).find((piece) => piece.id === pieceId);
}

async function finishWith(pieceId: number, prepUses: ReturnType<typeof points>[]) {
  await finishPiece(pieceId, { ...finish, prepUses });
}

// The points are pulled from a whole $15 tube, made 8, and saved at Done as the template every
// later batch of points is divided from.
beforeEach(async () => {
  const database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
  tubeId = await addSupply(tube);
  await finishPiece(pointsId, {
    ...finish,
    isTemplate: true,
    sizeAmount: 8,
    sizeUnit: 'points',
    supplyUses: [{ supplyId: tubeId, share: { share_numerator: 1, share_denominator: 1 } }],
  });
});

describe('Save as template at Done', () => {
  // Otherwise the points would need a trip to their page before any piece could use them.
  it('saves the finished prep as a template', async () => {
    expect((await getTemplates()).map((template) => template.id)).toEqual([pointsId]);
  });

  // Otherwise a Done that failed would still leave a template behind for a piece never finished.
  it('saves no template when the finish is rejected', async () => {
    await expect(
      finishPiece(pendantId, {
        ...finish,
        isTemplate: true,
        prepUses: [{ prepId: bubblerId, share: parseAmount('1/2')! }],
      }),
    ).rejects.toThrow(addPrepError);

    expect((await getTemplates()).map((template) => template.id)).toEqual([pointsId]);
  });
});

describe('counted cost', () => {
  // Otherwise the points wouldn't carry the tube they were pulled from, or would carry a guess at it.
  it('gives the points the whole $15.00 tube, not estimated', async () => {
    expect(await getListed(pointsId)).toMatchObject({ cost_cents: 1500, cost_estimated: false });
  });

  // Otherwise a production piece wouldn't carry its point, or would carry the whole tube.
  it('gives a point from a $15 tube pulled into 8 $1.88, and 1/3 point 63¢', async () => {
    await finishWith(pendantId, [points('1')]);
    await finishWith(bubblerId, [points('1/3')]);

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 188, cost_estimated: false });
    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 63, cost_estimated: false });
  });

  // Otherwise a bubbler on 1 1/2 points would carry one point, or a rounded price times 1.5.
  it('gives 1 1/2 points 1 1/2 times the exact price of a point', async () => {
    await finishWith(bubblerId, [points('1 1/2')]);

    // $15 over 8 is $1.875 a point, and 1 1/2 of it is $2.8125.
    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 281 });
  });

  // Otherwise a big piece that used more points than one tube made would be refused.
  it('takes more parts than the template made, at the same price each', async () => {
    await finishWith(bubblerId, [points('12')]);

    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 2250 });
  });

  // Otherwise a tube pulled into 10 points but typed as 8 would keep pricing each point at an eighth.
  it('keeps each piece at the points it used when the count is corrected', async () => {
    await finishWith(pendantId, [points('1')]);

    await updatePiece(pointsId, {
      name: 'Points, 32.7 × 4',
      category: 'prep',
      notes: finish.notes,
      photoFileName: null,
      sizeAmount: 10,
      sizeUnit: 'points',
    });

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 150 });
  });

  // Otherwise a piece made from points would carry none of the 40 minutes it took to pull them.
  it("gives a part the template's worked time over its count", async () => {
    await finishWith(pendantId, [points('1')]);

    expect(await getListed(pendantId)).toMatchObject({
      prep_milliseconds: 5 * minute,
      prep_estimated: false,
    });
  });

  // Otherwise time added to the points after a piece used them would never reach that piece.
  it('gives a piece already made the time added to its prep afterward', async () => {
    await finishWith(pendantId, [points('1')]);

    await addPieceTime(pointsId, '2026-11-01T08:10:00.000Z', '2026-11-01T08:50:00.000Z');

    expect(await getListed(pendantId)).toMatchObject({ prep_milliseconds: 10 * minute });
  });

  // Otherwise a new tube price would rewrite what last month's pieces cost.
  it("keeps a counted use's cost when the price changes, while the template's follows it", async () => {
    await finishWith(pendantId, [points('1/3')]);

    await updateSupply(tubeId, { ...tube, costCents: 2000 });
    await finishWith(bubblerId, [points('1/3')]);

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 63 });
    expect(await getListed(pointsId)).toMatchObject({ cost_cents: 2000 });
    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 83 });
  });

  // Otherwise a piece made only from exact parts would read as a guess.
  it('is not estimated for a piece using only counted prep', async () => {
    await finishWith(pendantId, [points('1/3')]);

    expect(await getListed(pendantId)).toMatchObject({
      cost_cents: 63,
      cost_estimated: false,
      prep_estimated: false,
    });
  });
});

describe('counted prep in Add prep', () => {
  // Otherwise every batch of points would be listed, and a piece would have to pick which pile.
  it('lists a counted template once, beside open by eye prep, and none of its later batches', async () => {
    const laterBatchId = await startFromTemplate(pointsId);
    await finishPiece(laterBatchId, {
      ...finish,
      endedAt: new Date().toISOString(),
      sizeAmount: 8,
      sizeUnit: 'points',
    });

    const available = await getAvailablePrep(pendantId);

    expect(available.map((prep) => prep.id)).toEqual([pointsId, caneId]);
    expect(available[0]).toMatchObject({ size_amount: 8, size_unit: 'points', cost_cents: 1500 });
  });

  // Otherwise a piece could take its cost from a later batch, which holds no supplies or count.
  it("rejects a counted batch that isn't its template", async () => {
    const laterBatchId = await startFromTemplate(pointsId);
    await finishPiece(laterBatchId, {
      ...finish,
      endedAt: new Date().toISOString(),
      sizeAmount: 8,
      sizeUnit: 'points',
    });

    await expect(
      addPrepUse(pendantId, { prepId: laterBatchId, share: parseAmount('1', 8)! }),
    ).rejects.toThrow(addPrepError);
  });
});

describe('counted prep made with part of a supply', () => {
  const rod = { name: 'Rod', costCents: 4000, caseCount: 1 };
  const cutId = 5;
  let rodId: number;

  // Cut pieces, counted, made with half a rod.
  beforeEach(async () => {
    const database = await getDb();
    await database.execAsync(`
      INSERT INTO pieces (id, name, category) VALUES (${cutId}, 'Cut pieces', 'prep');
      INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
        (${cutId}, '2026-11-01T06:00:00.000Z', '2026-11-01T07:00:00.000Z');
    `);
    rodId = await addSupply(rod);
    await finishPiece(cutId, {
      ...finish,
      isTemplate: true,
      sizeAmount: 4,
      sizeUnit: 'cuts',
      supplyUses: [{ supplyId: rodId, share: parseAmount('50')! }],
    });
    await addPrepUse(pendantId, { prepId: cutId, share: parseAmount('1', 4)! });
  });

  // Otherwise a part's cost would carry the whole rod, or be marked a guess.
  it("gives a part a quarter of half the rod's cost, exact", async () => {
    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 500, cost_estimated: false });
  });

  // Otherwise a later price for the rod would change what the pendant cost.
  it('saves the cost on the use, so a new rod price leaves the piece alone', async () => {
    await updateSupply(rodId, { ...rod, costCents: 8000 });

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 500 });
  });

  // Otherwise the picker would show the cut pieces with no price, or the rod's whole cost.
  it('prices it in Add prep from its share of the rod', async () => {
    const available = await getAvailablePrep(bubblerId);

    expect(available.find((prep) => prep.id === cutId)).toMatchObject({ cost_cents: 2000 });
  });
});

describe('Delete supply counts', () => {
  // Otherwise the confirmation would promise the cost comes off pieces that keep it.
  it('leaves out pieces with the cost saved on their use of its prep', async () => {
    await finishWith(pendantId, [points('1')]);

    expect(await getSupply(tubeId)).toMatchObject({ prep_count: 1, piece_count: 0 });
  });

  // Otherwise the confirmation would leave out a template piece, whose cost follows the supply.
  it('counts a template piece using its prep, since it ignores the saved cost', async () => {
    await finishPiece(pendantId, { ...finish, isTemplate: true, prepUses: [points('1')] });

    expect(await getSupply(tubeId)).toMatchObject({ prep_count: 1, piece_count: 1 });
  });

  // Otherwise the confirmation would leave out a piece that used a supply directly.
  it('counts a piece using the supply directly', async () => {
    const bailId = await addSupply({ name: 'Silver bail', costCents: 300, caseCount: 1 });
    await addSupplyUse(pendantId, { supplyId: bailId, share: parseAmount('100')! });

    expect(await getSupply(bailId)).toMatchObject({ prep_count: 0, piece_count: 1 });
  });
});

describe('Save as template on Add Work', () => {
  const pastPrep = {
    piece: {
      name: 'Old points',
      category: 'prep' as const,
      templateId: null,
      sizeAmount: 8,
      sizeUnit: 'points',
    },
    startedAt: '2026-10-01T09:00:00.000Z',
    endedAt: '2026-10-01T10:00:00.000Z',
    photoFileName: null,
    prepUses: [],
    supplyUses: [],
  };

  // Otherwise points caught up on through Add Work could never be picked by a piece.
  it('makes counted prep made earlier pickable', async () => {
    await addPastWork({ ...pastPrep, finish: { notes: 'Clear', lost: false, isTemplate: true } });

    expect((await getAvailablePrep(pendantId)).map((prep) => prep.name)).toContain('Old points');
  });

  // Otherwise turning the switch off would still offer the prep on the Work screen.
  it('saves no template with the switch off', async () => {
    await addPastWork({ ...pastPrep, finish: { notes: 'Clear', lost: false, isTemplate: false } });

    expect((await getTemplates()).map((template) => template.name)).not.toContain('Old points');
  });
});

describe('a later batch on its page', () => {
  // Otherwise its page would offer Add prep and Add supply, whose cost no piece would ever carry.
  it('is marked as a batch of its counted template, and stops being one with the template', async () => {
    const batchId = await startFromTemplate(pointsId);

    expect((await getPieceDetail(batchId))?.piece.template_counted).toBe(1);

    await setPieceTemplate(pointsId, false);

    expect((await getPieceDetail(batchId))?.piece.template_counted).toBe(0);
  });
});

describe('a batch after its source stops being a template', () => {
  // Otherwise Done would hide the supplies and count, though no template knows them any more.
  it('asks for the full Done', async () => {
    const batchId = await startFromTemplate(pointsId);
    const isCounted = async () =>
      (await getUnfinishedPieces()).find((piece) => piece.id === batchId)?.template_counted;

    expect(await isCounted()).toBe(1);

    await setPieceTemplate(pointsId, false);

    expect(await isCounted()).toBe(0);
  });
});

describe('usable in the Prep list', () => {
  // Otherwise the Prep list would sort batches Add prep refuses among the prep it can pick.
  it('matches what Add prep can pick', async () => {
    const laterBatchId = await startFromTemplate(pointsId);
    await finishPiece(laterBatchId, {
      ...finish,
      endedAt: new Date().toISOString(),
      sizeAmount: 8,
      sizeUnit: 'points',
    });

    expect(await getListed(pointsId)).toMatchObject({ usable: 1 });
    expect(await getListed(caneId)).toMatchObject({ usable: 1 });
    expect(await getListed(laterBatchId)).toMatchObject({ usable: 0 });
    expect(await getListed(pendantId)).toMatchObject({ usable: 0 });
  });
});
