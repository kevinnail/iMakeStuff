import { getDb } from '@/db/database';
import {
  deletePiece,
  finishPiece,
  getPieceDetail,
  getPieces,
  setPieceLost,
  startFromTemplate,
} from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  getTemplateUses,
  removePrepUse,
  setPrepUsedUp,
} from '@/db/queries/prepQueries';
import { getActualShare } from '@/utils/prepTime';
import { createTestDb } from '../setup';

jest.mock('@/db/database', () => ({
  getDb: jest.fn(),
}));

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

const addPrepError =
  "Only finished prep that isn't all used or lost can be added, and counted prep only by its template.";

// Two finished preps (4h 40m and 2h worked), an unfinished prep, and two pieces.
const caneId = 1;
const fritId = 2;
const unfinishedPrepId = 3;
const vaseId = 4;
const bowlId = 5;

const fixturesSql = `
  INSERT INTO pieces (id, name, category, notes, finished_at) VALUES
    (${caneId}, 'Dichroic cane', 'prep', 'Blue', '2026-10-28T17:00:00.000Z'),
    (${fritId}, 'Frit mix', 'prep', 'Green', '2026-10-29T17:00:00.000Z'),
    (${unfinishedPrepId}, 'Red cane', 'prep', NULL, NULL),
    (${vaseId}, 'Blue vase', 'piece', NULL, NULL),
    (${bowlId}, 'Green bowl', 'piece', 'Lime', '2026-10-30T17:00:00.000Z');
  INSERT INTO work_segments (piece_id, started_at, ended_at) VALUES
    (${caneId}, '2026-10-28T09:00:00.000Z', '2026-10-28T13:00:00.000Z'),
    (${caneId}, '2026-10-28T14:00:00.000Z', '2026-10-28T14:40:00.000Z'),
    (${fritId}, '2026-10-29T09:00:00.000Z', '2026-10-29T11:00:00.000Z'),
    (${unfinishedPrepId}, '2026-10-29T12:00:00.000Z', '2026-10-29T13:00:00.000Z'),
    (${vaseId}, '2026-10-30T09:00:00.000Z', '2026-10-30T12:00:00.000Z'),
    (${bowlId}, '2026-10-30T13:00:00.000Z', '2026-10-30T16:00:00.000Z');
`;

const finish = {
  endedAt: '2026-10-30T12:00:00.000Z',
  notes: 'Cobalt glaze',
  photoFileName: null,
  lost: false,
  isTemplate: false,
  sizeAmount: null,
  sizeUnit: null,
  supplyUses: [],
};

let database: ReturnType<typeof createTestDb>;

// A share as saved: use(caneId, 25) is 25%, use(caneId, 1, 8) is 1/8.
function share(numerator: number, denominator = 100) {
  return { share_numerator: numerator, share_denominator: denominator };
}

function use(prepId: number, numerator: number, denominator = 100) {
  return { prepId, share: share(numerator, denominator) };
}

async function getUsedUpAt(prepId: number) {
  const prep = await database.getFirstAsync<{ used_up_at: string | null }>(
    'SELECT used_up_at FROM pieces WHERE id = ?',
    prepId,
  );
  return prep?.used_up_at;
}

async function getUseId(pieceId: number, prepId: number) {
  const row = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM prep_uses WHERE piece_id = ? AND prep_id = ?',
    pieceId,
    prepId,
  );
  return row?.id ?? 0;
}

async function getActualPercents(prepId: number) {
  const usedBy = (await getPieceDetail(prepId))?.usedBy ?? [];
  return usedBy.map((row) => getActualShare(row) * 100);
}

// All used as every screen sees it: the switch, or uses that close it.
async function isUsedUp(prepId: number) {
  const usedBy = (await getPieceDetail(prepId))?.usedBy ?? [];
  return usedBy.some((row) => row.used_up === 1);
}

beforeEach(async () => {
  database = createTestDb();
  (getDb as jest.Mock).mockResolvedValue(database);
  await database.execAsync(fixturesSql);
});

