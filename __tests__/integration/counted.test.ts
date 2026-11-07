import { getDb } from '@/db/database';
import { addPastWork } from '@/db/queries/entryQueries';
import {
  finishPiece,
  getPieces,
  getTemplates,
  getUnfinishedPieces,
  setPieceTemplate,
  startFromTemplate,
  updatePiece,
} from '@/db/queries/pieceQueries';
import { addPrepUse, getAvailablePrep } from '@/db/queries/prepQueries';
import {
  addSupply,
  addSupplyUse,
  getAvailableSupplies,
  getSupply,
  setSupplyUsedUp,
  updateSupply,
} from '@/db/queries/supplyQueries';
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

const box = { name: 'Box of 32.7 × 4', costCents: 24000, sizeAmount: 16, sizeUnit: 'tubes' };

let boxId: number;

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

// The points are pulled from one tube of the box, made 8, and saved at Done as the template
// every later batch of points is divided from.
beforeEach(async () => {
  const database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
  boxId = await addSupply(box);
  await finishPiece(pointsId, {
    ...finish,
    isTemplate: true,
    sizeAmount: 8,
    sizeUnit: 'points',
    supplyUses: [{ supplyId: boxId, share: parseAmount('1', 16)! }],
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
  // Otherwise a tube from a box would carry the whole box's price, or a guess at it.
  it('gives a tube from a $240 box of 16 a cost of $15.00, not estimated', async () => {
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

  // Otherwise a new box price would rewrite what last month's pieces cost.
  it("keeps a counted use's cost when the price changes, while the template's follows it", async () => {
    await finishWith(pendantId, [points('1/3')]);

    await updateSupply(boxId, { ...box, costCents: 32000 });
    await finishWith(bubblerId, [points('1/3')]);

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 63 });
    expect(await getListed(pointsId)).toMatchObject({ cost_cents: 2000 });
    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 83 });
  });

  // Otherwise a piece made only from exact parts would read as a guess.
  it('is not estimated for a piece using only counted prep and supplies', async () => {
    const bailsId = await addSupply({
      name: 'Bails',
      costCents: 3000,
      sizeAmount: 10,
      sizeUnit: 'bails',
    });
    await finishPiece(pendantId, {
      ...finish,
      prepUses: [points('1/3')],
      supplyUses: [{ supplyId: bailsId, share: parseAmount('1', 10)! }],
    });

    expect(await getListed(pendantId)).toMatchObject({
      cost_cents: 63 + 300,
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

describe('counted supplies', () => {
  // Otherwise a box of bails would close after ten were entered and refuse the next piece.
  it('never closes, past one use of all of it and past its count', async () => {
    const bailsId = await addSupply({
      name: 'Bails',
      costCents: 3000,
      sizeAmount: 10,
      sizeUnit: 'bails',
    });

    await addSupplyUse(pendantId, { supplyId: bailsId, share: parseAmount('10', 10)! });
    await addSupplyUse(bubblerId, { supplyId: bailsId, share: parseAmount('12', 10)! });

    expect(await getSupply(bailsId)).toMatchObject({ used_up: 0 });
    expect((await getAvailableSupplies(caneId)).map((supply) => supply.id)).toContain(bailsId);
    expect(await getListed(bubblerId)).toMatchObject({ cost_cents: 3600 });
  });

  // Otherwise a box of 20 typed as 16 would keep pricing each tube at a sixteenth of the box.
  it('keeps each use at the tubes it used when the count is corrected', async () => {
    await updateSupply(boxId, { ...box, sizeAmount: 20 });

    expect(await getSupply(boxId)).toMatchObject({ size_amount: 20 });
    expect(await getListed(pointsId)).toMatchObject({ cost_cents: 1200 });
  });

  // Otherwise a used box's shares would turn into by eye guesses and start closing it.
  it('refuses turning a used counted supply by eye, and saves nothing', async () => {
    await expect(
      updateSupply(boxId, { ...box, name: 'Renamed', sizeAmount: null, sizeUnit: null }),
    ).rejects.toThrow("Holds can't be added or cleared once something has used the supply.");

    expect(await getSupply(boxId)).toMatchObject({ name: box.name, size_amount: 16 });
  });

  // Otherwise a by eye rod's guesses would snap to a count with a price nothing saved.
  it('refuses a count on a used by eye supply', async () => {
    const rodId = await addSupply({ ...box, name: 'Rod', sizeAmount: null, sizeUnit: null });
    await addSupplyUse(pendantId, { supplyId: rodId, share: parseAmount('50')! });

    await expect(updateSupply(rodId, { ...box, name: 'Rod' })).rejects.toThrow(
      "Holds can't be added or cleared once something has used the supply.",
    );
  });

  // Otherwise fixing a used box's price or a typo in its unit would be refused too.
  it('still changes a used supply with the same count', async () => {
    await updateSupply(boxId, { ...box, costCents: 32000, sizeUnit: 'rods' });

    expect(await getSupply(boxId)).toMatchObject({ cost_cents: 32000, size_unit: 'rods' });
  });
});

describe('counted prep made with a by eye supply', () => {
  const rod = { name: 'Rod', costCents: 4000, sizeAmount: null, sizeUnit: null };
  const cutId = 5;
  let rodId: number;

  // Cut pieces, counted, made with half a by eye rod.
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

  // Otherwise a guess at the rod's share would be shown as an exact cost.
  it('marks the piece estimated', async () => {
    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 500, cost_estimated: true });
  });

  // Otherwise the piece would stay at the guess after the rod closes and the real cost is known.
  it('takes the actual cost when the supply closes', async () => {
    await setSupplyUsedUp(rodId, true);

    expect(await getListed(pendantId)).toMatchObject({ cost_cents: 1000, cost_estimated: false });
  });

  // Otherwise the picker would show a part's price as exact while it holds a guess.
  it('marks its price in Add prep estimated', async () => {
    const available = await getAvailablePrep(bubblerId);

    expect(available.find((prep) => prep.id === cutId)).toMatchObject({
      cost_cents: 2000,
      cost_estimated: true,
    });
  });
});

describe('a counted use with an exact cost', () => {
  // Otherwise the picker would mark every counted part's price as a guess.
  it('leaves its price in Add prep unmarked', async () => {
    const [template] = await getAvailablePrep(pendantId);

    expect(template).toMatchObject({ id: pointsId, cost_estimated: false });
  });
});

describe('Delete supply counts', () => {
  // Otherwise the confirmation would promise the cost comes off pieces that keep it.
  it('leaves out pieces with the cost saved on their use of its prep', async () => {
    await finishWith(pendantId, [points('1')]);

    expect(await getSupply(boxId)).toMatchObject({ prep_count: 1, piece_count: 0 });
  });

  // Otherwise the confirmation would leave out a template piece, whose cost follows the supply.
  it('counts a template piece using its prep, since it ignores the saved cost', async () => {
    await finishPiece(pendantId, { ...finish, isTemplate: true, prepUses: [points('1')] });

    expect(await getSupply(boxId)).toMatchObject({ prep_count: 1, piece_count: 1 });
  });

  // Otherwise the confirmation would leave out a piece that used the box directly.
  it('counts a piece using the supply directly', async () => {
    await addSupplyUse(pendantId, { supplyId: boxId, share: parseAmount('1', 16)! });

    expect(await getSupply(boxId)).toMatchObject({ prep_count: 1, piece_count: 1 });
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
