import { getDb } from '@/db/database';
import { deletePiece, finishPiece, getPieces } from '@/db/queries/pieceQueries';
import {
  getAvailablePrep,
  getPrepPrice,
  getTemplateUses,
  setPrepUsedUp,
} from '@/db/queries/prepQueries';
import {
  addSupply,
  addSupplyUse,
  deleteSupply,
  getAvailableSupplies,
  getSupply,
  getSupplyKinds,
  updateSupply,
} from '@/db/queries/supplyQueries';
import { parseAmount } from '@/utils/prepTime';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const minute = 60 * 1000;
const oldPrice = '2026-11-01T00:00:00.000Z';

// Points pulled from a tube in 40 minutes, an open dichroic cane, a pendant that's the template,
// and a bowl to finish with points.
const pointsId = 1;
const caneId = 2;
const pendantId = 3;
const bowlId = 4;

const fixturesSql = `
  INSERT INTO pieces (id, name, category) VALUES
    (${pointsId}, 'Points, 32.7 × 4', 'prep'),
    (${pendantId}, 'Pendant', 'piece'),
    (${bowlId}, 'Bowl', 'piece');
  INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
    (${caneId}, 'Dichroic cane', 'prep', 'Blue', '2026-11-01T08:00:00.000Z');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${caneId}, '2026-11-01T07:00:00.000Z', '2026-11-01T08:00:00.000Z'),
    (${pointsId}, '2026-11-01T09:00:00.000Z', '2026-11-01T09:40:00.000Z'),
    (${pendantId}, '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z'),
    (${bowlId}, '2026-11-01T11:00:00.000Z', '2026-11-01T12:00:00.000Z');
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

const tube = { name: '32.7 × 4 tube', costCents: 1500 };
const rod = { name: 'Cobalt rod', costCents: 1200 };

let database: ReturnType<typeof createTestDb>;
let tubeId: number;
let rodId: number;

// A by eye cane made from the given one, so of its kind, and finished on the given day of November.
async function addCane(id: number, templateId: number | null, finishedDay: number) {
  await database.execAsync(`
    INSERT INTO pieces (id, name, category, notes, finished_at, template_id, kind_id) VALUES
      (${id}, 'Dichroic cane', 'prep', 'Blue', '2026-11-0${finishedDay}T08:00:00.000Z',
       ${templateId}, (SELECT coalesce(kind_id, id) FROM pieces WHERE id = ${templateId}));
  `);
}

// A template's lines as the form for the given piece, or a new one, fills them.
async function getLines(templateId: number, pieceId: number | null = null) {
  return getTemplateUses(templateId, pieceId, {
    prep: await getAvailablePrep(pieceId),
    supplies: await getAvailableSupplies(pieceId),
  });
}

// The points take a whole tube and are saved as a template that made 8. The pendant is a
// template made from 1/3 point, 25% of the cane, and half the rod.
beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
  tubeId = await addSupply(tube);
  rodId = await addSupply(rod);
  await finishPiece(pointsId, {
    ...finish,
    isTemplate: true,
    sizeAmount: 8,
    sizeUnit: 'points',
    supplyUses: [{ supplyId: tubeId, share: { share_numerator: 1, share_denominator: 1 } }],
  });
  await finishPiece(pendantId, {
    ...finish,
    isTemplate: true,
    prepUses: [
      { prepId: pointsId, share: parseAmount('1/3', 8)! },
      { prepId: caneId, share: parseAmount('25')! },
    ],
    supplyUses: [{ supplyId: rodId, share: parseAmount('50')! }],
  });
});

describe('Update price', () => {
  // Otherwise a new tube price would leave every point priced from the old one, or rewrite pieces already made.
  it("changes a counted part's cost and priced_at, and leaves pieces already saved alone", async () => {
    await finishPiece(bowlId, {
      ...finish,
      prepUses: [{ prepId: pointsId, share: parseAmount('1', 8)! }],
    });
    await database.runAsync('UPDATE supplies SET priced_at = ?', oldPrice);

    await updateSupply(tubeId, { ...tube, costCents: 2000 });

    expect((await getSupply(tubeId))?.priced_at).not.toBe(oldPrice);
    expect(await getPrepPrice(pointsId)).toEqual(
      expect.objectContaining({ cost_cents: 2000, worked_milliseconds: 40 * minute }),
    );
    expect((await getPieces()).find((piece) => piece.id === bowlId)?.cost_cents).toBe(188);
  });

  // Otherwise renaming a supply would say it was priced today when its price is weeks old.
  it('keeps priced_at when the cost is the same', async () => {
    await database.runAsync('UPDATE supplies SET priced_at = ?', oldPrice);

    await updateSupply(tubeId, { ...tube, name: 'Clear tube' });

    expect((await getSupply(tubeId))?.priced_at).toBe(oldPrice);
  });

  // Otherwise the price shown where a point is picked couldn't say which supply to update.
  it('lists the supplies a counted prep is priced from', async () => {
    expect((await getPrepPrice(pointsId)).supplies.map((supply) => supply.id)).toEqual([tubeId]);
  });
});

describe("a template's lines", () => {
  // Otherwise a pendant made from points would need its 1/3 point entered again every time.
  it('fills a counted line in at the template amount', async () => {
    const { prep } = await getLines(pendantId);

    expect(prep[0]).toMatchObject({
      batch_id: pointsId,
      ...parseAmount('1/3', 8),
      replacement: expect.objectContaining({ id: pointsId }),
    });
  });

  // Otherwise a template whose cane is all used couldn't be made again without hunting for the next one.
  it('fills a closed by eye prep line in with the newest open prep of its kind', async () => {
    await setPrepUsedUp(caneId, true);
    await addCane(5, caneId, 2);
    await addCane(6, caneId, 3);

    const { prep } = await getLines(pendantId);

    expect(prep[1].replacement?.id).toBe(6);
  });

  // Otherwise a different cane that happens to share the name would carry this one's cost.
  it('leaves out an open prep with the same name and a different kind, and fills nothing in', async () => {
    await setPrepUsedUp(caneId, true);
    await addCane(5, null, 2);

    const { prep } = await getLines(pendantId);

    expect(prep[1]).toMatchObject({
      batch_id: caneId,
      batch_name: 'Dichroic cane',
      batch_lost: 0,
      counted: 0,
      replacement: null,
    });
  });

  // Otherwise a template copied from a copy would lose track of the cane it started from.
  it('keeps the first prep kind through a copy of a copy', async () => {
    await setPrepUsedUp(caneId, true);
    await addCane(5, caneId, 2);
    await setPrepUsedUp(5, true);
    await addCane(6, 5, 3);

    const { prep } = await getLines(pendantId);

    expect(prep[1].replacement?.id).toBe(6);
  });

  // Otherwise starting from a template would fill in its prep and leave its supplies to be found again.
  it('fills supply lines in at the template amount', async () => {
    const { supplies } = await getLines(pendantId);

    expect(supplies).toEqual([
      expect.objectContaining({
        batch_id: rodId,
        ...parseAmount('50'),
        replacement: expect.objectContaining({ id: rodId }),
      }),
    ]);
  });

  // Otherwise a copy with a rod already saved on it would get a second rod at Done, and pay for both.
  it('leaves out a line of a kind the piece already uses', async () => {
    const savedRodId = await addSupply(rod, rodId);
    await addSupply(rod, rodId);
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, template_id) VALUES (7, 'Pendant', 'piece', ${pendantId});
    `);
    await addSupplyUse(7, { supplyId: savedRodId, share: parseAmount('50')! });

    expect((await getLines(pendantId, 7)).supplies).toEqual([]);
  });
});