describe('finishPiece with prep', () => {
  // Otherwise the points counted at Done would be lost, and pieces couldn't enter theirs in points.
  it('saves the size given when prep is finished', async () => {
    await finishPiece(unfinishedPrepId, {
      ...finish,
      prepUses: [],
      sizeAmount: 8,
      sizeUnit: 'points',
    });

    expect(
      await database.getFirstAsync(
        'SELECT size_amount, size_unit FROM pieces WHERE id = ?',
        unfinishedPrepId,
      ),
    ).toEqual({ size_amount: 8, size_unit: 'points' });
  });

  // Otherwise the prep picked in the panel after Done would be lost when the piece is saved.
  it('saves each prep used with its share and the prep worked time', async () => {
    await finishPiece(vaseId, { ...finish, prepUses: [use(caneId, 25), use(fritId, 10)] });

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBe(finish.endedAt);
    expect(detail?.usedPrep).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: caneId,
        prep_name: 'Dichroic cane',
        size_amount: null,
        size_unit: null,
        ...share(25),
        used_up: 0,
        measured: 0,
        shares_total: 0.25,
        prep_worked_milliseconds: 4 * hour + 40 * minute,
        prep_cost_cents: null,
      },
      {
        id: expect.any(Number),
        piece_id: vaseId,
        prep_id: fritId,
        prep_name: 'Frit mix',
        size_amount: null,
        size_unit: null,
        ...share(10),
        used_up: 0,
        measured: 0,
        shares_total: 0.1,
        prep_worked_milliseconds: 2 * hour,
        prep_cost_cents: null,
      },
    ]);
  });

  // Otherwise a rejected prep would still leave the piece finished without the prep it used.
  it('leaves the piece unfinished when a prep use is rejected', async () => {
    await expect(
      finishPiece(vaseId, { ...finish, prepUses: [use(caneId, 25), use(unfinishedPrepId, 10)] }),
    ).rejects.toThrow(addPrepError);

    const detail = await getPieceDetail(vaseId);
    expect(detail?.piece.finished_at).toBeNull();
    expect(detail?.usedPrep).toEqual([]);
  });
});

describe('addPrepUse', () => {
  // Otherwise a share of nothing, or one divided by 0, would be saved on a piece.
  it.each([
    [0, 100],
    [1, 0],
  ])('rejects a share of %i/%i', async (numerator, denominator) => {
    await expect(addPrepUse(vaseId, use(caneId, numerator, denominator))).rejects.toThrow(
      /CHECK constraint/,
    );
  });

  // Otherwise a cane cut in eighths would be saved rounded and show a percent nobody typed.
  it('saves a fraction as it was entered', async () => {
    await addPrepUse(vaseId, use(caneId, 1, 8));

    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([
      expect.objectContaining({ prep_id: caneId, ...share(1, 8), shares_total: 0.125 }),
    ]);
  });

  // Otherwise one piece could carry the same prep twice and count its share twice.
  it('rejects the same prep twice on one piece', async () => {
    await addPrepUse(vaseId, use(caneId, 25));

    await expect(addPrepUse(vaseId, use(caneId, 10))).rejects.toThrow(/UNIQUE constraint/);
  });

  // Otherwise a piece's time, or prep still being made, could be counted as prep on another piece.
  it.each([
    ['a piece', bowlId],
    ['unfinished prep', unfinishedPrepId],
  ])('rejects using %s as prep', async (_kind, prepId) => {
    await expect(addPrepUse(vaseId, use(prepId, 25))).rejects.toThrow(addPrepError);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });

  // Otherwise a cane that's gone could keep collecting shares from new pieces.
  it('rejects a new use on used-up prep', async () => {
    await setPrepUsedUp(caneId, true);

    await expect(addPrepUse(vaseId, use(caneId, 25))).rejects.toThrow(addPrepError);
  });
});

describe('lost prep and lost pieces', () => {
  // Otherwise a cane that shattered while pulling could be picked for a piece.
  it('rejects a use of lost prep and leaves it out of Add prep', async () => {
    await setPieceLost(caneId, true);

    await expect(addPrepUse(vaseId, use(caneId, 25))).rejects.toThrow(addPrepError);
    expect(await getAvailablePrep(vaseId)).toEqual([
      {
        id: fritId,
        kind_id: fritId,
        name: 'Frit mix',
        size_amount: null,
        size_unit: null,
        used_share: 0,
        cost_cents: null,
      },
    ]);
  });

  // Otherwise the cane that went in the garbage with a broken piece would drop off its time.
  it('keeps a lost piece its prep uses', async () => {
    await addPrepUse(bowlId, use(caneId, 25));

    await setPieceLost(bowlId, true);

    expect((await getPieceDetail(bowlId))?.usedPrep).toEqual([
      expect.objectContaining({ prep_id: caneId, ...share(25) }),
    ]);
  });
});

describe('changePrepUse and removePrepUse', () => {
  // Otherwise a wrong guess on a piece's page could never be corrected.
  it('changes a use and then removes it', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    const useId = await getUseId(vaseId, caneId);

    await changePrepUse(useId, share(40));
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([
      expect.objectContaining({ id: useId, ...share(40) }),
    ]);

    await removePrepUse(useId);
    expect((await getPieceDetail(vaseId))?.usedPrep).toEqual([]);
  });

  // Otherwise a stale page could report a change to a removed use as saved.
  it('fails for a use that no longer exists', async () => {
    await expect(changePrepUse(999, share(40))).rejects.toThrow('That prep use no longer exists.');
    await expect(removePrepUse(999)).rejects.toThrow('That prep use no longer exists.');
  });
});

describe('setPrepUsedUp', () => {
  // Otherwise the cane's leftover time, waste included, would belong to no piece.
  it('scales every estimate to fill 100% when the prep is used up', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 25));

    await setPrepUsedUp(caneId, true);

    expect(await getUsedUpAt(caneId)).toEqual(expect.any(String));
    expect(await getActualPercents(caneId)).toEqual([50, 50]);
  });

  // Otherwise a mistaken Used up would hide the estimates and keep the prep out of Add prep.
  it('puts the prep back in use and the estimates show again', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    await setPrepUsedUp(caneId, false);

    expect(await getUsedUpAt(caneId)).toBeNull();
    expect(await getActualPercents(caneId)).toEqual([25]);
    expect(await getAvailablePrep(bowlId)).toEqual([
      {
        id: fritId,
        kind_id: fritId,
        name: 'Frit mix',
        size_amount: null,
        size_unit: null,
        used_share: 0,
        cost_cents: null,
      },
      {
        id: caneId,
        kind_id: caneId,
        name: 'Dichroic cane',
        size_amount: null,
        size_unit: null,
        used_share: 0.25,
        cost_cents: null,
      },
    ]);
  });

  // Otherwise a second tap would move the used up date, or prep still being made could be used up.
  it('fails for prep already in the state asked for, or unfinished prep', async () => {
    await setPrepUsedUp(caneId, true);

    await expect(setPrepUsedUp(caneId, true)).rejects.toThrow(
      "Only finished prep that isn't all used yet can be marked all used.",
    );
    await expect(setPrepUsedUp(unfinishedPrepId, true)).rejects.toThrow(
      "Only finished prep that isn't all used yet can be marked all used.",
    );
    await expect(setPrepUsedUp(fritId, false)).rejects.toThrow("That prep isn't marked all used.");
  });
});

describe('getAvailablePrep', () => {
  // Otherwise Add prep would offer prep that can't be saved, or show the wrong amount left.
  it('lists finished prep newest first with what other pieces used, leaving out prep the piece uses', async () => {
    await addPrepUse(bowlId, use(caneId, 30));
    await addPrepUse(vaseId, use(fritId, 10));

    expect(await getAvailablePrep(vaseId)).toEqual([
      {
        id: caneId,
        kind_id: caneId,
        name: 'Dichroic cane',
        size_amount: null,
        size_unit: null,
        used_share: 0.3,
        cost_cents: null,
      },
    ]);
    expect(await getAvailablePrep(bowlId)).toEqual([
      {
        id: fritId,
        kind_id: fritId,
        name: 'Frit mix',
        size_amount: null,
        size_unit: null,
        used_share: 0.1,
        cost_cents: null,
      },
    ]);
  });
});