describe('Same as', () => {
  // Otherwise Same as would list every rod ever bought, or fill in an old price.
  it('offers the newest supply of each kind with its name and cost', async () => {
    const newerRodId = await addSupply({ ...rod, costCents: 1400 }, rodId);

    expect(await getSupplyKinds()).toEqual([
      { id: newerRodId, name: 'Cobalt rod', cost_cents: 1400 },
      { id: tubeId, name: tube.name, cost_cents: 1500 },
    ]);
  });

  // Otherwise a rod added as the same as the last one would start a kind of its own.
  it('records the first one of the kind, through a copy of a copy', async () => {
    const secondId = await addSupply(rod, rodId);
    const thirdId = await addSupply(rod, secondId);

    expect(
      await database.getAllAsync(
        'SELECT id, kind_id FROM supplies WHERE id IN (?, ?) ORDER BY id',
        secondId,
        thirdId,
      ),
    ).toEqual([
      { id: secondId, kind_id: rodId },
      { id: thirdId, kind_id: rodId },
    ]);
  });
});

describe('deleting one of a kind', () => {
  // Otherwise deleting the first rod would leave the rest as kinds of their own in Same as.
  it('keeps the rest of a supply kind together', async () => {
    await addSupply(rod, rodId);
    const newestId = await addSupply(rod, rodId);

    await deleteSupply(rodId);

    expect((await getSupplyKinds()).map((kind) => kind.id)).toEqual([newestId, tubeId]);
  });

  // Otherwise deleting the first cane would split the canes made from it into separate kinds.
  it('keeps the rest of a prep kind together', async () => {
    await addCane(5, caneId, 2);
    await addCane(6, 5, 3);

    await deletePiece(caneId);

    const prepKinds = (await getAvailablePrep(null))
      .filter((prep) => prep.id === 5 || prep.id === 6)
      .map((prep) => prep.kind_id);
    expect(prepKinds).toEqual([caneId, caneId]);
  });

  // Otherwise every copy of a deleted template would fill its lines from one of the other copies.
  it('leaves every piece made from a deleted template with no template', async () => {
    await addCane(5, caneId, 2);
    await addCane(6, caneId, 3);

    await deletePiece(caneId);

    expect(
      await database.getAllAsync(
        'SELECT id, template_id FROM pieces WHERE id IN (5, 6) ORDER BY id',
      ),
    ).toEqual([
      { id: 5, template_id: null },
      { id: 6, template_id: null },
    ]);
  });
});