describe('closing a batch', () => {
  const cupId = 6;
  const firstBeadId = 10;

  async function addBeads(count: number) {
    await database.execAsync(`
      INSERT INTO pieces (id, name, category)
      SELECT ${firstBeadId} + value, 'Bead', 'piece'
      FROM json_each('[${Array.from({ length: count }, (_unused, index) => index).join(',')}]');
    `);
  }

  beforeEach(async () => {
    await database.execAsync(
      `INSERT INTO pieces (id, name, category) VALUES (${cupId}, 'Red cup', 'piece')`,
    );
  });

  // Otherwise guesses on a cane that runs long would close it at 100% and refuse the next piece.
  it('leaves by eye prep open at 100% and past it, taking another use', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 25));
    await addPrepUse(cupId, use(caneId, 50));
    await addBeads(1);
    await addPrepUse(firstBeadId, use(caneId, 25));

    expect(await isUsedUp(caneId)).toBe(false);
    expect(await getActualPercents(caneId)).toEqual([25, 25, 50, 25]);
  });

  // Otherwise closing a cane that ran past its guesses would put more than its time on its pieces.
  it('scales the shares of by eye prep to 100% when its switch closes it', async () => {
    await addPrepUse(vaseId, use(caneId, 75));
    await addPrepUse(bowlId, use(caneId, 50));

    await setPrepUsedUp(caneId, true);

    expect(await getActualPercents(caneId)).toEqual([60, 40]);
  });

  // Otherwise a cane past 100% could never be opened again for one more piece.
  it('turns All used off on by eye prep past 100%', async () => {
    await addPrepUse(vaseId, use(caneId, 75));
    await addPrepUse(bowlId, use(caneId, 50));
    await setPrepUsedUp(caneId, true);

    await setPrepUsedUp(caneId, false);

    expect(await isUsedUp(caneId)).toBe(false);
  });

  // Otherwise a cane one piece took all of would stay open and keep its cost marked estimated.
  it('closes by eye prep on one use of all of it, and refuses to turn it off', async () => {
    await addPrepUse(vaseId, use(caneId, 100));

    expect(await isUsedUp(caneId)).toBe(true);
    await expect(setPrepUsedUp(caneId, false)).rejects.toThrow(
      'Its uses take all of it. Lower one to turn All used off.',
    );
  });

  // Otherwise a whole cane entered by mistake could never be given back to Add prep.
  it('opens prep again when a use of all of it is lowered', async () => {
    await addPrepUse(vaseId, use(caneId, 100));

    await changePrepUse(await getUseId(vaseId, caneId), share(50));

    expect(await isUsedUp(caneId)).toBe(false);
  });

  // Otherwise removing the use that took a whole cane would keep the cane out of Add prep.
  it('opens prep again when a use of all of it is removed', async () => {
    await addPrepUse(vaseId, use(caneId, 100));

    await removePrepUse(await getUseId(vaseId, caneId));

    expect(await isUsedUp(caneId)).toBe(false);
    expect(await getAvailablePrep(cupId)).toEqual([
      {
        id: fritId,
        kind_id: fritId,
        name: 'Frit mix',
        size_amount: null,
        size_unit: null,
        used_share: 0,
        cost_cents: null,
      },
      {
        id: caneId,
        kind_id: caneId,
        name: 'Dichroic cane',
        size_amount: null,
        size_unit: null,
        used_share: 0,
        cost_cents: null,
      },
    ]);
  });

  // Otherwise deleting the piece that took a whole cane would keep the cane out of Add prep.
  it('opens prep again when the piece that used all of it is deleted', async () => {
    await addPrepUse(bowlId, use(caneId, 100));

    await deletePiece(bowlId);

    expect(await isUsedUp(caneId)).toBe(false);
  });

  // Otherwise removing a use would undo an All used the maker tapped on for a cane that's gone.
  it('keeps All used tapped on when a use is removed', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    await removePrepUse(await getUseId(bowlId, caneId));

    expect(await getUsedUpAt(caneId)).toEqual(expect.any(String));
    expect(await getActualPercents(caneId)).toEqual([100]);
  });
});

describe('getPieceDetail for prep', () => {
  // Otherwise the prep's page couldn't show which pieces used it or how much is gone.
  it('lists the pieces that used the prep with their shares', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 35));

    expect((await getPieceDetail(caneId))?.usedBy).toEqual([
      {
        id: expect.any(Number),
        piece_id: vaseId,
        piece_name: 'Blue vase',
        ...share(25),
        used_up: 0,
        measured: 0,
        shares_total: 0.6,
      },
      {
        id: expect.any(Number),
        piece_id: bowlId,
        piece_name: 'Green bowl',
        ...share(35),
        used_up: 0,
        measured: 0,
        shares_total: 0.6,
      },
    ]);
  });
});

describe('getPieces with prep', () => {
  // Otherwise the Pieces list would show a different prep time than the piece's own page.
  it('gives each piece its prep time rounded down per prep, and none for a piece without prep', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(vaseId, use(fritId, 33));

    const pieces = await getPieces();
    expect(pieces.find((piece) => piece.id === vaseId)).toMatchObject({
      prep_milliseconds: (70 + 39) * minute,
      prep_estimated: true,
    });
    expect(pieces.find((piece) => piece.id === bowlId)?.prep_milliseconds).toBeNull();
  });

  // Otherwise the list would keep showing estimates after the prep's real shares are known.
  it('switches a piece to actual prep time once its prep is used up', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    expect((await getPieces()).find((piece) => piece.id === vaseId)).toMatchObject({
      prep_milliseconds: 4 * hour + 40 * minute,
      prep_estimated: false,
    });
  });

  // Otherwise the Prep list's bars couldn't show how much of each prep is assigned.
  it("gives each prep its shares added together and whether it's used up", async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await addPrepUse(bowlId, use(caneId, 35));
    await addPrepUse(vaseId, use(fritId, 100));

    const pieces = await getPieces();
    expect(pieces.find((piece) => piece.id === caneId)).toMatchObject({
      used_share: 0.6,
      used_up: 0,
    });
    expect(pieces.find((piece) => piece.id === fritId)).toMatchObject({
      used_share: 1,
      used_up: 1,
    });
  });

  // Otherwise prep marked Used up before reaching 100% would still show as having some left.
  it('shows prep marked used up as used up, and a piece that is not prep as having no uses', async () => {
    await addPrepUse(vaseId, use(caneId, 25));
    await setPrepUsedUp(caneId, true);

    const pieces = await getPieces();
    expect(pieces.find((piece) => piece.id === caneId)).toMatchObject({
      used_share: 0.25,
      used_up: 1,
    });
    expect(pieces.find((piece) => piece.id === vaseId)).toMatchObject({
      used_share: 0,
      used_up: 0,
    });
  });
});

describe('getTemplateUses for prep', () => {
  const newCaneId = 6;

  // The bowl is the template, using 30% of the cane and 20% of the frit.
  beforeEach(async () => {
    await addPrepUse(bowlId, use(caneId, 30));
    await addPrepUse(bowlId, use(fritId, 20));
  });

  // Otherwise a template whose cane ran out couldn't be copied without hunting for the new one.
  it('swaps an all used prep for an open one of its kind and keeps one still open', async () => {
    await setPrepUsedUp(caneId, true);
    await database.execAsync(`
      INSERT INTO pieces (id, name, category, notes, finished_at, template_id, kind_id) VALUES
        (${newCaneId}, 'Dichroic cane', 'prep', 'Second pull', '2026-10-31T17:00:00.000Z',
         ${caneId}, ${caneId});
    `);

    expect(
      (await getTemplateUses(bowlId, null, { prep: await getAvailablePrep(null), supplies: [] }))
        .prep,
    ).toEqual([
      {
        batch_id: caneId,
        batch_name: 'Dichroic cane',
        batch_lost: 0,
        counted: 0,
        kind_id: caneId,
        ...share(30),
        replacement: {
          id: newCaneId,
          name: 'Dichroic cane',
          size_amount: null,
          size_unit: null,
          kind_id: caneId,
          used_share: 0,
          cost_cents: null,
        },
      },
      {
        batch_id: fritId,
        batch_name: 'Frit mix',
        batch_lost: 0,
        counted: 0,
        kind_id: fritId,
        ...share(20),
        replacement: {
          id: fritId,
          name: 'Frit mix',
          size_amount: null,
          size_unit: null,
          kind_id: fritId,
          used_share: 0.2,
          cost_cents: null,
        },
      },
    ]);
  });

  // Otherwise a template with a prep that's gone would offer one that can't be saved.
  it('leaves off a prep that is all used or lost with nothing open of its kind', async () => {
    await setPrepUsedUp(caneId, true);
    await setPieceLost(fritId, true);

    expect(
      (await getTemplateUses(bowlId, null, { prep: await getAvailablePrep(null), supplies: [] }))
        .prep,
    ).toEqual([
      expect.objectContaining({ batch_id: caneId, batch_lost: 0, replacement: null }),
      expect.objectContaining({ batch_id: fritId, batch_lost: 1, replacement: null }),
    ]);
  });
});

describe('startFromTemplate', () => {
  const templateSql = `SELECT id, name, category, template_id, finished_at, photo_file_name
    FROM pieces WHERE id = ?`;

  // The bowl is the template, using 30% of the cane.
  beforeEach(async () => {
    await database.execAsync(
      `UPDATE pieces SET is_template = 1, photo_file_name = 'bowl.jpg' WHERE id = ${bowlId}`,
    );
    await addPrepUse(bowlId, use(caneId, 30));
  });

  // Otherwise starting another one would need the name typed again, would change the template, or would count its prep as used before Done.
  it('starts a new running piece with its name, category, and template, saving no prep and leaving the template alone', async () => {
    const pieceId = await startFromTemplate(bowlId);

    expect(await database.getFirstAsync(templateSql, pieceId)).toEqual({
      id: pieceId,
      name: 'Green bowl',
      category: 'piece',
      template_id: bowlId,
      finished_at: null,
      photo_file_name: null,
    });
    expect(
      await database.getAllAsync('SELECT piece_id FROM work_segments WHERE ended_at IS NULL'),
    ).toEqual([{ piece_id: pieceId }]);
    expect(
      await database.getAllAsync(
        'SELECT piece_id, prep_id, share_numerator, share_denominator FROM prep_uses ORDER BY id',
      ),
    ).toEqual([{ piece_id: bowlId, prep_id: caneId, ...share(30) }]);
    expect(await database.getFirstAsync(templateSql, bowlId)).toEqual({
      id: bowlId,
      name: 'Green bowl',
      category: 'piece',
      template_id: null,
      finished_at: '2026-10-30T17:00:00.000Z',
      photo_file_name: 'bowl.jpg',
    });
  });

  // Otherwise every new batch of points would need its size typed again before it could be used.
  it('copies a prep template size and unit', async () => {
    await database.execAsync(
      `UPDATE pieces SET is_template = 1, size_amount = 8, size_unit = 'points' WHERE id = ${caneId}`,
    );

    const prepId = await startFromTemplate(caneId);

    expect(
      await database.getFirstAsync(
        'SELECT size_amount, size_unit FROM pieces WHERE id = ?',
        prepId,
      ),
    ).toEqual({ size_amount: 8, size_unit: 'points' });
  });

  // Otherwise any piece could be started as a copy, bypassing the switch that picks which ones are offered.
  it('rejects starting from a piece that is not a template and starts nothing', async () => {
    await expect(startFromTemplate(fritId)).rejects.toThrow("That piece isn't a template.");
    expect(
      await database.getAllAsync('SELECT id FROM work_segments WHERE ended_at IS NULL'),
    ).toEqual([]);
  });
});

describe('finishPiece with prep already on the piece', () => {
  // Otherwise a change made to copied prep in the panel after Done would be lost, or a removed one kept.
  it('changes a kept use, removes a dropped one, and adds a new one', async () => {
    await addPrepUse(vaseId, use(caneId, 30));
    await addPrepUse(vaseId, use(fritId, 20));
    const caneUseId = await getUseId(vaseId, caneId);

    await finishPiece(vaseId, {
      ...finish,
      prepUses: [{ ...use(caneId, 40), useId: caneUseId }],
    });

    expect(
      await database.getAllAsync(
        'SELECT id, prep_id, share_numerator, share_denominator FROM prep_uses WHERE piece_id = ? ORDER BY id',
        vaseId,
      ),
    ).toEqual([{ id: caneUseId, prep_id: caneId, ...share(40) }]);
  });

  // Otherwise a new prep added at Done next to copied ones would be dropped.
  it('adds a new use beside one already on the piece', async () => {
    await addPrepUse(vaseId, use(caneId, 30));
    const caneUseId = await getUseId(vaseId, caneId);

    await finishPiece(vaseId, {
      ...finish,
      prepUses: [{ ...use(caneId, 30), useId: caneUseId }, use(fritId, 10)],
    });

    expect(
      await database.getAllAsync(
        'SELECT prep_id, share_numerator, share_denominator FROM prep_uses WHERE piece_id = ? ORDER BY id',
        vaseId,
      ),
    ).toEqual([
      { prep_id: caneId, ...share(30) },
      { prep_id: fritId, ...share(10) },
    ]);
  });
});
